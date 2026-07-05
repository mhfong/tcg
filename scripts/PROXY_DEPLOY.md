# Deploying the yuyu-tei parse proxy publicly

The **Import from yuyu-tei** feature needs a small server that talks to
[yuyu-tei.jp](https://yuyu-tei.jp). Yuyu-tei returns HTTP 403 to most
cloud-provider IP ranges, so we can't just point the deployed site at
yuyu-tei directly. The `scripts/parse_server.py` script is that proxy —
it's ~150 lines, depends only on `httpx`, and can run anywhere with
outbound HTTPS.

By default, the frontend is wired to a **local** proxy at
`http://127.0.0.1:8787/parse`. That works fine for a browser on the same
machine as the proxy, but fails with `ERR_CONNECTION_REFUSED` from any
other device (phone, another laptop, etc.) because `127.0.0.1` is
always the *current* device's loopback.

To use the import feature from a phone or other device, deploy the
proxy to a public host. Fly.io's free tier is the easiest path because
it includes HTTPS and you only pay for what you use.

---

## Option A — Fly.io (recommended, ~5 min)

### Prerequisites
- A [Fly.io](https://fly.io) account (free, requires a credit card on
  file but won't charge you on the free tier).
- [`flyctl`](https://fly.io/docs/hands-on/install-flyctl/) installed:
  ```bash
  brew install flyctl   # macOS
  ```

### One-time setup

```bash
# From the repo root
fly auth signup            # or: fly auth login
fly launch --no-deploy     # detects Dockerfile, reuses fly.toml
```

`fly launch` will ask a few questions:
- "Would you like to copy its configuration to your new app?" — **Yes**
- "Do you want to set up a Postgresql database?" — **No**
- "Do you want to set up a Redis database?" — **No**
- "Do you want to deploy now?" — **No** (we'll do it in the next step)

### Deploy

```bash
fly deploy
```

That's it. The deploy takes ~1 minute. When it's done you'll see
something like:

```
==> Monitoring deployment...
 1 desired, 1 placed, 1 healthy, [1 succeeded]
```

### Verify

```bash
# Health check
curl https://yuyutei-parse.fly.dev/health
# → {"ok": true, "service": "yuyutei-parse-proxy"}

# Try fetching rarities for a real set
curl -X POST https://yuyutei-parse.fly.dev/set-rarities \
  -H 'Content-Type: application/json' \
  -d '{"series":"s12a"}'
# → {"tcg":"poc","series":"s12a","rarities":[...]}
```

### Wire up the frontend

In `.env` (the one used to build the production bundle):

```env
VITE_YUYUTEI_PARSE_URL=https://yuyutei-parse.fly.dev/parse
```

Then rebuild and redeploy the frontend (push to `main` triggers
GitHub Actions).

### Cost

The default `fly.toml` uses the free-tier allocation (`shared-cpu-1x`,
256MB) and **scales to zero when idle**, so the app costs $0/month as
long as you stay under Fly's free-tier limits (currently 3 shared-cpu-1x
machines with 256MB RAM each, 160GB outbound transfer).

---

## Option B — Render.com (also free)

1. Sign in to [render.com](https://render.com) and create a new
   **Web Service**.
2. Connect this repo.
3. Set:
   - **Environment:** Docker
   - **Region:** Singapore (closest to yuyu-tei.jp) or Oregon
   - **Instance type:** Free
4. Deploy. Render will use the `Dockerfile` automatically.

The default URL will be something like
`https://yuyutei-parse.onrender.com`. Wire it up the same way as
Option A:

```env
VITE_YUYUTEI_PARSE_URL=https://yuyutei-parse.onrender.com/parse
```

**Caveat:** Render's free tier spins down after 15 min of inactivity, so
the first request after idle can take ~30 s.

---

## Option C — Run on your own VPS

If you already have a server (e.g. a small Oracle Cloud free-tier VM):

```bash
# On the server
git clone <this-repo>
cd tcg
docker build -t yuyutei-parse .
docker run -d --restart=unless-stopped -p 8787:8787 \
  --name yuyutei-parse yuyutei-parse
```

Then put a reverse proxy in front (Caddy is easiest):

```caddyfile
yuyutei-parse.yourdomain.com {
  reverse_proxy 127.0.0.1:8787
}
```

Caddy auto-provisions Let's Encrypt certs.

---

## What if the deploy gets blocked by yuyu-tei?

If yuyu-tei returns 403 even from your chosen host (some IP ranges are
blocked), try a different region. Fly lets you change the primary
region:

```toml
# fly.toml
primary_region = "nrt"   # try "sin", "hkg", "lax" if 403
```

You can also deploy the same image to multiple regions and route to
whichever one works. Run `fly regions add sin` etc.

If every cloud region is blocked, the only remaining option is a
residential / mobile IP (e.g. a VPS at home behind your ISP), which is
out of scope for this guide.

---

## Local development (no deploy needed)

If you only ever use the import feature from the same machine as the
proxy, just run:

```bash
python3 scripts/parse_server.py
```

and leave `VITE_YUYUTEI_PARSE_URL=http://127.0.0.1:8787/parse` in
`.env`. No public deploy required.
