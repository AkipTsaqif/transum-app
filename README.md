<a href="https://demo-nextjs-with-supabase.vercel.app/">
  <img alt="Next.js and Supabase Starter Kit - the fastest way to build apps with Next.js and Supabase" src="https://demo-nextjs-with-supabase.vercel.app/opengraph-image.png">
  <h1 align="center">Next.js and Supabase Starter Kit</h1>
</a>

<p align="center">
 The fastest way to build apps with Next.js and Supabase
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#demo"><strong>Demo</strong></a> ·
  <a href="#deploy-to-vercel"><strong>Deploy to Vercel</strong></a> ·
  <a href="#clone-and-run-locally"><strong>Clone and run locally</strong></a> ·
  <a href="#feedback-and-issues"><strong>Feedback and issues</strong></a>
  <a href="#more-supabase-examples"><strong>More Examples</strong></a>
</p>
<br/>

## Live Transjakarta buses

Bus positions can stream onto the map. The architecture has two parts:

| Part | What it is | How it runs |
|---|---|---|
| Frontend | Next.js map, SSE client, route badges | `npm run dev` |
| Listener | MQTT → route/viewport-scoped SSE | `npm run live` (separate long-running process) |

The browser never talks to MQTT. The listener holds **one** upstream subscription and answers many browsers, so it must be a persistent process (a VPS is the intended host), not a serverless function.

### Quick start (local)

1. Install dependencies. Baked `data/gtfs/` is committed, so the map renders without a sync:

   ```bash
   npm install
   ```

   The listener reads route names and colours from `data/gtfs/routes.json`. If you rebuild the feed yourself, run `npm run sync:gtfs` first.

2. Create `.env.local` with the live flags (see `.env.example`):

   ```dotenv
   NEXT_PUBLIC_LIVE_ENABLED=true
   NEXT_PUBLIC_LIVE_BASE_URL=http://127.0.0.1:8787
   ```

3. Start the listener in its own terminal. It does **not** read Next's `.env.local`, so pass its settings explicitly:

   ```bash
   TJ_LIVE_ENABLED=true TJ_LIVE_ALLOWED_ORIGIN=http://localhost:3000 npm run live
   ```

   PowerShell:

   ```powershell
   $env:TJ_LIVE_ENABLED='true'
   $env:TJ_LIVE_ALLOWED_ORIGIN='http://localhost:3000'
   npm run live
   ```

4. Start the app:

   ```bash
   npm run dev
   ```

5. Open <http://localhost:3000>. **Transjakarta** is the landing view and buses appear automatically — no route needs to be selected and nothing has to be switched on.

### Behaviour

- **No route selected** — buses inside the current map viewport are shown; panning or zooming updates the scope after the camera settles.
- **Route selected** — the stream narrows to that corridor.
- **Other operators** — KRL, MRT, LRT and Bandung suspend live data.
- **Markers** — a route-code badge in that route's GTFS colour. Tap a badge (or expand *Daftar bus*) for fleet number, destination, current/next stop and how long ago the position was received.
- **Freshness** — markers fade after 30 s and disappear after 90 s without a new observation. Device clocks are not trusted; the card says when a clock is unadjusted.

### Listener endpoints

```text
GET /live/vehicles?route=<known-gtfs-route-id>
GET /live/vehicles?bbox=<west,south,east,north>
GET /live/health
```

A request with neither scope is rejected — there is no unrestricted whole-fleet endpoint. `routeId` is `null` for viewport streams. The listener binds to `127.0.0.1` only; put a reverse proxy in front of it for HTTPS and rate limiting.

### Production notes

- Run exactly **one** listener per upstream subscription and supervise it (systemd or similar). Do not scale replicas to add capacity; they would each open another upstream connection.
- Build the frontend with `NEXT_PUBLIC_LIVE_BASE_URL` empty to use a same-origin `/live/` proxy. `NEXT_PUBLIC_*` values are baked in at build time.
- The proxy must not buffer event streams (`proxy_buffering off;`) and needs a read timeout above the heartbeat interval.
- Full runbook, nginx example and safeguards: [docs/transjakarta-live.md](docs/transjakarta-live.md). SSE contract: [docs/transjakarta-live-frontend.md](docs/transjakarta-live-frontend.md).

