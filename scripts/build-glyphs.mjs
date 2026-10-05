/**
 * Generates MapLibre SDF glyph ranges for PT Sans Narrow into `public/glyphs/`.
 *
 * Why this exists
 * ---------------
 * A MapLibre symbol layer can only draw fonts the *glyph server* has
 * pre-rendered as signed-distance-field PBFs. A webfont loaded by the page
 * (PT Sans via next/font) is invisible to it, so map labels were stuck with
 * whatever the basemap host happened to serve -- Noto Sans, on OpenFreeMap.
 *
 * Hosting our own glyphs lets the map use the project's typeface.
 *
 * Pure JS on purpose: the usual tool (fontnik) needs a native node-gyp build,
 * which would make `npm install` fragile across platforms and CI. opentype.js
 * rasterises the outlines and @mapbox/tiny-sdf converts them, both pure JS.
 *
 * Output: public/glyphs/<fontstack>/<start>-<end>.pbf, the layout MapLibre
 * expects from a `glyphs` URL template.
 */

import fs from "node:fs/promises";
import path from "node:path";
import opentype from "opentype.js";
import { PbfWriter } from "pbf";

/**
 * Fonts to bake. `stack` is the name used in `text-font`.
 * TTF urls come from the Google Fonts CSS API (no key required).
 */
const FONTS = [
    {
        stack: "PT Sans Narrow Bold",
        url: "https://fonts.gstatic.com/s/ptsansnarrow/v19/BngSUXNadjH0qYEzV7ab-oWlsbg95DiC.ttf",
    },
    {
        stack: "PT Sans Bold",
        url: "https://fonts.gstatic.com/s/ptsans/v18/jizfRExUiTo99u79B_mh4Ok.ttf",
    },
    {
        // Basemap labels (place names, streets). Regular rather than Bold so
        // the basemap reads as background and our stop names stay dominant.
        stack: "PT Sans Regular",
        url: "https://fonts.gstatic.com/s/ptsans/v18/jizaRExUiTo99u79P0U.ttf",
    },
];

const OUT = path.join(process.cwd(), "public", "glyphs");

// MapLibre fetches glyphs in blocks of 256 codepoints. Latin + Latin-1
// Supplement + Latin Extended-A covers Indonesian and the punctuation in
// Transjakarta stop names; going further would bloat the output for nothing.
const RANGES = [0, 256, 512, 768, 1024, 7936, 8192, 8448];

// Values MapLibre's shader expects. These are not free parameters -- the
// renderer assumes 8px of padding and this radius when decoding the SDF.
const SIZE = 24;
const BUFFER = 3;
const RADIUS = 8;
const CUTOFF = 0.25;

/**
 * Distance from the ascender line down to the baseline, in the 24px em box
 * MapLibre assumes. Glyph `top` is measured from that ascender line, so this
 * is what keeps every letter of a word on one baseline.
 *
 * 26 matches the reference glyphs OpenFreeMap serves (see `renderGlyph`).
 */
const ASCENDER_PX = 26;

/** Serialises one range into the glyphs.proto wire format. */
function encodeGlyphs(fontstack, range, glyphs) {
    const pbf = new PbfWriter();

    // pbf v4 calls the writer `writeMessage(tag, fn, obj)` with the *object*
    // as the callback's first argument and the writer as the second.
    pbf.writeMessage(
        1,
        (obj, w) => {
            w.writeStringField(1, obj.fontstack);
            w.writeStringField(2, obj.range);
            for (const g of obj.glyphs) {
                w.writeMessage(
                    3,
                    (glyph, gw) => {
                        gw.writeVarintField(1, glyph.id);
                        if (glyph.bitmap?.length)
                            gw.writeBytesField(2, glyph.bitmap);
                        gw.writeVarintField(3, glyph.width);
                        gw.writeVarintField(4, glyph.height);
                        gw.writeSVarintField(5, glyph.left);
                        gw.writeSVarintField(6, glyph.top);
                        gw.writeVarintField(7, glyph.advance);
                    },
                    g
                );
            }
        },
        { fontstack, range, glyphs }
    );

    return Buffer.from(pbf.finish());
}

