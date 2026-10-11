# tools/sheets_api.py
#
# PLAIN-ENGLISH WHAT THIS IS: the small toolbox every "fix live data" script
# uses to talk to the Google Sheet as the app's robot account. Reading is free;
# WRITING is only ever done by scripts that (1) take a backup first, (2) show
# you a plain-English preview, (3) wait for your approval, and (4) log what
# they changed. This file itself never decides to write anything.

import os
import sys
import urllib.parse

import requests

sys.path.insert(0, os.path.dirname(__file__))
import _auth  # noqa: E402

SHEET_ID = "1_vlmbWEg6KkFhU7uUdmtPBfVRP_VWDmOjzcCJxF2ruw"
API = "https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID
SCOPE_RW = "https://www.googleapis.com/auth/spreadsheets"


def _headers():
    return {"Authorization": "Bearer " + _auth.access_token([SCOPE_RW])}


def _quote(tab):
    return urllib.parse.quote("'" + tab.replace("'", "''") + "'")


def read_tab(tab, render="FORMATTED_VALUE"):
    """Whole tab as a list of rows (row 1 = header). Empty trailing cells are
    missing from each row, and empty rows come back as []."""
    r = requests.get(API + "/values/" + _quote(tab), headers=_headers(), timeout=120,
                     params={"valueRenderOption": render, "dateTimeRenderOption": "FORMATTED_STRING"})
    r.raise_for_status()
    return r.json().get("values", [])


def write_cells(updates):
    """updates: list of (a1_range, value). Writes plain values (no formulas)."""
    body = {"valueInputOption": "RAW",
            "data": [{"range": rng, "values": [[val]]} for rng, val in updates]}
    r = requests.post(API + "/values:batchUpdate", headers=_headers(), json=body, timeout=120)
    if r.status_code != 200:
        raise RuntimeError("write failed HTTP %s: %s" % (r.status_code, r.text[:300]))
    return r.json().get("totalUpdatedCells", 0)


def check_write_access():
    """Harmless test: rewrites Transactions!A1 with the value it already has."""
    current = read_tab("Transactions")[0][0]
    n = write_cells([("'Transactions'!A1", current)])
    return n == 1