### Access and licence

The official CC BY 4.0 grant on Transjakarta's PPID site names **GTFS Static** only. It does not explicitly cover this realtime stream, and a working connection is not a redistribution grant. Treat the feature as experimental and confirm terms before enabling it publicly.

### Tests

```bash
npm run test:live      # listener + normalizer + SSE
npx tsx --test utils/*.test.ts
npx tsc --noEmit
```

## Features

- Works across the entire [Next.js](https://nextjs.org) stack
  - App Router
  - Pages Router
  - Middleware
  - Client
  - Server
  - It just works!
- supabase-ssr. A package to configure Supabase Auth to use cookies
- Styling with [Tailwind CSS](https://tailwindcss.com)
- Components with [shadcn/ui](https://ui.shadcn.com/)
- Optional deployment with [Supabase Vercel Integration and Vercel deploy](#deploy-your-own)
  - Environment variables automatically assigned to Vercel project

## Demo

You can view a fully working demo at [demo-nextjs-with-supabase.vercel.app](https://demo-nextjs-with-supabase.vercel.app/).

## Deploy to Vercel

Vercel deployment will guide you through creating a Supabase account and project.

After installation of the Supabase integration, all relevant environment variables will be assigned to the project so the deployment is fully functioning.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel%2Fnext.js%2Ftree%2Fcanary%2Fexamples%2Fwith-supabase&project-name=nextjs-with-supabase&repository-name=nextjs-with-supabase&demo-title=nextjs-with-supabase&demo-description=This+starter+configures+Supabase+Auth+to+use+cookies%2C+making+the+user%27s+session+available+throughout+the+entire+Next.js+app+-+Client+Components%2C+Server+Components%2C+Route+Handlers%2C+Server+Actions+and+Middleware.&demo-url=https%3A%2F%2Fdemo-nextjs-with-supabase.vercel.app%2F&external-id=https%3A%2F%2Fgithub.com%2Fvercel%2Fnext.js%2Ftree%2Fcanary%2Fexamples%2Fwith-supabase&demo-image=https%3A%2F%2Fdemo-nextjs-with-supabase.vercel.app%2Fopengraph-image.png)

The above will also clone the Starter kit to your GitHub, you can clone that locally and develop locally.

If you wish to just develop locally and not deploy to Vercel, [follow the steps below](#clone-and-run-locally).

## Clone and run locally

1. You'll first need a Supabase project which can be made [via the Supabase dashboard](https://database.new)

2. Create a Next.js app using the Supabase Starter template npx command

   ```bash
   npx create-next-app -e with-supabase
   ```

3. Use `cd` to change into the app's directory

   ```bash
   cd name-of-new-app
   ```

4. Rename `.env.example` to `.env.local` and update the following:

   ```
   NEXT_PUBLIC_SUPABASE_URL=[INSERT SUPABASE PROJECT URL]
   NEXT_PUBLIC_SUPABASE_ANON_KEY=[INSERT SUPABASE PROJECT API ANON KEY]
   ```

   Both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` can be found in [your Supabase project's API settings](https://app.supabase.com/project/_/settings/api)

5. You can now run the Next.js local development server:

   ```bash
   npm run dev
   ```

   The starter kit should now be running on [localhost:3000](http://localhost:3000/).

6. This template comes with the default shadcn/ui style initialized. If you instead want other ui.shadcn styles, delete `components.json` and [re-install shadcn/ui](https://ui.shadcn.com/docs/installation/next)

> Check out [the docs for Local Development](https://supabase.com/docs/guides/getting-started/local-development) to also run Supabase locally.

## Feedback and issues

Please file feedback and issues over on the [Supabase GitHub org](https://github.com/supabase/supabase/issues/new/choose).

## More Supabase examples

- [Next.js Subscription Payments Starter](https://github.com/vercel/nextjs-subscription-payments)
- [Cookie-based Auth and the Next.js 13 App Router (free course)](https://youtube.com/playlist?list=PL5S4mPUpp4OtMhpnp93EFSo42iQ40XjbF)
- [Supabase Auth and the Next.js App Router](https://github.com/supabase/supabase/tree/master/examples/auth/nextjs)
