# TCG Pro

A small web app for tracking Japanese Pokémon TCG (PTCG) and ONE PIECE
TCG (OPCG) cards. Auth, inventory, watchlist, transactions, and a card
database. Deployed to GitHub Pages.

The live site uses Supabase for auth + storage. The "Import from
yuyu-tei" feature also needs a small proxy server — see
[scripts/PROXY_DEPLOY.md](scripts/PROXY_DEPLOY.md) for why and how to
deploy it.

## Quick start (local dev)

```bash
npm install
cp .env.example .env   # fill in Supabase keys
npm run dev            # http://127.0.0.1:5173
```

In a second terminal, if you want the "Import from yuyu-tei" feature to
work in the same browser:

```bash
python3 scripts/parse_server.py   # http://127.0.0.1:8787
```

## Build / deploy

```bash
npm run build       # static bundle → dist/
git push            # GitHub Actions deploys to GitHub Pages
```

## "Import from yuyu-tei" feature

This feature bulk-imports cards from [yuyu-tei.jp](https://yuyu-tei.jp)
set pages. It needs a small HTTP proxy because yuyu-tei returns HTTP 403
to most cloud-provider IPs (including the GitHub Pages origin).

The default config points at `http://127.0.0.1:8787/parse` for local
development. That URL only works when `scripts/parse_server.py` is
running on the same machine as your browser. From a phone or another
device it fails with `ERR_CONNECTION_REFUSED` — this is **not** a
Safari/Chrome bug, it's because `127.0.0.1` is always the *current*
device's loopback.

To use the feature on a phone or other device, deploy the proxy to a
public host:

- **Fly.io** (recommended, free tier): see
  [scripts/PROXY_DEPLOY.md → Option A](scripts/PROXY_DEPLOY.md#option-a--flyio-recommended-5-min)
- **Render.com** (also free): see
  [scripts/PROXY_DEPLOY.md → Option B](scripts/PROXY_DEPLOY.md#option-b--rendercom-also-free)
- **Your own VPS**: see
  [scripts/PROXY_DEPLOY.md → Option C](scripts/PROXY_DEPLOY.md#option-c--run-on-your-own-vps)

After deploying, set `VITE_YUYUTEI_PARSE_URL` in `.env` to the public
URL and rebuild.

## Project layout

```
src/                React + TypeScript frontend
  pages/            One file per route (Database, Inventory, etc.)
  lib/              auth, supabase client, types
  components/       shared UI
scripts/            Python helpers (yuyu-tei scraper, parse proxy)
  parse_server.py   the local proxy
  scrape_set.py     set-page scraper
  scraper.py        single-card scraper
  PROXY_DEPLOY.md   how to deploy the proxy publicly
supabase/           SQL schema + Edge Functions
.github/workflows/  GitHub Pages deploy
Dockerfile          container image for the proxy
fly.toml            Fly.io config for the proxy
```

## Environment variables

See [`.env.example`](.env.example) for the full list. Required for
local dev: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Optional:
`VITE_YUYUTEI_PARSE_URL` (defaults to `http://127.0.0.1:8787/parse`).

## Vite template notes

This project was bootstrapped with `npm create vite@latest -- --template
react-ts`. The original Vite/React/ESLint template docs are preserved
below for reference.

### React Compiler

The React Compiler is not enabled on this template because of its impact
on dev & build performances. To add it, see
[this documentation](https://react.dev/learn/react-compiler/installation).

### Expanding the ESLint configuration

If you are developing a production application, we recommend updating
the configuration to enable type-aware lint rules. See the
[ESLint config](eslint.config.js) for what's currently enabled, and the
[Vite docs](https://vitejs.dev/guide/) for more.

