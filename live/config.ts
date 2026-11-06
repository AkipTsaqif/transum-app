/**
 * Sidecar settings, validated once at startup so a typo fails loudly instead
 * of degrading quietly. Two failure modes this prevents:
 *
 * - A missing `TJ_LIVE_ALLOWED_ORIGIN` used to skip the origin check entirely,
 *   which allowed every website to embed the stream. Now it refuses to start.
 * - `https://site.com/` (trailing slash) or `https://site.com/path` never
 *   equals a browser `Origin` header, which looked like a 403 mystery.
 */
export interface LiveConfig {
  enabled: boolean;
  allowedOrigin: string | undefined;
  host: string;
  port: number;
}

export const DEFAULT_LIVE_HOST = "127.0.0.1";
export const DEFAULT_LIVE_PORT = 8787;

const parseOrigin = (raw: string): string => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`TJ_LIVE_ALLOWED_ORIGIN is not a URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(
      `TJ_LIVE_ALLOWED_ORIGIN must be http or https, got ${url.protocol}`,
    );
  // An Origin header carries scheme, host and optional port only.
  if (url.origin !== raw.trim())
    throw new Error(
      `TJ_LIVE_ALLOWED_ORIGIN must be a bare origin with no trailing slash, path or port default: ` +
        `use "${url.origin}" instead of "${raw}"`,
    );
  return url.origin;
};

export function liveConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LiveConfig {
  const enabled = env.TJ_LIVE_ENABLED === "true";
  const raw = env.TJ_LIVE_ALLOWED_ORIGIN?.trim();
  if (enabled && !raw)
    throw new Error(
      "TJ_LIVE_ALLOWED_ORIGIN is required when TJ_LIVE_ENABLED=true; " +
        "without it every origin would be accepted",
    );
  const allowedOrigin = raw ? parseOrigin(raw) : undefined;

  const port = Number(env.TJ_LIVE_PORT ?? DEFAULT_LIVE_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid TJ_LIVE_PORT");

  // Loopback by default: a reverse proxy terminates TLS in front and the
  // sidecar is never exposed directly. Only a container sets 0.0.0.0, where
  // the container's own network boundary is what keeps it private.
  const host = env.TJ_LIVE_HOST?.trim() || DEFAULT_LIVE_HOST;

  return { enabled, allowedOrigin, host, port };
}
