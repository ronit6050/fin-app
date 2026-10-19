# tools/admin_review.py
#
# PLAIN-ENGLISH WHAT THIS IS: the helper for the "every 3 days, look at the admin console's Problems list" routine.
#   python tools/admin_review.py list                 -> prints every open problem (id, how often, which screen, cleaned message)
#   python tools/admin_review.py resolve ID [ID...]   -> marks those problems resolved (same as the admin page's Resolve button;
#                                                        a problem that happens again afterwards comes back by itself)
#   python tools/admin_review.py report FILE.json     -> publishes the review report that the admin page shows
#
# Report file shape: {"items":[{"msg":"...","screen":"...","count":8,"status":"fixed|not_fixed|watching","note":"plain words"}]}
# found / fixed / notFixed are counted from the items. Only cleaned text (no amounts, notes, payees) may go in; the problem
# messages already are cleaned by the server. Uses the robot key in ~/.fin-app (never printed).

import datetime
import json
import os
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(__file__))
import _auth  # noqa: E402

SCOPE = "https://www.googleapis.com/auth/datastore"
DAY_MS = 86400000


def base():
    return "https://firestore.googleapis.com/v1/projects/%s/databases/(default)/documents" % _auth.project_id()


def headers():
    return {"Authorization": "Bearer " + _auth.access_token([SCOPE])}


def num(v):
    if not isinstance(v, dict):
        return 0
    for k in ("integerValue", "doubleValue"):
        if k in v:
            return int(float(v[k]))
    return 0


def list_problems():
    out, token = [], None
    while True:
        params = {"pageSize": 300}
        if token:
            params["pageToken"] = token
        r = requests.get(base() + "/adminErrors", headers=headers(), params=params, timeout=60)
        r.raise_for_status()
        j = r.json()
        out += j.get("documents", [])
        token = j.get("nextPageToken")
        if not token:
            return out


def open_problems():
    now = int(time.time() * 1000)
    rows = []
    for d in list_problems():
        f = d.get("fields", {})
        last, resolved = num(f.get("lastMs")), num(f.get("resolvedAtMs"))
        week = 0
        for i in range(7):
            day = (datetime.datetime.utcfromtimestamp((now - i * DAY_MS) / 1000.0) + datetime.timedelta(hours=5, minutes=30)).strftime("%Y%m%d")
            week += num(f.get("d_" + day))
        if week > 0 and not (resolved > 0 and resolved > last):
            rows.append({
                "id": d["name"].split("/")[-1],
                "kind": f.get("kind", {}).get("stringValue", ""),
                "screen": f.get("screen", {}).get("stringValue", ""),
                "msg": f.get("msg", {}).get("stringValue", ""),
                "last7": week,
                "people": len([k for k in f if k.startswith("u_")]),
                "lastMs": last,
            })
    return sorted(rows, key=lambda x: (-x["last7"], -x["lastMs"]))


def cmd_list():
    rows = open_problems()
    if not rows:
        print("No open problems in the last 7 days.")
    for r in rows:
        hrs = (time.time() * 1000 - r["lastMs"]) / 3600000.0
        print("%s | %dx | %d people | %s/%s | last %.0f h ago | %s" % (r["id"], r["last7"], r["people"], r["kind"], r["screen"], hrs, r["msg"]))


def cmd_resolve(ids):
    for i in ids:
        url = base() + "/adminErrors/" + i + "?updateMask.fieldPaths=resolvedAtMs"
        r = requests.patch(url, headers=headers(), timeout=60, json={"fields": {"resolvedAtMs": {"integerValue": str(int(time.time() * 1000))}}})
        print(i, "resolved" if r.status_code == 200 else "FAILED HTTP %d" % r.status_code)


def cmd_report(path):
    with open(path, "r", encoding="utf-8") as fh:
        rep = json.load(fh)
    items = rep.get("items", [])[:40]
    for it in items:   # keep it small and plain text only
        it["msg"] = str(it.get("msg", ""))[:160]
        it["screen"] = str(it.get("screen", ""))[:60]
        it["note"] = str(it.get("note", ""))[:240]
        it["count"] = int(it.get("count", 0))
        if it.get("status") not in ("fixed", "not_fixed", "watching"):
            it["status"] = "not_fixed"
    now = int(time.time() * 1000)
    body = {
        "runAtMs": now, "nextDueMs": now + 3 * DAY_MS, "found": len(items),
        "fixed": len([i for i in items if i["status"] == "fixed"]),
        "notFixed": len([i for i in items if i["status"] == "not_fixed"]),
        "watching": len([i for i in items if i["status"] == "watching"]),
        "items": items,
    }
    r = requests.patch(base() + "/adminReview/latest", headers=headers(), timeout=60, json={"fields": {"json": {"stringValue": json.dumps(body)}}})
    print("report published" if r.status_code == 200 else "FAILED HTTP %d %s" % (r.status_code, r.text[:200]))
    print("found %d, fixed %d, not fixed %d, watching %d" % (body["found"], body["fixed"], body["notFixed"], body["watching"]))


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["list"]:
        cmd_list()
    elif a[:1] == ["resolve"] and len(a) > 1:
        cmd_resolve(a[1:])
    elif a[:1] == ["report"] and len(a) == 2:
        cmd_report(a[1])
    else:
        print(__doc__)
