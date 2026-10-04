/**
 * Copies MapLibre GL JS v6's worker into `public/maplibre/` so the browser can
 * fetch it from a stable, unhashed URL.
 *
 * Why this is needed
 * ------------------
 * v6 ships the worker as a separate ES module and locates it at runtime with:
 *
 *     new URL("./maplibre-gl-worker.mjs", import.meta.url)
 *
 * A bundler rewrites the library's own URL and content-hashes every emitted
 * asset, so that expression resolves to a file that does not exist:
 *
 *     asks for : /_next/static/media/maplibre-gl-worker.mjs          -> 404
 *     emitted  : /_next/static/media/maplibre-gl-worker.<hash>.mjs   -> 200
 *
 * The worker then fails to start. MapLibre does not throw -- it just renders
 * the map background and never requests a tile, which looks like a blank
 * pale-blue canvas plus "Worker failed to load" in the console.
 *
 * `maplibre-gl-worker.mjs` also imports `./maplibre-gl-shared.mjs`, so both
 * files must land in the same directory or the worker dies on its first
 * import. Copying the pair verbatim keeps that relative import intact.
 *
 * Runs from `predev` and `prebuild`; safe to re-run.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Resolved via the package itself so it follows npm/bun/pnpm layouts.
const pkgJson = require.resolve("maplibre-gl/package.json");
const DIST = path.join(path.dirname(pkgJson), "dist");
const OUT = path.join(process.cwd(), "public", "maplibre");

// The worker and the sibling chunk it imports. Order is irrelevant; both must exist.
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

async function main() {
    await fs.mkdir(OUT, { recursive: true });

    const version = JSON.parse(await fs.readFile(pkgJson, "utf-8")).version;

    for (const name of FILES) {
        const src = path.join(DIST, name);
        try {
            await fs.copyFile(src, path.join(OUT, name));
        } catch (err) {
            throw new Error(
                `Could not copy ${name} from maplibre-gl@${version}: ${err.message}\n` +
                    `If the dist layout changed, re-check components/map/main-map.tsx.`
            );
        }
    }

    // Record the version the copies came from so a stale asset is detectable.
    await fs.writeFile(
        path.join(OUT, ".version"),
        `${version}\n`,
        "utf-8"
    );

    console.log(`✓ MapLibre worker copied to public/maplibre/ (v${version})`);
}

main().catch((err) => {
    console.error(`✗ ${err.message}`);
    process.exit(1);
});
