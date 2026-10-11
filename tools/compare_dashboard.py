# tools/compare_dashboard.py
#
# PLAIN-ENGLISH WHAT THIS IS: proves the Home-screen copy that the app's brain
# published to Firestore (views/dashboard) is the same as what the brain would
# compute right now from the live sheet. It is READ-ONLY on both sides.
#
# How: (1) read the live sheet through the robot, (2) run the app's real
# Home-screen code locally on it, (3) read the published copy from Firestore,
# (4) compare them field by field and say what differs and by how much.
# Small differences are normal if a transaction arrived between the publish
# and now; big or structural differences mean something is wrong.
#
# Run:  python tools/compare_dashboard.py

import json
import os
import subprocess
import sys
import tempfile

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _auth  # noqa: E402
import sheets_api  # noqa: E402

TABS = ["Transactions", "Cash", "Debts", "DebtPayments", "Savings", "Goals", "Investments", "InvestmentInstruments",
        "SmartMemory", "TypeVotes", "NoteMemory", "FinancialEvents", "Budgets", "AILogs", "Credit_Card",
        "Transactions_Ignored", "LearnedSpamPatterns"]


def firestore_view(name):
    pid = _auth.project_id()
    url = "https://firestore.googleapis.com/v1/projects/%s/databases/(default)/documents/views/%s" % (pid, name)
    r = requests.get(url, headers={"Authorization": "Bearer " + _auth.access_token(["https://www.googleapis.com/auth/datastore"])}, timeout=60)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    f = r.json()["fields"]
    return {"json": f["json"]["stringValue"], "updatedAt": f.get("updatedAt", {}).get("timestampValue"),
            "reason": f.get("reason", {}).get("stringValue"), "bytes": int(f.get("bytes", {}).get("integerValue", 0))}


def diff(a, b, path="", out=None):
    out = [] if out is None else out
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            diff(a.get(k), b.get(k), path + "." + k, out)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append((path, "list length %d vs %d" % (len(a), len(b))))
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, "%s[%d]" % (path, i), out)
    elif a != b:
        out.append((path, "%r vs %r" % (str(a)[:40], str(b)[:40])))
    return out


def main():
    pub = firestore_view("dashboard")
    if pub is None:
        print("No published copy yet (views/dashboard does not exist). The timer or an action must publish first.")
        sys.exit(2)
    print("Published copy: %d bytes, updated %s, reason '%s'" % (pub["bytes"], pub["updatedAt"], pub["reason"]))

    with tempfile.TemporaryDirectory() as d:
        for tab in TABS:
            try:
                rows = sheets_api.read_tab(tab)
            except Exception:
                rows = []
            with open(os.path.join(d, tab + ".json"), "w", encoding="utf-8") as f:
                json.dump(rows, f)
        res = subprocess.run(["node", os.path.join(HERE, "dashboard_expected.js"), d],
                             capture_output=True, text=True, encoding="utf-8")
        if res.returncode != 0:
            print("Could not compute the expected screen:", res.stderr[:400])
            sys.exit(1)
    expected = json.loads(res.stdout)
    published = json.loads(pub["json"])

    d = diff(published, expected)
    print("\nCompared the published screen with what the code computes from the live sheet right now.")
    if not d:
        print("RESULT: IDENTICAL. The copy in Firestore is exact.")
    else:
        print("RESULT: %d differences (small ones are normal if something changed since the publish):" % len(d))
        for p, msg in d[:25]:
            print("  %-40s %s" % (p, msg))


if __name__ == "__main__":
    main()
