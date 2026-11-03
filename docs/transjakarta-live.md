# Experimental live Transjakarta buses

The feature is on `feat/transjakarta-live`. Transjakarta is the landing view. Once the live service is configured, bus display starts enabled without selecting a route. Deployment flags remain disabled in the example configuration until explicitly enabled. Static GTFS, station search and other operators are unchanged.

## Local use

Set these Next.js variables in `.env.local`, then restart `npm run dev`:

```dotenv
NEXT_PUBLIC_LIVE_ENABLED=true
NEXT_PUBLIC_LIVE_BASE_URL=http://127.0.0.1:8787
```

Run the sidecar from the repository root, in a separate terminal. The standalone process does not auto-load Next.js `.env.local`:

```bash
TJ_LIVE_ENABLED=true TJ_LIVE_ALLOWED_ORIGIN=http://localhost:3000 npm run live
```

PowerShell equivalent:

```powershell
$env:TJ_LIVE_ENABLED='true'
$env:TJ_LIVE_ALLOWED_ORIGIN='http://localhost:3000'
npm run live
```

Open the map: **Transjakarta** is selected and **Bus langsung** starts on. Without a route selection, the server streams only buses inside the current map viewport; panning/zooming updates that scope after movement settles. Selecting a Transjakarta route narrows the stream to that corridor; clearing it restores the viewport scope. Jakarta's all-modes view also supports live buses; selecting another operator suspends them. The live toggle remains available without a selected route, and an explicit opt-out persists across route changes for this session.

Each bus is a route-code badge in the baked GTFS route colour, with contrasting text; no arrow or fleet number on the map. Tap a badge or expand **Daftar bus** to choose one using an accessible list. Its detail card shows fleet identity, destination, current/next stop and receipt age—not verified GPS measurement age. No ETAs or occupancy claims are shown.

The listener accepts either a known GTFS route ID or a valid viewport bbox (west,south,east,north; at most five degrees per axis), and shares one MQTT client across viewers. `/live/vehicles` without either scope is rejected; it does not expose an unrestricted fleet response. The last viewer leaving stops upstream after ten seconds. `/live/health` reports whether the feature is enabled and viewer count; health checking does not start the broker connection.

## Data safeguards

- Reject zero/nonfinite/outside-network raw coordinates; independently validate snapped coordinates and require they are within500m of raw GPS.
- Do not round route codes or guess unmatched aliases.
- Source `timestamp` seconds/milliseconds normalize to epoch ms. Equal/older timestamps do not refresh marker TTL. No `last_update` or ETA units are assumed.
- Relative source progression can establish a per-vehicle clock offset. This does NOT prove true observation age: an old queued stream can advance too. The card marks uncertain or adjusted clocks. No blanket timezone correction.
- Fade at30s and remove at90s without new advancing observations. These are operational UI thresholds, not an upstream SLA. Hidden browser tabs close their SSE connection and resume with a new snapshot.
- Only latest state retained in bounded memory; no track history, raw payload archive, guest tokens or private user fields. Route badges use trusted GTFS names/colours and never arbitrary upstream CSS or image URLs.
- Sidecar outputs at most one filtered snapshot/second. Slow clients have bounded write buffering; viewer cap200. MQTT retries back off to30s with jitter. Only SUBACK acceptance marks the feed connected.

## VPS setup (not deployed)

Run exactly one persistent sidecar per upstream fleet subscription; scale downstream fan-out deliberately, not by spawning more upstream subscribers. Supervise it with systemd or an equivalent service manager. Production must have an exact `TJ_LIVE_ALLOWED_ORIGIN` matching the public site origin. Use an empty `NEXT_PUBLIC_LIVE_BASE_URL` at **build time**, and enable the UI only after access and republication terms are confirmed.

Example nginx location inside the same HTTPS server block:

```nginx
location /live/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 75s;
}
```

Do not expose port8787 directly. Add edge connection/rate limits and TLS. An allowed Origin is browser hygiene, not authentication; public access control must be configured at the reverse proxy if required. Set OS connection/memory limits and monitor reconnect rate before public deployment.

## Access and licence

The endpoint accepts a credential-free MQTT client with a `mqttjs_` client ID. That is observed behavior, not an official availability promise or a redistribution grant. The official CC BY4.0 statement on the PPID site explicitly names **GTFS Static**. No equivalent MQTT reuse terms were located. This feature must not imply the realtime stream is CC BY4.0 or officially endorsed. Do not enable public redistribution solely because a connection works.

## Verification

```bash
npm run test:live
npx tsx --test utils/*.test.ts live/*.test.ts
npx tsc --noEmit
```

See `specs/archive/spikes/SPIKE-transjakarta-live.md` for measured sample limits and `specs/PLAN_TRANSJAKARTA_LIVE.md` for scope.
