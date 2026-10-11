# tools/category_backfill.py
#
# PLAIN-ENGLISH WHAT THIS IS: fixes noted payments that have no category
# (found 59 of them in September, caused by the old dropdown bug), using the
# app's own guessing code plus the words you typed in your notes.
#
# THE SAFE ROUTINE (nothing is skipped):
#   1. python tools/category_backfill.py preview
#        - takes a fresh full backup of the sheet (saved on this computer),
#        - works out what it WOULD fill in, prints it in plain English,
#        - saves the proposal to local-data/pending-changes/ and CHANGES NOTHING.
#   2. You read the preview and say yes.
#   3. python tools/category_backfill.py apply
#        - re-reads the live sheet and only writes a row if it is STILL blank
#          and still has the same note (so it can never overwrite your work),
#        - writes ONLY the Category cell (column N) of those rows,
#        - re-reads to verify, and logs every change to local-data/audit/.
#   It never touches the app's memory (SmartMemory etc.): these are guesses,
#   not your confirmations, so the app must not learn from them.

import collections
import datetime
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import sheets_api  # noqa: E402

PENDING = os.path.join(ROOT, "local-data", "pending-changes", "category_backfill.json")
AUDIT = os.path.join(ROOT, "local-data", "audit", "changes.jsonl")
CATEGORY_COL = "N"  # Transactions column N = Category


def preview():
    print("Step 1/3  taking a fresh full backup first...")
    subprocess.run([sys.executable, os.path.join(HERE, "sheets_backup.py")], check=True)

    print("\nStep 2/3  reading the live sheet...")
    snap = {"Transactions": sheets_api.read_tab("Transactions"), "SmartMemory": sheets_api.read_tab("SmartMemory")}
    snap_path = os.path.join(ROOT, "local-data", "pending-changes", "snapshot.json")
    os.makedirs(os.path.dirname(snap_path), exist_ok=True)
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(snap, f)

    print("Step 3/3  working out the categories with the app's own code...")
    res = subprocess.run(["node", os.path.join(HERE, "backfill_preview.js"), snap_path],
                         capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0:
        print(res.stderr[:600])
        sys.exit(1)
    proposals = json.loads(res.stdout)
    with open(PENDING, "w", encoding="utf-8") as f:
        json.dump({"made": datetime.datetime.now().isoformat(timespec="seconds"), "changes": proposals}, f, indent=1)

    by = collections.Counter(p["category"] for p in proposals)
    money = collections.defaultdict(float)
    for p in proposals:
        money[p["category"]] += p["amount"]
    print("\n===== PREVIEW (nothing has been changed) =====")
    print("%d payments have a note but no category. Proposed:" % len(proposals))
    for cat, n in by.most_common():
        print("  %-10s %3d payments  Rs%s" % (cat, n, format(round(money[cat]), ",")))
    print("\nThe ones the app is least sure about (it fell back to 'Other'):")
    for p in proposals:
        if p["category"] == "Other":
            print("  row %-4d %-34s Rs%s" % (p["row"], '"' + p["note"][:32] + '"', format(round(p["amount"]), ",")))
    print("\nSaved to local-data/pending-changes/category_backfill.json")
    print("If this looks right, run:  python tools/category_backfill.py apply")


def apply():
    if not os.path.exists(PENDING):
        print("No preview found. Run 'preview' first.")
        sys.exit(1)
    changes = json.load(open(PENDING, encoding="utf-8"))["changes"]
    live = sheets_api.read_tab("Transactions")

    to_write, skipped = [], []
    for c in changes:
        idx = c["row"] - 1
        row = live[idx] if idx < len(live) else []
        note = (row[12] if len(row) > 12 else "").strip()
        cat = (row[13] if len(row) > 13 else "").strip()
        if cat or note != c["note"].strip():
            skipped.append(c)  # changed since the preview: leave it alone
            continue
        to_write.append(c)

    if not to_write:
        print("Nothing to write (all rows changed or already fixed since the preview).")
        return
    updates = [("'Transactions'!%s%d" % (CATEGORY_COL, c["row"]), c["category"]) for c in to_write]
    n = sheets_api.write_cells(updates)

    after = sheets_api.read_tab("Transactions")
    ok = 0
    os.makedirs(os.path.dirname(AUDIT), exist_ok=True)
    stamp = datetime.datetime.now().isoformat(timespec="seconds")
    with open(AUDIT, "a", encoding="utf-8") as log:
        for c in to_write:
            row = after[c["row"] - 1]
            got = row[13] if len(row) > 13 else ""
            good = got == c["category"]
            ok += good
            log.write(json.dumps({"time": stamp, "tool": "category_backfill", "tab": "Transactions",
                                  "cell": CATEGORY_COL + str(c["row"]), "old": "", "new": c["category"],
                                  "note": c["note"], "verified": good}) + "\n")
    print("Wrote %d cells. Verified %d of %d by reading them back." % (n, ok, len(to_write)))
    if skipped:
        print("Left %d rows alone because they changed since the preview." % len(skipped))
    print("Every change is logged in local-data/audit/changes.jsonl")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "preview":
        preview()
    elif mode == "apply":
        apply()
    else:
        print("Usage: python tools/category_backfill.py preview | apply")