async function buildFont({ stack, url }) {
    const res = await fetch(url, {
        headers: { "User-Agent": "transum-app glyph builder" },
    });
    if (!res.ok) throw new Error(`${stack}: font download failed (${res.status})`);

    const buf = Buffer.from(await res.arrayBuffer());
    const font = opentype.parse(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );

    // Rasterised with opentype.js and distance-transformed below: TinySDF
    // needs a browser canvas, which Node does not have.
    const scale = SIZE / font.unitsPerEm;
    const dir = path.join(OUT, stack);
    await fs.mkdir(dir, { recursive: true });

    let written = 0;
    let totalGlyphs = 0;

    for (const start of RANGES) {
        const end = start + 255;
        const glyphs = [];

        for (let code = start; code <= end; code++) {
            const glyph = font.charToGlyph(String.fromCodePoint(code));
            if (!glyph || glyph.index === 0) continue;

            const advance = Math.round((glyph.advanceWidth ?? 0) * scale);

            // Whitespace has no outline but still needs an advance.
            const bbox = glyph.getBoundingBox();
            const hasOutline =
                Number.isFinite(bbox.x1) && bbox.x2 > bbox.x1 && bbox.y2 > bbox.y1;

            if (!hasOutline) {
                glyphs.push({
                    id: code,
                    bitmap: Buffer.alloc(0),
                    width: 0,
                    height: 0,
                    left: 0,
                    top: 0,
                    advance,
                });
                continue;
            }

            const rendered = renderGlyph(glyph, scale, font);
            if (!rendered) continue;

            glyphs.push({ id: code, advance, ...rendered });
        }

        if (!glyphs.length) continue;

        totalGlyphs += glyphs.length;
        const pbf = encodeGlyphs(stack, `${start}-${end}`, glyphs);
        await fs.writeFile(path.join(dir, `${start}-${end}.pbf`), pbf);
        written++;
    }

    console.log(
        `  ${stack}: ${written} ranges, ${totalGlyphs} glyphs`
    );
}

/**
 * Rasterises a glyph to an alpha bitmap, then converts it to an SDF with the
 * same 8-bit encoding MapLibre expects (distance mapped around `cutoff`).
 */
