# tools/firestore_ping.py
#
# PLAIN-ENGLISH WHAT THIS IS: a 5-second connection test. It writes one tiny
# test note into the new Firestore database, reads it back, then deletes it.
# If this prints three OKs, the robot account and the database are set up
# correctly. It touches no real data (only a throwaway "_health/ping" note).
#
# Run:  python tools/firestore_ping.py

import datetime
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(__file__))
import _auth  # noqa: E402

SCOPE = "https://www.googleapis.com/auth/datastore"


def main():
    pid = _auth.project_id()
    base = "https://firestore.googleapis.com/v1/projects/%s/databases/(default)/documents/_health/ping" % pid
    headers = {"Authorization": "Bearer " + _auth.access_token([SCOPE])}
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    w = requests.patch(base, headers=headers, timeout=60, json={"fields": {
        "at": {"timestampValue": now}, "note": {"stringValue": "phase 0 connection test"}}})
    if w.status_code != 200:
        print("WRITE FAILED, HTTP", w.status_code, w.json().get("error", {}).get("message", "")[:300])
        print("Most likely: the Firestore database is not created yet, or the robot lacks the 'Cloud Datastore User' role.")
        sys.exit(1)
    print("OK 1/3  wrote a test note to Firestore (project %s)" % pid)

    r = requests.get(base, headers=headers, timeout=60)
    if r.status_code != 200 or r.json().get("fields", {}).get("note", {}).get("stringValue") != "phase 0 connection test":
        print("READ FAILED, HTTP", r.status_code)
        sys.exit(1)
    print("OK 2/3  read it back")

    d = requests.delete(base, headers=headers, timeout=60)
    if d.status_code not in (200, 204):
        print("DELETE FAILED, HTTP", d.status_code)
        sys.exit(1)
    print("OK 3/3  deleted it. Firestore is ready.")


if __name__ == "__main__":
    main()
