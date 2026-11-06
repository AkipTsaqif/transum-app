import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/**
 * Builds `dist/live/server.mjs`: one self-contained file that runs on plain
 * Node with no node_modules.
 *
 * The VPS image then only needs Node, the artefact and `data/gtfs/routes.json`.
 * Importing the app's `tsconfig.json` keeps the same `@/` aliases and syntax
 * targets as the rest of the project. esbuild is resolved through tsx, so no
 * new dependency is added.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = require("esbuild");

await build({
  entryPoints: [path.join(root, "live/server.ts")],
  outfile: path.join(root, "dist/live/server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  tsconfig: path.join(root, "tsconfig.json"),
  // Bundling for ESM leaves bare requires behind; this shim resolves them.
  banner: {
    js: "import{createRequire as __liveRequire}from'node:module';const require=__liveRequire(import.meta.url);",
  },
  legalComments: "none",
  logLevel: "info",
});