function renderGlyph(glyph, scale, font) {
    const bbox = glyph.getBoundingBox();

    // The ink box, rounded outward to whole pixels and then padded. These are
    // positions on one shared pixel grid -- the sampling loop below relies on
    // that, so they must not be re-centred per glyph.
    const x1 = Math.floor(bbox.x1 * scale) - BUFFER;
    const y1 = Math.floor(bbox.y1 * scale) - BUFFER;
    const x2 = Math.ceil(bbox.x2 * scale) + BUFFER;
    const y2 = Math.ceil(bbox.y2 * scale) + BUFFER;

    const w = x2 - x1;
    const h = y2 - y1;
    if (w <= 0 || h <= 0 || w > 255 || h > 255) return null;

    // Supersample the outline into a coverage mask.
    //
    // `getPath(0, 0, SIZE)` already returns pixel coordinates at the target
    // size, with Y pointing DOWN (y = -ascent above the baseline). The bounding
    // box, by contrast, is in font units with Y pointing UP. Mixing the two --
    // rescaling the path and then sampling it against bbox-derived rows -- is
    // what made letters jitter vertically inside a word.
    //
    // So: take the path as-is (k = 1) and sample rows directly in its own
    // down-positive space.
    // Vertical supersampling. Horizontal coverage is already exact (the
    // scanline computes analytic span overlap per pixel), but vertically each
    // pixel only sees SS samples -- so SS caps how many distinct coverage
    // levels a near-horizontal edge can take, and the SDF inherits that cap.
    // 16 brings vertical resolution closer to the horizontal, at a build cost
    // measured in seconds.
    const SS = 16;
    const mask = new Float64Array(w * h);
    const commands = glyph.getPath(0, 0, SIZE, { hinting: false }).commands;

    const polys = flatten(commands, 1);

    // Sample on the *baseline's* integer grid, not a per-glyph one.
    //
    // The box edges below are already integers, but the ink inside them sits
    // at a fractional offset that differs for every glyph. Sampling from the
    // box edge threw that fraction away, so each letter was nudged by up to
    // half a pixel in its own direction -- the vertical jitter visible inside
    // a word. Sampling at absolute pixel centres keeps every glyph on one
    // shared grid, and the sub-pixel position survives in the coverage values.
    for (let py = 0; py < h; py++) {
        for (let sy = 0; sy < SS; sy++) {
            // Absolute y in path space (down-positive), at a pixel centre.
            const y = -y2 + py + (sy + 0.5) / SS;
            const xs = scanline(polys, y);
            if (!xs.length) continue;
            for (let i = 0; i + 1 < xs.length; i += 2) {
                const sx = xs[i];
                const ex = xs[i + 1];
                for (let px = 0; px < w; px++) {
                    const cx = x1 + px;
                    const cover = Math.max(
                        0,
                        Math.min(cx + 1, ex) - Math.max(cx, sx)
                    );
                    if (cover > 0) mask[py * w + px] += cover / SS;
                }
            }
        }
    }

    // Signed distance field from the *fractional* coverage mask.
    //
    // The coverage values carry the sub-pixel position of each edge, which is
    // the only thing that distinguishes a 3.2px stem from a 3.8px one at this
    // size. Thresholding the mask to a boolean before measuring distance (as
    // this did originally) throws that away: every distance collapses to
    // hypot(integer, integer), the field takes ~21 values instead of ~226, and
    // stems snap to whole pixels -- so identical letters render at visibly
    // different weights depending on where they happened to land on the grid.
    const bitmap = Buffer.alloc(w * h);
    const sdf = signedDistanceField(mask, w, h);
    for (let i = 0; i < sdf.length; i++) {
        // MapLibre decodes: alpha = (value/255 - cutoff) * radius, and our
        // glyphs are stored inverted relative to that (see the row dumps in
        // the diagnosis), so keep the same polarity the renderer already sees.
        bitmap[i] = 255 - Math.max(0, Math.min(255, Math.round(
            (sdf[i] / RADIUS + CUTOFF) * 255
        )));
    }

    // The protobuf carries the *padded* bitmap but the *unpadded* metrics:
    //   "A signed distance field of the glyph with a border of 3 pixels."
    // MapLibre reconstructs the image as (width + 2*border) x (height + 2*border)
    // and throws "mismatched image size" unless that matches bitmap.length.
    //
    // `top` is NOT the ink height above the baseline. MapLibre places a quad at
    //   y1 = (-metrics.top - rectBuffer) * scale + penY + SHAPING_DEFAULT_OFFSET
    // where penY and SHAPING_DEFAULT_OFFSET (-17) are the same for every glyph
    // on a line. So `top` must be measured from one FIXED line -- the ascender
    // of a 24px em box -- down to this glyph's ink. Deriving it from each
    // glyph's own ink height instead put every letter at its own elevation,
    // which is the vertical jitter inside a word.
    //
    // Verified against OpenFreeMap's own Noto Sans glyphs, where
    // (-top + height) is a constant 26 across caps, x-height and ascenders.
    const inkTopAboveBaseline = y2 - BUFFER;

    return {
        bitmap,
        width: w - 2 * BUFFER,
        height: h - 2 * BUFFER,
        // Offsets refer to the unpadded box, so undo the padding added above.
        left: x1 + BUFFER,
        top: -(ASCENDER_PX - inkTopAboveBaseline),
    };
}

/** Converts path commands into closed polygons of [x, y] points. */
function flatten(commands, k) {
    const polys = [];
    let cur = [];
    let sx = 0;
    let sy = 0;
    let cx = 0;
    let cy = 0;

    const push = (x, y) => cur.push([x * k, y * k]);

    for (const c of commands) {
        if (c.type === "M") {
            if (cur.length > 2) polys.push(cur);
            cur = [];
            sx = cx = c.x;
            sy = cy = c.y;
            push(cx, cy);
        } else if (c.type === "L") {
            cx = c.x;
            cy = c.y;
            push(cx, cy);
        } else if (c.type === "Q" || c.type === "C") {
            const steps = 12;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                let x;
                let y;
                if (c.type === "Q") {
                    const mt = 1 - t;
                    x = mt * mt * cx + 2 * mt * t * c.x1 + t * t * c.x;
                    y = mt * mt * cy + 2 * mt * t * c.y1 + t * t * c.y;
                } else {
                    const mt = 1 - t;
                    x =
                        mt ** 3 * cx +
                        3 * mt * mt * t * c.x1 +
                        3 * mt * t * t * c.x2 +
                        t ** 3 * c.x;
                    y =
                        mt ** 3 * cy +
                        3 * mt * mt * t * c.y1 +
                        3 * mt * t * t * c.y2 +
                        t ** 3 * c.y;
                }
                push(x, y);
            }
            cx = c.x;
            cy = c.y;
        } else if (c.type === "Z") {
            if (cur.length > 2) {
                push(sx, sy);
                polys.push(cur);
            }
            cur = [];
            cx = sx;
            cy = sy;
        }
    }
    if (cur.length > 2) polys.push(cur);
    return polys;
}

