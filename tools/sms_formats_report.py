# tools/sms_formats_report.py
#
# PLAIN-ENGLISH WHAT THIS IS: prints the shared library of anonymous bank SMS patterns (Firestore collection smsFormats), grouped by
# sender, with the ones the parser did NOT understand first. It is how a new bank (e.g. Bank of Baroda) is taught from real
# examples. The library holds no names, amounts, account numbers or links (see backend/smsFormats.js).
#
# Run:  python tools/sms_formats_report.py            (all senders)
#       python tools/sms_formats_report.py VM-BOBSMS  (one sender)

import os
import sys
import requests

sys.path.insert(0, os.path.dirname(__file__))
import _auth  # noqa: E402

SCOPE = "https://www.googleapis.com/auth/datastore"


def value(v):
    for k in ("stringValue", "integerValue", "doubleValue", "booleanValue"):
        if k in v:
            return v[k]
    return None


def main():
    only = sys.argv[1].lower() if len(sys.argv) > 1 else None
    base = "https://firestore.googleapis.com/v1/projects/%s/databases/(default)/documents/smsFormats" % _auth.project_id()
    headers = {"Authorization": "Bearer " + _auth.access_token([SCOPE])}
    docs, token = [], None
    while True:
        r = requests.get(base, headers=headers, params={"pageSize": 300, **({"pageToken": token} if token else {})}, timeout=60)
        r.raise_for_status()
        body = r.json()
        docs += body.get("documents", [])
        token = body.get("nextPageToken")
        if not token:
            break
    rows = []
    for d in docs:
        f = {k: value(v) for k, v in d.get("fields", {}).items()}
        rows.append(f)
    by = {}
    for f in rows:
        if only and str(f.get("sender", "")).lower() != only:
            continue
        by.setdefault(f.get("sender", "?"), []).append(f)
    if not by:
        print("No patterns yet.")
        return
    for sender in sorted(by, key=lambda s: -sum(int(x.get("uncertain", 0) or 0) for x in by[s])):
        items = sorted(by[sender], key=lambda x: -int(x.get("uncertain", 0) or 0))
        print("\n=== %s  (%d pattern(s), %d message(s), %d not understood)" % (
            sender, len(items), sum(int(x.get("seen", 0) or 0) for x in items), sum(int(x.get("uncertain", 0) or 0) for x in items)))
        for x in items:
            print("  seen %s | not understood %s | missing amount %s type %s payee %s ref %s | bank=%s mode=%s type=%s" % (
                x.get("seen", 0), x.get("uncertain", 0), x.get("missingAmount", 0), x.get("missingType", 0), x.get("missingPayee", 0),
                x.get("missingReference", 0), x.get("bank", ""), x.get("mode", ""), x.get("type", "")))
            print("    " + str(x.get("template", "")))


if __name__ == "__main__":
    main()
