# tools/sheets_backup.py
#
# PLAIN-ENGLISH WHAT THIS IS: takes a complete copy of every tab of the live
# Google Sheet and saves it on THIS computer (never in git), so we can always
# go back. Read-only: the robot is only given permission to read the sheet.
#
# Saves, per tab, two files in local-data/backups/<date-time>/ :
#   <tab>.shown.json  - values exactly as the sheet displays them
#   <tab>.raw.json    - raw values (dates/times as numbers) for exact migration
# plus manifest.json (tab names + row counts). Prints only counts.
#
# Run:  python tools/sheets_backup.py
# Optional:  --sheet-id <id>   (default is the app's spreadsheet)

import argparse
import datetime
import json
import os
import sys
import urllib.parse

import requests

sys.path.insert(0, os.path.dirname(__file__))
import _auth  # noqa: E402

# Same id the SMS reader already uses (it is already in the public repo and
# is not a secret on its own - the sheet is still private).
DEFAULT_SHEET_ID = "1_vlmbWEg6KkFhU7uUdmtPBfVRP_VWDmOjzcCJxF2ruw"
API = "https://sheets.googleapis.com/v4/spreadsheets/"
SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet-id", default=DEFAULT_SHEET_ID)
    args = ap.parse_args()

    headers = {"Authorization": "Bearer " + _auth.access_token([SCOPE])}

    meta = requests.get(API + args.sheet_id, params={"fields": "sheets.properties.title"}, headers=headers, timeout=60)
    if meta.status_code != 200:
        print("Could not open the sheet. HTTP", meta.status_code)
        print(meta.json().get("error", {}).get("message", "")[:300])
        print("Most likely: the sheet is not shared with the robot yet, or the Google Sheets API is not enabled.")
        sys.exit(1)
    tabs = [s["properties"]["title"] for s in meta.json()["sheets"]]

    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    out_dir = os.path.join(os.path.dirname(__file__), "..", "local-data", "backups", stamp)
    os.makedirs(out_dir, exist_ok=True)

    manifest = {}
    for render, label in (("FORMATTED_VALUE", "shown"), ("UNFORMATTED_VALUE", "raw")):
        for tab in tabs:
            rng = urllib.parse.quote("'" + tab.replace("'", "''") + "'")
            r = requests.get(
                API + args.sheet_id + "/values/" + rng,
                params={"valueRenderOption": render, "dateTimeRenderOption": "FORMATTED_STRING" if render == "FORMATTED_VALUE" else "SERIAL_NUMBER"},
                headers=headers, timeout=120,
            )
            if r.status_code != 200:
                print("FAILED reading tab", tab, "HTTP", r.status_code)
                sys.exit(1)
            values = r.json().get("values", [])
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in tab)
            with open(os.path.join(out_dir, safe + "." + label + ".json"), "w", encoding="utf-8") as f:
                json.dump(values, f, ensure_ascii=False)
            if label == "shown":
                manifest[tab] = len(values)

    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"taken": stamp, "rowsPerTab_includingHeader": manifest}, f, indent=2)

    print("Backup saved to local-data/backups/" + stamp)
    for tab, n in manifest.items():
        print("  %-24s %6d rows (including header)" % (tab, n))


if __name__ == "__main__":
    main()
