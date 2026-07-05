# Dockerfile for the yuyu-tei parse proxy (scripts/parse_server.py).
#
# Build:
#   docker build -t yuyutei-parse .
#
# Run (local):
#   docker run --rm -p 8787:8787 yuyutei-parse
#
# Run (Fly.io / Render / any host):
#   Bind 0.0.0.0:8787 and expose it to the public internet over HTTPS.
#   The host terminates TLS in front of this container.

FROM python:3.12-slim

# Create a non-root user for the proxy.
# `|| true` because some base images (e.g. python:3.12-slim) ship with a
# `proxy` user already; we don't want the build to fail in that case.
RUN useradd --create-home --shell /bin/bash proxy 2>/dev/null || true
WORKDIR /app

# Install dependencies first for layer caching. Only httpx is needed at
# runtime — the parse_server + scrape_set + scraper modules are stdlib +
# httpx only.
COPY scripts/requirements.txt /app/scripts/requirements.txt
RUN pip install --no-cache-dir -r /app/scripts/requirements.txt

# Copy just the proxy modules. Keep the image small.
COPY scripts/parse_server.py /app/scripts/parse_server.py
COPY scripts/scraper.py      /app/scripts/scraper.py
COPY scripts/scrape_set.py   /app/scripts/scrape_set.py

# Run as the unprivileged user.
USER proxy

# Cloud providers (Fly, Render, Railway) inject $PORT; default to 8787 so
# `docker run` works out of the box.
ENV PORT=8787
EXPOSE 8787

# `--host 0.0.0.0` is required so the container is reachable from outside
# the loopback interface. The cwd at runtime is the WORKDIR above (/app),
# and the proxy code lives in /app/scripts/.
CMD ["sh", "-c", "cd /app/scripts && exec python parse_server.py --host 0.0.0.0 --port ${PORT}"]
