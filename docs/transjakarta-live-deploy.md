# Deploying the live sidecar on a VPS (Docker)

The Next.js app is on Vercel; the MQTT→SSE sidecar cannot run there, so it
lives here. One persistent container per upstream fleet subscription — never
scale it out, because every extra instance opens another upstream
subscription.

```
browser ──HTTPS──► https://live.<domain>  (nginx on the VPS)
                        └─► 127.0.0.1:8787  (container, bundle, no deps)
Vercel app ──EventSource (CORS-checked)──┘
```

## What is built

`Dockerfile.live` bundles `live/server.ts` into one `server.mjs` with esbuild,
then copies it into a runtime image with **no `node_modules`**. The runtime
image needs only Node, the bundle and `data/gtfs/routes.json`. Build it locally
with `npm run build:live` if you want the same artefact without Docker.

## Layout on the VPS

```
/opt/transum-live/
  package.json  package-lock.json  tsconfig.json
  Dockerfile.live  docker-compose.live.yml  .dockerignore
  live/  utils/  scripts/build-live-server.mjs
  data/gtfs/routes.json
  .env
```

`utils/` is large but only a few files are pulled into the bundle; the build
context filter in `.dockerignore` keeps everything else out.

## Steps

1. Put the repo (or a `git archive` of it) at `/opt/transum-live`.
2. Create `/opt/transum-live/.env`:

   ```
   TJ_LIVE_ALLOWED_ORIGIN=https://<your-vercel-domain>
   ```

   The origin must match the page exactly — a `https://` site cannot use
   `http://`, and `www.` differs from the bare domain. Preview deployments
   (`*.vercel.app`) are **not** allowed by this single-origin check; that is
   intentional.

3. Build and start:

   ```bash
   cd /opt/transum-live
   docker compose -f docker-compose.live.yml up -d --build
   docker compose -f docker-compose.live.yml logs -f
   ```

   The startup line must show `"enabled":true`, `"host":"0.0.0.0"` and the
   expected `allowedOrigin`. `"enabled":false` means every stream answers 503.

4. Verify on the VPS:

   ```bash
   curl -s http://127.0.0.1:8787/live/health
   curl -N -H 'Origin: https://<your-vercel-domain>' \
     'http://127.0.0.1:8787/live/vehicles?bbox=106.70,-6.30,106.90,-6.10'
   ```

   Expect `event: snapshot` frames; `status` becomes `live` once SUBACK is
   received. A wrong `Origin` must answer 403, not a stream.

## TLS and reverse proxy

The container publishes on `127.0.0.1:8787` only, so it is unreachable from
the internet and nothing can hotlink the feed. Terminate TLS on the host.

nginx site block, for a host nginx. The ready-to-copy file is
`docs/nginx-transum-live.conf`; the essentials:

```nginx
upstream transum_live {
    server 127.0.0.1:8787;
    keepalive 8;
}

server {
    listen 443 ssl;
    http2 on;
    server_name live.<domain>;

    ssl_certificate     /etc/letsencrypt/live/live.<domain>/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/live.<domain>/privkey.pem;

    location /live/ {
        proxy_pass http://transum_live;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for SSE: no buffering, no caching, long read timeout.
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }
}
```

The four settings that matter for server-sent events:

- `proxy_buffering off` — otherwise nginx collects a snapshot and delivers it
  late. The sidecar's `X-Accel-Buffering: no` header would also do it; keep
  both so a future `proxy_pass` edit cannot silently break the stream.
- `proxy_http_version 1.1` with an empty `Connection` header — required for
  keepalive to the upstream; HTTP/1.0 would hold one connection per stream.
- `proxy_read_timeout 75s` — the sidecar sends a heartbeat every 15 s, so this
  only fires when the upstream is genuinely dead.
- No `gzip` on `text/event-stream`. Leave the default `gzip_types` alone
  (it does not include it); adding `gzip_types text/event-stream` would
  compress per-event and delay flushing.

The `upstream` block is optional but keeps the connection re-usable and gives
one place to change the port.

TLS: `certbot --nginx -d live.<domain>` writes the certificate paths above and
can manage renewal. Install the file with:

```bash
sudo cp docs/nginx-transum-live.conf /etc/nginx/sites-available/transum-live
sudo ln -s /etc/nginx/sites-available/transum-live /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d live.<domain>
```

nginx requires each proxied path to end in `/` on both sides or the request
path is rewritten; the snippet uses `location /live/` with
`proxy_pass http://transum_live;` (no trailing slash) so `/live/vehicles`
arrives unchanged.

If you put Cloudflare in front, use a **DNS-only** record, because the proxy
buffers long streams and caps their duration.

Firewall: allow 80/443 only; keep 8787 closed to the internet.

## Vercel side

Set at **build time** (it is inlined into the client bundle):

```
NEXT_PUBLIC_LIVE_ENABLED=true
NEXT_PUBLIC_LIVE_BASE_URL=https://live.<domain>
```

Redeploy after changing them; editing env vars alone does not rebuild.
Alternatively proxy `/live/` from the Vercel app to the VPS and leave
`NEXT_PUBLIC_LIVE_BASE_URL` empty for a same-origin request — but that makes
every stream pass through a serverless function, so prefer the direct subdomain.

## Operating it

```bash
docker compose -f docker-compose.live.yml logs -f --tail=50   # events
docker stats transum-live                                     # memory
docker compose -f docker-compose.live.yml restart
```

- `restart: unless-stopped` covers crashes and VPS reboots.
- `mem_limit: 256m` plus `read_only` and `no-new-privileges` bound the damage
  from a stuck feed.
- The health check reports `/live/health` only: it proves the process answers
  and is enabled, **not** that the upstream feed is delivering. Watch the
  snapshot `status` for that.
- To update: `git pull`, then `docker compose -f docker-compose.live.yml up -d --build`.

## Access and licence

Read `docs/transjakarta-live.md` first. The MQTT feed has no published reuse
terms, and public availability does not grant redistribution rights. Keep the
audience limited until that question is settled; an allowed `Origin` is
browser hygiene, not authentication. Add proxy-level access control if the
service must not be public.
