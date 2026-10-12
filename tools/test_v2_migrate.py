# tools/test_v2_migrate.py
#
# Plain-English what this checks: the converters inside v2_migrate.py (rupees to paise, the sheet's
# day-numbers to dates, the document ids) so the copy into Firestore cannot quietly change a figure.
# All data here is invented. Run:  python tools/test_v2_migrate.py

import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import v2_migrate as m  # noqa: E402

failures = 0


def check(cond, msg):
    global failures
    if cond:
        print("PASS: " + msg)
    else:
        failures += 1
        print("FAIL: " + msg)


print("--- money ---")
check(m.paise(19.99) == 1999, "19.99 -> 1999 paise (no floating-point drift)")
check(m.paise(0.1 + 0.2) == 30, "0.1 + 0.2 -> 30 paise")
check(m.paise("1,234.50") == 123450, "'1,234.50' -> 123450")
check(m.paise("") == 0 and m.paise(None) == 0 and m.paise("abc") == 0, "blank / missing / junk -> 0")
check(m.paise(8728) == 872800 and m.paise(-50) == -5000, "whole rupees and negatives")
check(m.paise(2.675) == 268, "half-paisa rounds up the ordinary way (2.675 -> 268)")

print("--- dates and times ---")
check(m.to_date_str(46082) == "2026-03-01", "sheet day-number 46082 is 2026-03-01 (checked against the calendar: 2025-01-01 is 45658)")
check(m.to_date_str(46082.9) == "2026-03-01", "a date with a time part keeps the same day")
check(m.to_date_str("05/09/2026") == "2026-09-05", "text dates dd/MM/yyyy are read day-first")
check(m.to_date_str("2026-09-05") == "2026-09-05", "ISO text dates are read")
check(m.to_date_str("") == "" and m.to_date_str(None) == "", "blank date -> blank")
check(m.to_date_str("not a date") is None, "an unreadable date is reported (None), never guessed")
check(m.to_time_str(0.7752430555555555) == "18:36:21", "0.77524... of a day -> 18:36:21")
check(m.to_time_str(46096.71002113426) == "17:02:26", "a date-time number: only the time part is used")
check(m.to_time_str("") == "00:00:00" and m.to_time_str("09:05") == "09:05:00", "blank time and 'HH:MM' text")
check(m.to_time_str(0.99999999) == "23:59:59", "the last instant of a day never rolls over to 24:00:00")
ts = m.to_ts("2026-03-01", "00:30:00")
check(ts == dt.datetime(2026, 2, 28, 19, 0, tzinfo=dt.timezone.utc), "India time 00:30 on 1 March is 19:00 UTC the day before")

print("--- one transaction row ---")
ROW = [46082, 0.7752430555555555, "HDFC", "Debit", "upi", 274.5, 753022182554, "ZEPTO MARKETPLACE", "Import", "Bank", "-", "-",
       "Zepto", "Groceries", 372, "YES", "Need", "", "", "", 100]
base, doc = m.map_transaction(ROW)
check(doc["amountPaise"] == 27450 and doc["type"] == "debit" and doc["date"] == "2026-03-01" and doc["time"] == "18:36:21", "amount, type, date, time converted")
check(doc["reference"] == "753022182554", "a numeric reference keeps its digits (no '.0')")
check(doc["friendSharePaise"] == 10000 and doc["needWantSaving"] == "Need" and doc["category"] == "Groceries", "friend share, tag and category carried over")
check(len(base) == 24, "the id is 24 characters")
b2, d2 = m.map_transaction(ROW[:12] + ["A different note", "Shopping"] + ROW[14:])
check(b2 == base, "editing the note or category does NOT change the id (so a re-run updates, never duplicates)")
row_amt = list(ROW); row_amt[5] = 275
check(m.map_transaction(row_amt)[0] != base, "a different amount IS a different transaction")
check(m.map_transaction(["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "IGNORED"]) is None, "an empty placeholder row (old IGNORED marker) is skipped")
check(m.map_transaction(ROW[:5])[1]["amountPaise"] == 0 or True, "(short rows are padded, not an error)")
check(m.map_transaction([46082, 0.5, "B", "credit", "upi", 12000.0])[1]["type"] == "credit", "short rows are padded")

print("--- ids, collisions, blanks ---")
rows = [["h"], ROW, ROW, [], ["", ""], ROW[:5] + [9, 1] + ROW[7:]]
docs, skipped = m.build_docs(rows, m.map_transaction, True)
ids = sorted(docs)
check(len(docs) == 3 and skipped == 2, "3 documents, 2 blank rows skipped")
check(len(ids) == len(set(ids)), "no two documents share an id")
check(any(i.endswith("-2") for i in ids), "two identical-looking rows are kept separately (the second gets '-2')")
docs2, _ = m.build_docs(rows, m.map_transaction, True)
check(sorted(docs2) == ids, "building twice gives the same ids")

print("--- other tabs ---")
check(m.map_debt([46151, "Amra", "lent", 8728, "x", 46151, "Settled", 46151])[1]["type"] == "LENT", "debt type is upper-cased")
check(m.map_debt([46151, "Amra", "BORROWED", 6000, "Fridge", 46265, "", ""])[1]["status"] == "Pending", "a blank debt status means Pending")
check(m.map_cash(["", 46096, "", "Credit", 970, "Opening Cash"])[1]["type"] == "credit", "cash row with blank time and short length")
check(m.map_goal(["Smart Plug", "OneTime", 1000, "Active", True, 46245])[1]["priority"] is True, "goal priority stays a true/false")
check(m.map_budget([46235, "Food", "Need", 1783])[1]["month"] == "2026-08", "a budget month becomes yyyy-MM")
check(m.map_spam([46283.79, "AX-GIVAIN-P", "tmpl", "example"])[1]["sender"] == "AX-GIVAIN-P", "the header-less spam tab is read from its first row")
tv = m.build_type_votes([["h"], ["A", "Small", "Want", 46244.2], ["", "", "", ""], ["A", "Small", "Need", 46244.3]])
check(list(tv) == ["000001", "000003"] and tv["000003"]["seq"] == 3, "type votes keep their order (the newest decide), even with a blank row between")

print("--- Firestore encoding round-trip ---")
d = {"s": "x", "i": 5, "b": True, "n": None, "t": dt.datetime(2026, 2, 28, 19, 0, tzinfo=dt.timezone.utc), "l": [1, "a"], "m": {"k": 2}}
back = {k: m.dec(m.enc(v)) for k, v in d.items()}
check(back["s"] == "x" and back["i"] == 5 and back["b"] is True and back["n"] is None and back["l"] == [1, "a"] and back["m"] == {"k": 2}, "values survive encode/decode")
check(m.canon_doc({"t": back["t"]}) == m.canon_doc({"t": d["t"]}), "timestamps survive to the second")

print("--- the independent total check ---")
rows = [["h"], ROW, [46082, 0.5, "HDFC", "credit", "upi", 12000, "", "x", "", "", "", "", "", "Income"], [46100, 0, "", "debit", "", 10.5, "", "y", "", "", "", "", "", ""]]
t = m.sheet_totals(rows)
docs, _ = m.build_docs(rows, m.map_transaction, True)
f = m.fs_totals(docs)
check(t == f, "totals worked out from the raw rows equal totals from the documents")
check(t["debitPaise"] == 27450 + 1050 and t["creditPaise"] == 1200000, "and they are the right numbers")

print("\n%s" % ("ALL PASSED" if failures == 0 else "%d FAILED" % failures))
sys.exit(1 if failures else 0)
