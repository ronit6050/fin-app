# tools/_auth.py
#
# PLAIN-ENGLISH WHAT THIS IS: the one place that knows how to sign in as
# the app's "robot" Google account (a service account). Every helper script
# in this folder uses it, so the key file is only ever touched here.
#
# SAFETY RULES (see CLAUDE.md, "DECISION RECORD - v2 foundation"):
# - The key file lives OUTSIDE the repo, by default at
#   C:\Users\<you>\.fin-app\claude-sa-key.json  (override with the
#   FIN_APP_SA_KEY environment variable).
# - Nothing in here ever prints the key or any part of it.
# - The scope you ask for decides what the robot can do for that call:
#   "spreadsheets.readonly" can only READ the sheet.

import json
import os

from google.auth.transport.requests import Request
from google.oauth2 import service_account

DEFAULT_KEY = os.path.join(os.path.expanduser("~"), ".fin-app", "claude-sa-key.json")


def key_path():
    return os.environ.get("FIN_APP_SA_KEY", DEFAULT_KEY)


def project_id():
    with open(key_path(), "r", encoding="utf-8") as f:
        return json.load(f)["project_id"]


def robot_email():
    with open(key_path(), "r", encoding="utf-8") as f:
        return json.load(f)["client_email"]


def access_token(scopes):
    creds = service_account.Credentials.from_service_account_file(key_path(), scopes=scopes)
    creds.refresh(Request())
    return creds.token
