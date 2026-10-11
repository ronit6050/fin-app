# tools/ignore_rows.py
#
# PLAIN-ENGLISH WHAT THIS IS: removes junk or duplicate rows from the live
# Transactions sheet the SAME safe way the app's "Not a transaction" button does:
#   1. the full row is copied to the Transactions_Ignored tab (nothing is lost),
#   2. optionally the message is "learned" as junk so the SMS reader ignores
#      identical junk in future (only ever used for messages the reader was
#      already unsure about - never for a real transaction's text),
#   3. the row is cleared IN PLACE (not deleted - deleting would shift every row
#      below it) and column P is set to IGNORED so the row can never look empty.
# Before touching a row it re-reads the live sheet and checks the amount and
# merchant still match what you expect, so a shifted row can never be hit.
#
# Usage:
#   python tools/ignore_rows.py preview ROW:AMOUNT:MERCHANT_START:learn|nolearn ...
#   python tools/ignore_rows.py apply   ROW:AMOUNT:MERCHANT_START:learn|nolearn ...
# (AMOUNT may be empty, e.g. 986::NEEDS REVIEW:learn). A fresh backup is taken first.

import datetime
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sheets_api  # noqa: E402

REPO = os.path.dirname(HERE)
AUDIT = os.path.join(REPO, "local-data", "audit", "changes.jsonl")
LAST_COL_LETTER = "T"   # Transactions uses columns A..T


def parse_args(items):
    out = []
    for it in items:
        parts = it.split(":")
        if len(parts) != 4:
            sys.exit("Bad argument %r - expected ROW:AMOUNT:MERCHANT_START:learn|nolearn" % it)
        out.append({"row": int(parts[0]), "amount": parts[1], "cp": parts[2], "learn": parts[3] == "learn"})
    return out


def fingerprint_template(text):
    """The reader's own normalizer (copied byte-for-byte from Code.js, run by Node)."""
    js = ("const f=(t)=>(t||'').toString().toLowerCase().replace(/https?:\\/\\/\\S+/g,'<URL>')"
          ".replace(/\\d+/g,'<NUM>').replace(/\\s+/g,' ').trim();"
          "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(f(s)));")
    return subprocess.run(["node", "-e", js], input=text.encode("utf8"), capture_output=True, check=True).stdout.decode("utf8")


def audit(entry):
    os.makedirs(os.path.dirname(AUDIT), exist_ok=True)
    entry["time"] = datetime.datetime.now().isoformat(timespec="seconds")
    entry["tool"] = "ignore_rows"
    with open(AUDIT, "a", encoding="utf8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ("preview", "apply"):
        sys.exit(__doc__)
    mode = sys.argv[1]
    wanted = parse_args(sys.argv[2:])

    if mode == "apply":
        print("Taking a fresh backup first...")
        subprocess.run([sys.executable, os.path.join(HERE, "sheets_backup.py")], check=True, stdout=subprocess.DEVNULL)

    rows = sheets_api.read_tab("Transactions")
    plan = []
    for w in wanted:
        if w["row"] < 2 or w["row"] > len(rows):
            sys.exit("Row %d is outside the sheet." % w["row"])
        r = rows[w["row"] - 1] + [""] * (20 - len(rows[w["row"] - 1]))
        amount_ok = (str(r[5]).strip() == w["amount"].strip())
        cp_ok = str(r[7]).strip().lower().startswith(w["cp"].strip().lower())
        if not (amount_ok and cp_ok):
            sys.exit("STOP: row %d is not what was expected (amount %r, merchant %r) - nothing was changed." % (w["row"], r[5], r[7]))
        if str(r[15]).strip() == "IGNORED":
            sys.exit("STOP: row %d is already IGNORED." % w["row"])
        plan.append((w, r))

    print("\n===== %s =====" % ("PREVIEW (nothing changed)" if mode == "preview" else "APPLYING"))
    for w, r in plan:
        print("row %d | %s %s | %s %s | amount %r | merchant %r | learn-as-junk: %s" % (
            w["row"], r[0], r[1], r[3], r[4], r[5], str(r[7]).replace("\n", " ")[:50], "yes" if w["learn"] else "no"))
        print("     message: %r" % str(r[10])[:140])
    if mode == "preview":
        return

    for w, r in plan:
        n = w["row"]
        sheets_api.append_row("Transactions_Ignored", r[:20])
        if w["learn"] and str(r[10]).strip() and str(r[11]).strip():
            template = fingerprint_template(str(r[10]))
            if len(template) >= 20:
                sheets_api.append_row("LearnedSpamPatterns", [datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), str(r[11]), template, str(r[10])])
        cells = []
        for idx in range(20):
            col = chr(ord("A") + idx)
            cells.append(("'Transactions'!%s%d" % (col, n), "IGNORED" if idx == 15 else ""))
        sheets_api.write_cells(cells)
        audit({"row": n, "archived_to": "Transactions_Ignored", "learned": w["learn"], "old_amount": r[5], "old_merchant": r[7], "old_message": str(r[10])[:200]})

    # read back to prove it
    after = sheets_api.read_tab("Transactions")
    for w, _ in plan:
        r = after[w["row"] - 1] + [""] * (20 - len(after[w["row"] - 1]))
        ok = str(r[15]).strip() == "IGNORED" and not any(str(x).strip() for i, x in enumerate(r[:20]) if i != 15)
        print("row %d is now %s" % (w["row"], "an IGNORED placeholder - OK" if ok else "NOT as expected - CHECK"))


if __name__ == "__main__":
    main()
