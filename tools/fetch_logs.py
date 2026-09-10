#!/usr/bin/env python3
"""Pull the practice log out of Firestore and write it where analytics.html
can read it.

The game writes with the public browser key, and firestore.rules deliberately
refuses reads to that key - so this needs a real credential. Two ways, in the
order it tries them:

  1. gcloud, if you have it and are logged in as someone with access:

         gcloud auth login
         python3 tools/fetch_logs.py --out log.json

     Nothing is written to disk and there is no key file to look after.

  2. A service account key, if gcloud is not around:

         # Firebase console -> Project settings -> Service accounts
         #                  -> Generate new private key
         export GOOGLE_APPLICATION_CREDENTIALS=~/cooper-spelling-sa.json
         python3 tools/fetch_logs.py --out log.json

     That file is a real credential. Keep it out of this repository - it is
     already covered by .gitignore, but it is worth keeping it somewhere else
     entirely.

Then open analytics.html and drop log.json onto it. The page reads the file in
the browser and sends nothing anywhere.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT = "cooper-spelling"
COLLECTION = "logs"
PAGE = 300


# ---------------------------------------------------------------------------
# credentials
# ---------------------------------------------------------------------------

def token_from_gcloud() -> str | None:
    try:
        out = subprocess.run(
            ["gcloud", "auth", "print-access-token"],
            capture_output=True, text=True, timeout=30,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    return out.stdout.strip() or None


def token_from_service_account(path: str) -> str | None:
    """Sign the usual JWT and swap it for an access token.

    Done by hand rather than with google-auth so this tool stays runnable in a
    checkout with nothing installed. If the crypto library is missing it says
    so and points at the one-line fix rather than failing obscurely.
    """
    try:
        import time
        import base64
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
    except ImportError:
        sys.exit("Reading a service account key needs the cryptography "
                 "package:\n    pip install cryptography\n"
                 "Or use gcloud instead - see the top of this file.")

    info = json.loads(Path(path).read_text(encoding="utf-8"))
    now = int(time.time())

    def segment(obj: dict) -> bytes:
        raw = json.dumps(obj, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=")

    header = segment({"alg": "RS256", "typ": "JWT"})
    claims = segment({
        "iss": info["client_email"],
        "scope": "https://www.googleapis.com/auth/datastore",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    })

    key = serialization.load_pem_private_key(info["private_key"].encode(), None)
    signature = key.sign(header + b"." + claims, padding.PKCS1v15(), hashes.SHA256())
    import base64 as b64
    jwt = (header + b"." + claims + b"."
           + b64.urlsafe_b64encode(signature).rstrip(b"="))

    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": jwt.decode(),
    }).encode()

    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())["access_token"]


def get_token() -> str:
    key_file = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if key_file and Path(key_file).exists():
        token = token_from_service_account(key_file)
        if token:
            return token

    token = token_from_gcloud()
    if token:
        return token

    sys.exit(
        "No credential found.\n\n"
        "  Either:  gcloud auth login\n"
        "  Or:      export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json\n\n"
        "The public key in js/logbook.js cannot be used here: firestore.rules\n"
        "denies reads to it on purpose, so that a log nobody should be able to\n"
        "read is not readable by anyone who views source on the game."
    )


# ---------------------------------------------------------------------------
# fetching
# ---------------------------------------------------------------------------

def untype(value):
    """Firestore's typed values back into plain ones."""
    if "stringValue" in value:    return value["stringValue"]
    if "integerValue" in value:   return int(value["integerValue"])
    if "doubleValue" in value:    return value["doubleValue"]
    if "booleanValue" in value:   return value["booleanValue"]
    if "nullValue" in value:      return None
    if "timestampValue" in value: return value["timestampValue"]
    if "arrayValue" in value:
        return [untype(v) for v in value["arrayValue"].get("values", [])]
    if "mapValue" in value:
        return {k: untype(v) for k, v in value["mapValue"].get("fields", {}).items()}
    return None


def fetch(project: str, collection: str, token: str, verbose: bool) -> list[dict]:
    base = ("https://firestore.googleapis.com/v1/projects/%s"
            "/databases/(default)/documents/%s" % (project, collection))

    records: list[dict] = []
    page_token = ""

    while True:
        params = {"pageSize": PAGE}
        if page_token:
            params["pageToken"] = page_token

        req = urllib.request.Request(base + "?" + urllib.parse.urlencode(params))
        req.add_header("Authorization", "Bearer " + token)

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read())
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", "replace")[:400]
            if err.code in (401, 403):
                sys.exit("Firestore refused the credential (%d).\n%s\n\n"
                         "The account needs read access to %s."
                         % (err.code, detail, project))
            sys.exit("Firestore returned %d:\n%s" % (err.code, detail))

        for doc in body.get("documents", []):
            record = {k: untype(v) for k, v in doc.get("fields", {}).items()}
            records.append(record)

        if verbose:
            print("  %d records so far…" % len(records), file=sys.stderr)

        page_token = body.get("nextPageToken", "")
        if not page_token:
            break

    # Oldest first, which is the order everything downstream assumes.
    records.sort(key=lambda r: (r.get("t") or 0, r.get("n") or 0))
    return records


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", default=PROJECT)
    ap.add_argument("--collection", default=COLLECTION)
    ap.add_argument("--out", default="log.json")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    token = get_token()
    records = fetch(args.project, args.collection, token, not args.quiet)

    Path(args.out).write_text(json.dumps(records), encoding="utf-8")

    kinds: dict[str, int] = {}
    for r in records:
        kinds[r.get("k", "?")] = kinds.get(r.get("k", "?"), 0) + 1
    devices = {r.get("d") for r in records if r.get("d")}
    rounds = {r.get("r") for r in records if r.get("r")}

    print("%d records -> %s" % (len(records), args.out))
    print("  %d rounds, %d devices, %s"
          % (len(rounds), len(devices),
             ", ".join("%d %s" % (n, k) for k, n in sorted(kinds.items()))))
    if not records:
        print("\nNothing there yet. If she has played since the logging went "
              "live, check the iPad has been online since.")
    else:
        print("\nNow open analytics.html and drop %s onto it." % args.out)


if __name__ == "__main__":
    main()
