"""
Local proxy server for yuyu-tei.jp scraping.

Why: Supabase Edge Functions (Deno Deploy) get HTTP 403 from yuyu-tei,
which blocks their IPs. Running the scraper locally bypasses that.

Run:
    python scripts/parse_server.py            # listens on 127.0.0.1:8787
    python scripts/parse_server.py --port 9000

Then point your frontend at:
    VITE_YUYUTEI_PARSE_URL=http://127.0.0.1:8787/parse

POST /parse  body: {"url": "https://yuyu-tei.jp/..."}
       → returns the parsed card JSON, or {"error": "..."}
"""

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from scraper import parse_yuyutei_card


class ParseHandler(BaseHTTPRequestHandler):
    def _send_json(self, body: dict, status: int = 200) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        # CORS — the Vite dev server runs on a different port
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send_json({}, 204)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/parse":
            self._send_json({"error": "Not found. Use POST /parse"}, 404)
            return

        length = int(self.headers.get("Content-Length", "0") or "0")
        try:
            raw = self.rfile.read(length) if length > 0 else b"{}"
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            self._send_json({"error": f"Invalid JSON body: {e}"}, 400)
            return

        url = (body.get("url") or "").strip()
        if not url:
            self._send_json({"error": "Missing 'url' field"}, 400)
            return

        print(f"[parse] {url}", flush=True)
        try:
            card = parse_yuyutei_card(url)
        except Exception as e:
            self._send_json({"error": str(e)}, 500)
            return

        if "error" in card:
            self._send_json(card, 400)
            return
        self._send_json(card, 200)

    def do_GET(self) -> None:  # noqa: N802
        # Tiny health-check so you can curl the server from terminal
        if self.path in ("/", "/health"):
            self._send_json({"ok": True, "service": "yuyutei-parse-proxy"}, 200)
            return
        self._send_json({"error": "Use POST /parse"}, 405)

    def log_message(self, fmt: str, *args) -> None:
        # Quieter default access log
        sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Local yuyu-tei parse proxy")
    parser.add_argument("--host", default="127.0.0.1", help="bind host (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8787, help="bind port (default 8787)")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), ParseHandler)
    print(f"yuyutei-parse proxy listening on http://{args.host}:{args.port}", flush=True)
    print(f"  POST /parse   body: {{\"url\": \"https://yuyu-tei.jp/...\"}}", flush=True)
    print(f"  GET  /health  for liveness check", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down", flush=True)
        server.shutdown()


if __name__ == "__main__":
    main()
