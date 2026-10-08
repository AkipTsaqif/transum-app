import fs from "node:fs/promises";
import path from "node:path";

const GLYPHS_URL = "/glyphs/{fontstack}/{range}.pbf";

async function transformStyle(url, isDark) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const style = await res.json();
    style.glyphs = GLYPHS_URL;

    const muted = isDark ? "#8A94A6" : "#9AA3B0";
    const mutedHalo = isDark
        ? "rgba(12,27,42,0.75)"
        : "rgba(255,255,255,0.85)";

    for (const layer of style.layers || []) {
        if (layer.type === "symbol" && layer.layout && layer.layout["text-font"]) {
            layer.layout["text-font"] = ["PT Sans Regular"];
            if (!/shield/i.test(layer.id || "")) {
                layer.paint = {
                    ...layer.paint,
                    "text-color": muted,
                    "text-halo-color": mutedHalo,
                    "text-halo-width": 1,
                };
            }
        }
    }
    return style;
}

async function main() {
    const outDir = path.join(process.cwd(), "public", "styles");
    await fs.mkdir(outDir, { recursive: true });

    const [light, dark] = await Promise.all([
        transformStyle("https://tiles.openfreemap.org/styles/positron", false),
        transformStyle("https://tiles.openfreemap.org/styles/dark", true),
    ]);

    await fs.writeFile(
        path.join(outDir, "positron.json"),
        JSON.stringify(light, null, 2)
    );
    await fs.writeFile(
        path.join(outDir, "dark.json"),
        JSON.stringify(dark, null, 2)
    );
    console.log("✓ Map styles written to public/styles/");
}

main().catch((err) => {
    console.error("✗ Failed to build styles:", err);
    process.exit(1);
});
