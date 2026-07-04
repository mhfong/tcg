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

POST /set-rarities  body: {"series": "s12a"} (tcg auto-detected)
       → returns {tcg, series, rarities}

POST /set-cards  body: {"series": "s12a", "rarity": "UR"} (tcg auto-detected)
       → returns {tcg, series, rarity, cards}
"""

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from scraper import parse_yuyutei_card
from scrape_set import (
    fetch_cards_in_rarity,
    fetch_cards_in_rarity_for_series,
    list_rarities,
    list_rarities_for_series,
)


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

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        try:
            raw = self.rfile.read(length) if length > 0 else b"{}"
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            return None, f"Invalid JSON body: {e}"
        return body, None

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/parse":
            body, err = self._read_json_body()
            if err:
                self._send_json({"error": err}, 400)
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
            return

        if self.path == "/set-rarities":
            body, err = self._read_json_body()
            if err:
                self._send_json({"error": err}, 400)
                return
            tcg = (body.get("tcg") or "").strip().lower() or None
            series = (body.get("series") or "").strip()
            if not series:
                self._send_json(
                    {"error": "Missing 'series' field"}, 400
                )
                return
            print(f"[rarities] tcg={tcg} series={series}", flush=True)
            try:
                if tcg:
                    rarities = list_rarities(tcg, series)
                    result = {"tcg": tcg, "series": series, "rarities": rarities}
                else:
                    result = list_rarities_for_series(series)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
                return
            self._send_json(result, 200)
            return

        if self.path == "/set-cards":
            body, err = self._read_json_body()
            if err:
                self._send_json({"error": err}, 400)
                return
            tcg = (body.get("tcg") or "").strip().lower() or None
            series = (body.get("series") or "").strip()
            rarity = (body.get("rarity") or "").strip()
            if not series or not rarity:
                self._send_json(
                    {"error": "Missing 'series' or 'rarity' field"}, 400
                )
                return
            print(f"[cards] tcg={tcg} series={series} rarity={rarity}", flush=True)
            try:
                if tcg:
                    cards = fetch_cards_in_rarity(tcg, series, rarity)
                    result = {
                        "tcg": tcg,
                        "series": series,
                        "rarity": rarity,
                        "cards": cards,
                    }
                else:
                    result = fetch_cards_in_rarity_for_series(
                        series, rarity
                    )
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
                return
            self._send_json(result, 200)
            return

        self._send_json({"error": "Not found. Use POST /parse, /set-rarities, or /set-cards"}, 404)

    def do_GET(self) -> None:  # noqa: N802
        # Tiny health-check so you can curl the server from terminal
        if self.path in ("/", "/health"):
            self._send_json({"ok": True, "service": "yuyutei-parse-proxy"}, 200)
            return
        self._send_json({"error": "Use POST /parse, /set-rarities, or /set-cards"}, 405)

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
