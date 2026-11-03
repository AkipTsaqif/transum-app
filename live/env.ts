import fs from "node:fs";
import path from "node:path";

/**
 * The sidecar is a plain Node process, so unlike `next dev` it does not read
 * `.env.local` on its own. Starting it with `npm run live` / `bun live` after
 * putting `TJ_LIVE_ENABLED=true` in `.env.local` silently produced a disabled
 * service (every request 503), which looks exactly like "no buses".
 *
 * Load the same files Next does, lowest priority last so the more specific
 * file wins. Variables already set in the shell are never overridden, so
 * `TJ_LIVE_ENABLED=false bun live` still switches the service off.
 */
export const LIVE_ENV_FILES = [".env.local", ".env"] as const;

export function loadLiveEnv(
  root: string = process.cwd(),
  load: (file: string) => void = (file) => process.loadEnvFile(file),
): string[] {
  const loaded: string[] = [];
  for (const name of LIVE_ENV_FILES) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    load(file);
    loaded.push(name);
  }
  return loaded;
}
