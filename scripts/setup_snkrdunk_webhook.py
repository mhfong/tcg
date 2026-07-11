"""
One-shot setup: create a Supabase Database Webhook that fires on
INSERT to public.master_table and triggers a GitHub repository_dispatch
event, which in turn runs the SNKRDUNK discovery workflow.

What it does
------------
1. Reads GitHub + Supabase creds from the environment.
2. POSTs to the Supabase Management API to create a webhook on
   the `master_table` table (event: INSERT) that POSTs a payload to
   GitHub's `repository_dispatch` endpoint.
3. The webhook includes a record filter so it only fires for rows
   where `snkrdunk_apparel_id IS NULL` (avoids re-triggering for
   already-mapped cards).

Usage
-----
    # Set the secrets first (in the terminal, NOT committed):
    export SUPABASE_PROJECT_REF=uimoiutektarmjeoubem
    export SUPABASE_ACCESS_TOKEN=sbp_...        # from Supabase dashboard
    export GH_REPO=mhfong/tcg
    export GH_TOKEN=ghp_...                    # Fine-grained PAT with
                                                # Actions: Write on mhfong/tcg
    python scripts/setup_snkrdunk_webhook.py

Re-running is safe: it lists existing webhooks and skips the create if
one with the same name already exists.

Why this is a one-shot script
----------------------------
- The webhook only needs to be created once per project.
- If you ever need to delete it, run with --delete <webhook-id>.
- GitHub Actions workflow `.github/workflows/snkrdunk-discover-on-new-card.yml`
  is the consumer; the webhook is the producer.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse

import httpx


def gh_repo_dispatch_url(repo: str) -> str:
    return f"https://api.github.com/repos/{repo}/dispatches"


def supabase_webhooks_url(project_ref: str) -> str:
    return f"https://api.supabase.com/v1/projects/{project_ref}/database/webhooks"


def supabase_config_url(project_ref: str) -> str:
    return f"https://api.supabase.com/v1/projects/{project_ref}/config/database/webhooks"


def list_existing_webhooks(project_ref: str, token: str) -> list[dict]:
    """List all database webhooks on the project."""
    r = httpx.get(
        supabase_webhooks_url(project_ref),
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()


def create_webhook(
    project_ref: str,
    token: str,
    *,
    name: str,
    table: str,
    events: list[str],
    http_url: str,
    http_headers: list[dict],
    record_filter: str,
) -> dict:
    """Create a database webhook on the given table.

    record_filter uses PostgREST-style filter syntax, e.g.
    "snkrdunk_apparel_id=is.null" to fire only for rows where the
    column is null. This avoids re-triggering for already-mapped cards.
    """
    body = {
        "name": name,
        "table": table,
        "events": events,
        "method": "POST",
        "url": http_url,
        "headers": http_headers,
        "enabled": True,
        "conditions": {
            "row_count": "exact",
            # Filter the row level: only fire for new rows that don't
            # already have a snkrdunk_apparel_id.
            "filter": record_filter,
        },
    }
    r = httpx.post(
        supabase_webhooks_url(project_ref),
        json=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        timeout=30,
    )
    if r.status_code >= 400:
        print(f"ERROR: {r.status_code} {r.text}", file=sys.stderr)
        r.raise_for_status()
    return r.json()


def delete_webhook(project_ref: str, token: str, webhook_id: int) -> None:
    r = httpx.delete(
        f"{supabase_webhooks_url(project_ref)}/{webhook_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    r.raise_for_status()


def gh_trigger_dispatch(gh_token: str, repo: str, event_type: str,
                        client_payload: dict | None = None) -> int:
    """Trigger a GitHub repository_dispatch event (used for testing
    the webhook end-to-end without a real DB insert)."""
    body = {"event_type": event_type}
    if client_payload:
        body["client_payload"] = client_payload
    r = httpx.post(
        gh_repo_dispatch_url(repo),
        json=body,
        headers={
            "Authorization": f"Bearer {gh_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout=15,
    )
    return r.status_code


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project-ref",
                    default=os.environ.get("SUPABASE_PROJECT_REF", ""),
                    help="Supabase project ref (e.g. uimoiutektarmjeoubem)")
    ap.add_argument("--supabase-token",
                    default=os.environ.get("SUPABASE_ACCESS_TOKEN", ""),
                    help="Supabase access token (sbp_... or personal access token)")
    ap.add_argument("--gh-repo",
                    default=os.environ.get("GH_REPO", "mhfong/tcg"),
                    help="owner/repo of the GitHub repo")
    ap.add_argument("--gh-token",
                    default=os.environ.get("GH_TOKEN", ""),
                    help="GitHub PAT (Fine-grained, Actions: Write on the repo)")
    ap.add_argument("--webhook-name", default="new-card-snkrdunk-discover",
                    help="Name for the new webhook")
    ap.add_argument("--list", action="store_true",
                    help="Just list existing webhooks and exit")
    ap.add_argument("--delete", type=int, default=0,
                    help="Delete webhook with this id, then exit")
    ap.add_argument("--test-dispatch", action="store_true",
                    help="Send a test repository_dispatch event (no DB insert)")
    args = ap.parse_args()

    if args.list:
        if not args.project_ref or not args.supabase_token:
            print("--list requires --project-ref and --supabase-token", file=sys.stderr)
            return 1
        for wh in list_existing_webhooks(args.project_ref, args.supabase_token):
            print(f"  id={wh.get('id')}  name={wh.get('name')}  table={wh.get('table')}  events={wh.get('events')}  enabled={wh.get('enabled')}")
        return 0

    if args.delete:
        if not args.project_ref or not args.supabase_token:
            print("--delete requires --project-ref and --supabase-token", file=sys.stderr)
            return 1
        delete_webhook(args.project_ref, args.supabase_token, args.delete)
        print(f"deleted webhook {args.delete}")
        return 0

    if args.test_dispatch:
        if not args.gh_token or not args.gh_repo:
            print("--test-dispatch requires --gh-token and --gh-repo", file=sys.stderr)
            return 1
        code = gh_trigger_dispatch(
            args.gh_token, args.gh_repo, "new-card",
            client_payload={"source": "setup_snkrdunk_webhook.py test"},
        )
        print(f"POST /repos/{args.gh_repo}/dispatches -> {code}")
        return 0 if code in (204, 200) else 1

    # Create
    if not args.project_ref or not args.supabase_token:
        print("--project-ref and --supabase-token required", file=sys.stderr)
        return 1
    if not args.gh_token or not args.gh_repo:
        print("--gh-token and --gh-repo required", file=sys.stderr)
        return 1

    # Check if a webhook with this name already exists
    existing = list_existing_webhooks(args.project_ref, args.supabase_token)
    for wh in existing:
        if wh.get("name") == args.webhook_name:
            print(f"webhook {args.webhook_name!r} already exists "
                  f"(id={wh.get('id')}).")
            print("Re-running this script is a no-op. Use --delete <id> first "
                  "to recreate.")
            return 0

    # We need a Supabase Edge Function URL to use as the webhook target.
    # The Edge Function (supabase/functions/snkrdunk-dispatch/index.ts)
    # receives the webhook payload, extracts the card_id, and POSTs to
    # GitHub's repository_dispatch API.
    #
    # Supabase Edge Function URLs follow this pattern:
    #   https://<project_ref>.supabase.co/functions/v1/<function_name>
    edge_fn_url = (
        f"https://{args.project_ref}.supabase.co/functions/v1/snkrdunk-dispatch"
    )
    print(f"Will create webhook pointing to: {edge_fn_url}")
    print()
    print("Prerequisites:")
    print("  1. Deploy the Edge Function (one-time):")
    print("       supabase functions deploy snkrdunk-dispatch --no-verify-jwt")
    print("  2. Set the GitHub PAT as a Supabase secret (one-time):")
    print("       supabase secrets set GITHUB_TOKEN=ghp_xxxxxxxxxxxx")
    print()
    resp = input("Continue? [y/N] ").strip().lower()
    if resp != "y":
        print("aborted")
        return 1

    # Create the webhook
    wh = create_webhook(
        args.project_ref,
        args.supabase_token,
        name=args.webhook_name,
        table="master_table",
        events=["INSERT"],
        http_url=edge_fn_url,
        http_headers=[],  # Edge Function does its own auth
        # Filter: only fire for rows where snkrdunk_apparel_id IS NULL.
        # PostgREST-style filter syntax.
        record_filter="snkrdunk_apparel_id=is.null",
    )
    print(f"created webhook id={wh.get('id')} name={wh.get('name')}")
    print()
    print("Test it with:")
    print(f"  python scripts/setup_snkrdunk_webhook.py --test-dispatch")
    print()
    print("Or insert a row directly:")
    print("  python scripts/discover_snkrdunk_ids.py --only-missing --apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