/** x-intersections of a horizontal line with the polygon set, sorted. */
function scanline(polys, y) {
    const xs = [];
    for (const poly of polys) {
        for (let i = 0; i + 1 < poly.length; i++) {
            const [ax, ay] = poly[i];
            const [bx, by] = poly[i + 1];
            if (ay === by) continue;
            if (y >= Math.min(ay, by) && y < Math.max(ay, by)) {
                xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
            }
        }
    }
    xs.sort((a, b) => a - b);
    return xs;
}

/**
 * Exact Euclidean distance transform of a binary mask (Felzenszwalb &
 * Huttenlocher): squared distance, one pass per axis, O(n) per row/column.
 *
 * `f` holds the per-cell seed cost (0 inside the set, INF outside); the result
 * is written back into `f` as squared distances.
 */
function edt1d(f, d, v, z, n) {
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    d[0] = f[0];

    for (let q = 1, k = 0, s = 0; q < n; q++) {
        do {
            const r = v[k];
            s = (f[q] - f[r] + q * q - r * r) / (2 * q - 2 * r);
        } while (s <= z[k] && --k > -1);

        k++;
        v[k] = q;
        z[k] = s;
        z[k + 1] = INF;
    }

    for (let q = 0, k = 0; q < n; q++) {
        while (z[k + 1] < q) k++;
        const r = v[k];
        const dx = q - r;
        d[q] = f[r] + dx * dx;
    }
}

/** 2D exact EDT over a grid of seed costs, in place. */
function edt2d(data, w, h, f, d, v, z) {
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) f[y] = data[y * w + x];
        edt1d(f, d, v, z, h);
        for (let y = 0; y < h; y++) data[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) f[x] = data[y * w + x];
        edt1d(f, d, v, z, w);
        for (let x = 0; x < w; x++) data[y * w + x] = Math.sqrt(d[x]);
    }
}

const INF = 1e20;

/**
 * Signed distance field (in pixels) from a fractional coverage mask.
 *
 * This is the approach @mapbox/tiny-sdf uses. Two exact Euclidean distance
 * transforms are run -- one over the glyph, one over its complement -- and
 * subtracted, which yields a smooth signed field.
 *
 * The sub-pixel refinement is what the old implementation lacked: a cell with
 * partial coverage `a` sits roughly `0.5 - a` pixels from the true edge, so
 * seeding the transform with that offset (rather than a hard 0/INF) recovers
 * the fractional edge position instead of quantising it to the pixel grid.
 */
function signedDistanceField(mask, w, h) {
    const n = w * h;
    const gridOuter = new Float64Array(n);
    const gridInner = new Float64Array(n);
    const size = Math.max(w, h);
    const f = new Float64Array(size);
    const d = new Float64Array(size);
    const v = new Int32Array(size + 1);
    const z = new Float64Array(size + 1);

    for (let i = 0; i < n; i++) {
        const a = Math.min(1, Math.max(0, mask[i]));
        if (a === 0) {
            gridOuter[i] = INF;
            gridInner[i] = 0;
        } else if (a === 1) {
            gridOuter[i] = 0;
            gridInner[i] = INF;
        } else {
            // Distance from this cell's centre to the edge passing through it.
            const dd = 0.5 - a;
            gridOuter[i] = dd > 0 ? dd * dd : 0;
            gridInner[i] = dd < 0 ? dd * dd : 0;
        }
    }

    edt2d(gridOuter, w, h, f, d, v, z);
    edt2d(gridInner, w, h, f, d, v, z);

    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        // Positive outside, negative inside, clamped to the encodable range.
        const dist = gridOuter[i] - gridInner[i];
        out[i] = Math.max(-RADIUS, Math.min(RADIUS, dist));
    }
    return out;
}

async function main() {
    await fs.mkdir(OUT, { recursive: true });
    console.log("Building SDF glyphs...");
    for (const f of FONTS) await buildFont(f);
    console.log(`\u2713 Glyphs written to public/glyphs/`);
}

main().catch((err) => {
    console.error(`\u2717 ${err.message}`);
    process.exit(1);
});
