#!/usr/bin/env python3.9
"""
Download PSA cert card images from psacard.com.

PSA's site is behind a Cloudflare "Just a moment..." bot challenge, which
plain HTTP requests can't pass. This script uses Playwright (headless
Chromium) to:
  1. Load each cert page in a browser (passes the challenge once)
  2. Extract the front-scan image URL from the page
  3. Download the image and save it to data/psa/{cert}.png

The browser context is reused across certs so the Cloudflare clearance
cookie is only earned once.

Usage:
    python3.9 scripts/download_psa_images.py 152192600 152192598 ...

Or pipe via stdin:
    echo "152192600 152192598" | python3.9 scripts/download_psa_images.py -
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path
from typing import Optional

import httpx
from playwright.sync_api import sync_playwright

CERT_URL = "https://www.psacard.com/cert/{cert}/psa"
OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "psa"

# Image CDN hosts on psacard.com — front scans typically live here.
IMAGE_HOST_HINTS = ("images.psacard.com", "img.psacard.com", "psacard.com")


def extract_image_url(html: str) -> Optional[str]:
    """Find the cert's front-scan image URL in the page HTML."""
    # Look for <img src="..."> tags; psacard tends to use a CDN like
    # images.psacard.com/cert/<cert>/...jpg for the cert scan itself.
    candidates = re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', html, flags=re.IGNORECASE)
    if not candidates:
        return None
    # Prefer cert-specific images
    for u in candidates:
        ul = u.lower()
        if any(h in ul for h in IMAGE_HOST_HINTS) and ("front" in ul or "cert" in ul or ".jpg" in ul or ".png" in ul):
            return u if u.startswith("http") else f"https://www.psacard.com{u}"
    # Fallback: first image on a psacard host
    for u in candidates:
        if any(h in u.lower() for h in IMAGE_HOST_HINTS):
            return u if u.startswith("http") else f"https://www.psacard.com{u}"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Download PSA cert images")
    parser.add_argument("certs", nargs="*", help="PSA cert numbers (e.g. 152192600)")
    parser.add_argument("-", dest="from_stdin", action="store_true",
                        help="Read cert numbers from stdin, one per line")
    parser.add_argument("--headed", action="store_true",
                        help="Run browser with a visible window (useful for debugging)")
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR,
                        help=f"Output directory (default: {OUT_DIR})")
    args = parser.parse_args()

    certs: list[str] = list(args.certs)
    if args.from_stdin or (not certs and not sys.stdin.isatty()):
        for line in sys.stdin:
            line = line.strip()
            if line:
                certs.extend(line.split())
    if not certs:
        parser.error("No cert numbers provided. Pass them as args or via stdin.")
    certs = [c.strip() for c in certs if c.strip()]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    print(f"Output dir: {args.out_dir}")
    print(f"Certs to fetch: {len(certs)}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()

        # Warmer: load the first cert and wait for the Cloudflare challenge
        # to clear. The challenge usually takes 2-5 seconds.
        first_url = CERT_URL.format(cert=certs[0])
        print(f"[warmup] Loading {first_url}")
        page.goto(first_url, wait_until="domcontentloaded", timeout=60000)
        # Wait for the challenge to clear — title changes from "Just a moment..."
        try:
            page.wait_for_function(
                "() => !document.title.toLowerCase().includes('just a moment')",
                timeout=30000,
            )
        except Exception:
            print("[warmup] Cloudflare challenge did not clear in 30s. Continuing anyway.")
        # Give the page a moment to fully render after challenge clears
        time.sleep(2)

        successes = 0
        failures = 0
        for cert in certs:
            out_path = args.out_dir / f"{cert}.png"
            if out_path.exists() and out_path.stat().st_size > 0:
                print(f"[skip] {cert} (already exists)")
                successes += 1
                continue
            url = CERT_URL.format(cert=cert)
            try:
                print(f"[fetch] {cert} {url}")
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
                # If we hit a challenge on this cert, wait it out
                if "just a moment" in page.title().lower():
                    page.wait_for_function(
                        "() => !document.title.toLowerCase().includes('just a moment')",
                        timeout=30000,
                    )
                    time.sleep(1)
                html = page.content()
                img_url = extract_image_url(html)
                if not img_url:
                    print(f"[fail] {cert}: no image URL found in page")
                    failures += 1
                    continue
                print(f"[img]   {cert} -> {img_url}")
                # Download the image using the same context's cookies
                cookies = context.cookies()
                cookie_jar = {c["name"]: c["value"] for c in cookies}
                headers = {
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                    "Referer": url,
                }
                with httpx.Client(cookies=cookie_jar, headers=headers, timeout=30.0, follow_redirects=True) as client:
                    r = client.get(img_url)
                    r.raise_for_status()
                    out_path.write_bytes(r.content)
                print(f"[ok]    {cert} -> {out_path} ({len(r.content):,} bytes)")
                successes += 1
            except Exception as e:
                print(f"[fail]  {cert}: {e}")
                failures += 1

        browser.close()

    print(f"\nDone. {successes} succeeded, {failures} failed.")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
