# tools/rules_privacy_test.py
#
# PLAIN-ENGLISH WHAT THIS IS: a LIVE test of the privacy rules. It makes up two test identities
# (stand-ins for "the owner" and "a friend"), signs each in to Firebase for real, and tries to read
# and write each other's folders against the real, published rules. It prints only PASS/FAIL and
# HTTP codes, never any of the data it was refused or allowed.
#
# How the test identities work: the robot account can mint a sign-in token that carries an email
# claim. The rules read that claim exactly as they would for a real Google sign-in
# (request.auth.token.email / email_verified), so this exercises the real rules.
#
# Nothing is written: every write attempt below is EXPECTED to be refused. Run:
#   python tools/rules_privacy_test.py

import json
import os
import sys
import time

import requests
from google.auth import crypt as gcrypt
from google.auth import jwt as gjwt

sys.path.insert(0, os.path.dirname(__file__))
import _auth  # noqa: E402

API_KEY = "AIzaSyA6hs87aWKZrPdaUe1mG9rEUUfVOAnQpCg"      # the app's public web key (also in index.html)
OWNER = "ronitnadar9@gmail.com"
FRIEND = "privacy-test-friend@example.com"
STRANGER = "privacy-test-stranger@example.com"


def key():
    with open(_auth.key_path(), "r", encoding="utf-8") as f:
        return json.load(f)


def id_token(email, verified=True):
    k = key()
    now = int(time.time())
    claims = {"iss": k["client_email"], "sub": k["client_email"], "aud": "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
              "iat": now, "exp": now + 3000, "uid": "test-" + email.split("@")[0],
              "claims": {"email": email, "email_verified": verified}}
    custom = gjwt.encode(gcrypt.RSASigner.from_service_account_info(k), claims).decode("ascii")
    r = requests.post("https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + API_KEY,
                      json={"token": custom, "returnSecureToken": True}, timeout=60)
    r.raise_for_status()
    return r.json()["idToken"]


def base():
    return "https://firestore.googleapis.com/v1/projects/%s/databases/(default)/documents" % _auth.project_id()


failures = 0


def expect(label, got, want):
    global failures
    ok = got == want
    failures += 0 if ok else 1
    print(("PASS  " if ok else "FAIL  ") + label + "  (HTTP %s, expected %s)" % (got, want))


def read(token, path):
    return requests.get(base() + "/" + path + "?pageSize=1", headers={"Authorization": "Bearer " + token} if token else {}, timeout=60).status_code


def write(token, path):
    return requests.patch(base() + "/" + path, headers={"Authorization": "Bearer " + token}, json={"fields": {"x": {"stringValue": "should-never-land"}}}, timeout=60).status_code


own = id_token(OWNER)
friend = id_token(FRIEND)
stranger = id_token(STRANGER)
unverified = id_token(OWNER, verified=False)

COLLS = ["transactions", "cash", "debts", "savings", "goals", "investments", "instruments", "financialEvents", "budgets",
         "smartMemory", "typeVotes", "noteMemory", "learnedSpamPatterns", "transactionsIgnored", "friends"]

print("--- the owner reads the owner's own data ---")
for c in COLLS:
    expect("owner reads their own %s" % c, read(own, "users/%s/%s" % (OWNER, c)), 200)

print("\n--- a friend / a stranger / nobody reads the owner's data ---")
for c in COLLS:
    expect("friend is refused the owner's %s" % c, read(friend, "users/%s/%s" % (OWNER, c)), 403)
expect("stranger is refused the owner's transactions", read(stranger, "users/%s/transactions" % OWNER), 403)
expect("someone not signed in is refused", read(None, "users/%s/transactions" % OWNER), 403)
expect("the owner's email WITHOUT being verified is refused", read(unverified, "users/%s/transactions" % OWNER), 403)

print("\n--- the friend reads only their own folder ---")
expect("friend reads their own folder", read(friend, "users/%s/transactions" % FRIEND), 200)
expect("friend cannot read the stranger's folder", read(friend, "users/%s/transactions" % STRANGER), 403)
expect("friend cannot list every user", read(friend, "users"), 403)

print("\n--- nobody can write from a phone, not even the owner ---")
expect("owner cannot write to their own transactions", write(own, "users/%s/transactions/should-never-land" % OWNER), 403)
expect("owner cannot write a split", write(own, "users/%s/friends/should-never-land" % OWNER), 403)
expect("friend cannot write into the owner's folder", write(friend, "users/%s/transactions/should-never-land" % OWNER), 403)
expect("friend cannot write into their own folder", write(friend, "users/%s/transactions/should-never-land" % FRIEND), 403)
expect("owner cannot write to the Home copy", write(own, "views/should-never-land"), 403)

print("\n--- the Home copy is the owner's only ---")
expect("owner reads the Home copy", read(own, "views"), 200)
expect("friend is refused the Home copy", read(friend, "views"), 403)

print("\n--- SMS keys (added 2026-10-13): the lookup list is closed to everyone, a key folder is readable only by its own person ---")
expect("owner cannot read the key lookup list", read(own, "ingestKeys"), 403)
expect("friend cannot read the key lookup list", read(friend, "ingestKeys"), 403)
expect("nobody signed in cannot read the key lookup list", read(None, "ingestKeys"), 403)
expect("friend cannot read the owner's key folder", read(friend, "users/%s/ingest" % OWNER), 403)
expect("stranger cannot read the friend's key folder", read(stranger, "users/%s/ingest" % FRIEND), 403)
expect("friend CAN read their own key folder", read(friend, "users/%s/ingest" % FRIEND), 200)
expect("friend cannot write a key", write(friend, "ingestKeys/should-never-land"), 403)
expect("friend cannot write into their key folder", write(friend, "users/%s/ingest/should-never-land" % FRIEND), 403)

print("\n--- Shared bank-SMS pattern library (added 2026-10-13): closed to every phone, even the owner's ---")
expect("owner's phone cannot read the SMS pattern library", read(own, "smsFormats"), 403)
expect("friend cannot read the SMS pattern library", read(friend, "smsFormats"), 403)
expect("nobody signed in cannot read it", read(None, "smsFormats"), 403)
expect("friend cannot write a pattern", write(friend, "smsFormats/should-never-land"), 403)

print("\n--- The new server's shared switches (added 2026-10-14): closed to every phone ---")
expect("owner's phone cannot read the shared switches", read(own, "_system"), 403)
expect("friend cannot read the shared switches", read(friend, "_system"), 403)
expect("nobody signed in cannot read them", read(None, "_system"), 403)
expect("owner's phone cannot change them", write(own, "_system/props"), 403)

print("\n%s" % ("ALL PRIVACY CHECKS PASSED" if failures == 0 else "%d FAILED" % failures))
sys.exit(1 if failures else 0)
