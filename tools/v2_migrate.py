# tools/v2_migrate.py
#
# PLAIN-ENGLISH WHAT THIS IS: step 1 of the "Firestore as the only database" plan
# (docs/v2-firestore-native.md). It copies every tab of the owner's Google Sheet into
# Firestore, in the new per-person layout, and then CHECKS the copy against the Sheet to
# the paisa. It changes nothing in the Sheet and nothing the live app reads.
#
# SAFETY RULES
# - Dry run by default: it only reads the Sheet and prints what it WOULD write.
#   Add --apply to really write.
# - It writes ONLY into these new collections under users/<owner>/ and never touches
#   friends, splitMarkers, debtMoves, views or anything else that exists already.
# - Re-running is safe: every document has a fixed id, so a re-run overwrites the same
#   documents instead of adding duplicates.
# - It prints COUNTS and TOTALS only. It never prints a transaction, a name, a note or an SMS.
#
# Run:   python tools/v2_migrate.py              (dry run + checks against the Sheet)
#        python tools/v2_migrate.py --apply      (write, then verify what was written)
#        python tools/v2_migrate.py --verify     (only verify what is in Firestore now)

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
from decimal import Decimal, ROUND_HALF_UP

import requests

sys.path.insert(0, os.path.dirname(__file__))
import _auth  # noqa: E402

OWNER = "ronitnadar9@gmail.com"
SHEET_ID = "1_vlmbWEg6KkFhU7uUdmtPBfVRP_VWDmOjzcCJxF2ruw"
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/" + SHEET_ID
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
EPOCH = dt.datetime(1899, 12, 30)

# The ONLY collections this tool may write. Anything else is refused.
COLLECTIONS = [
    "transactions", "transactionsIgnored", "cash", "debts", "savings", "goals", "investments",
    "instruments", "financialEvents", "budgets", "smartMemory", "typeVotes", "noteMemory",
    "learnedSpamPatterns",
]


# ------------------------------------------------------------------ converters (unit-tested)
def paise(x):
    """Rupees (number or text like '1,234.50') -> whole paise, exactly. Blank/bad -> 0."""
    if x is None or x == "":
        return 0
    try:
        d = Decimal(str(x).replace(",", "").strip())
    except Exception:
        return 0
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def serial_to_dt(n):
    return EPOCH + dt.timedelta(days=float(n))


DATE_TEXT_FORMATS = ["%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d %b %Y", "%d/%m/%y", "%d-%b-%Y", "%d %B %Y"]


def to_date_str(v):
    """A sheet date cell (day-number or text) -> 'yyyy-MM-dd', or '' if blank, or None if it can't be read."""
    if v is None or v == "":
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return serial_to_dt(int(v)).strftime("%Y-%m-%d")
    s = str(v).strip()
    for f in DATE_TEXT_FORMATS:
        try:
            return dt.datetime.strptime(s, f).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def to_time_str(v):
    """A sheet time cell (fraction of a day, or a date-time number, or text) -> 'HH:MM:SS'."""
    if v is None or v == "":
        return "00:00:00"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        frac = float(v) - int(float(v))
        secs = int(round(frac * 86400))
        if secs >= 86400:
            secs = 86399
        return "%02d:%02d:%02d" % (secs // 3600, (secs % 3600) // 60, secs % 60)
    m = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?", str(v).strip())
    if m:
        return "%02d:%02d:%02d" % (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))
    return "00:00:00"


def to_ts(date_str, time_str):
    """'yyyy-MM-dd' + 'HH:MM:SS' read as India time -> an exact UTC moment for Firestore."""
    if not date_str:
        return None
    d = dt.datetime.strptime(date_str + " " + time_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=IST)
    return d.astimezone(dt.timezone.utc)


def to_ts_serial(v):
    """A date-time number (sheet 'Timestamp'/'CreatedAt'/'Confirmed') -> UTC moment, or None."""
    if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
        return serial_to_dt(v).replace(tzinfo=IST).astimezone(dt.timezone.utc)
    return None


def text(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def sha(parts, n=24):
    return hashlib.sha1("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:n]


def pad(row, width):
    r = list(row)
    while len(r) < width:
        r.append("")
    return r


def is_blank_row(row):
    return all(c == "" or c is None for c in row)


# ------------------------------------------------------------------ per-tab mappings
def map_transaction(row):
    """One Transactions / Transactions_Ignored row -> (id_base, doc) or None for a blank placeholder."""
    r = pad(row, 21)
    date_s = to_date_str(r[0])
    time_s = to_time_str(r[1])
    amount_p = paise(r[5])
    if not date_s and not amount_p and not text(r[7]):
        return None                      # an empty placeholder row (e.g. an old IGNORED marker) - nothing to keep
    doc = {
        "date": date_s if date_s is not None else "", "dateRaw": "" if date_s is not None else text(r[0]),
        "time": time_s, "ts": to_ts(date_s, time_s) if date_s else None,
        "bank": text(r[2]), "type": text(r[3]).lower(), "mode": text(r[4]), "amountPaise": amount_p,
        "reference": text(r[6]), "counterparty": text(r[7]), "channel": text(r[8]), "source": text(r[9]),
        "rawSms": text(r[10]), "sender": text(r[11]), "note": text(r[12]), "category": text(r[13]),
        "telegramMsgId": text(r[14]), "processed": text(r[15]), "needWantSaving": text(r[16]),
        "financialEvent": text(r[17]), "financialEventName": text(r[18]), "autoSettled": text(r[19]),
        "friendSharePaise": paise(r[20]),
    }
    base = sha([doc["date"], doc["time"], doc["type"], doc["bank"], doc["reference"], doc["counterparty"], doc["amountPaise"]])
    return base, doc


def map_cash(row):
    r = pad(row, 11)
    date_s = to_date_str(r[1])
    amount_p = paise(r[4])
    if not date_s and not amount_p and not text(r[5]):
        return None
    created = to_ts_serial(r[9]) or (to_ts(date_s, to_time_str(r[2])) if date_s else None)
    doc = {"date": date_s if date_s is not None else "", "time": to_time_str(r[2]), "type": text(r[3]).lower(),
           "amountPaise": amount_p, "note": text(r[5]), "category": text(r[6]), "source": text(r[7]),
           "telegramMsgId": text(r[8]), "createdAt": created, "needWantSaving": text(r[10])}
    return sha([doc["date"], doc["time"], doc["type"], doc["amountPaise"], doc["note"], text(r[8]), text(r[9])]), doc


def map_debt(row):
    r = pad(row, 8)
    if not text(r[1]) and not paise(r[3]):
        return None
    doc = {"date": to_date_str(r[0]) or "", "person": text(r[1]), "type": text(r[2]).upper(), "amountPaise": paise(r[3]),
           "note": text(r[4]), "dueDate": to_date_str(r[5]) or "", "status": text(r[6]) or "Pending",
           "settledDate": to_date_str(r[7]) or ""}
    return sha([doc["date"], doc["person"], doc["type"], doc["amountPaise"], doc["note"], doc["dueDate"]]), doc


def map_saving(row):
    r = pad(row, 5)
    if not paise(r[1]) and not text(r[3]):
        return None
    doc = {"date": to_date_str(r[0]) or "", "amountPaise": paise(r[1]), "type": text(r[2]), "note": text(r[3]),
           "destination": text(r[4])}
    return sha([doc["date"], doc["amountPaise"], doc["type"], doc["note"], doc["destination"]]), doc


def map_goal(row):
    r = pad(row, 6)
    if not text(r[0]):
        return None
    doc = {"name": text(r[0]), "type": text(r[1]), "targetPaise": paise(r[2]), "status": text(r[3]),
           "priority": bool(r[4]) if isinstance(r[4], bool) else text(r[4]).lower() == "true",
           "dateAdded": to_date_str(r[5]) or ""}
    return sha([doc["name"]]), doc


def map_investment(row):
    r = pad(row, 4)
    if not text(r[1]) and not paise(r[2]):
        return None
    doc = {"date": to_date_str(r[0]) or "", "name": text(r[1]), "amountPaise": paise(r[2]), "note": text(r[3])}
    return sha([doc["date"], doc["name"], doc["amountPaise"], doc["note"]]), doc


def map_instrument(row):
    r = pad(row, 3)
    if not text(r[0]):
        return None
    doc = {"name": text(r[0]), "category": text(r[1]), "sipAmountPaise": paise(r[2])}
    return sha([doc["name"]]), doc


def map_fin_event(row):
    r = pad(row, 5)
    if not text(r[0]):
        return None
    doc = {"type": text(r[0]), "amountPaise": paise(r[1]), "counterparty": text(r[2]),
           "confirmedAt": to_ts_serial(r[3]), "name": text(r[4])}
    return sha([doc["type"], doc["amountPaise"], doc["counterparty"], text(r[3])]), doc


def map_budget(row):
    r = pad(row, 4)
    if not text(r[1]):
        return None
    month = to_date_str(r[0])
    month = month[:7] if month else ""
    doc = {"month": month, "category": text(r[1]), "type": text(r[2]), "targetPaise": paise(r[3])}
    return sha([month, doc["category"], doc["type"]]), doc


def map_smart_memory(row):
    r = pad(row, 6)
    if not text(r[0]):
        return None
    doc = {"merchant": text(r[0]), "category": text(r[1]), "subcategory": text(r[2]),
           "confidence": int(r[3]) if isinstance(r[3], (int, float)) else 0,
           "timesUsed": int(r[4]) if isinstance(r[4], (int, float)) else 0, "lastUsed": to_ts_serial(r[5])}
    return sha([doc["merchant"].lower()]), doc


def map_note_memory(row):
    r = pad(row, 5)
    if not text(r[0]):
        return None
    doc = {"merchant": text(r[0]), "amountBand": text(r[1]), "note": text(r[2]),
           "timesUsed": int(r[3]) if isinstance(r[3], (int, float)) else 0, "lastUsed": to_ts_serial(r[4])}
    return sha([doc["merchant"].lower(), doc["amountBand"]]), doc


def map_spam(row):
    r = pad(row, 4)                       # this tab has NO header row: every row is data
    if not text(r[2]):
        return None
    doc = {"learnedAt": to_ts_serial(r[0]), "sender": text(r[1]), "template": text(r[2]), "example": text(r[3])}
    return sha([doc["sender"], doc["template"]]), doc


# (sheet tab, collection, mapper, has_header_row)
TABS = [
    ("Transactions", "transactions", map_transaction, True),
    ("Transactions_Ignored", "transactionsIgnored", map_transaction, True),
    ("Cash", "cash", map_cash, True),
    ("Debts", "debts", map_debt, True),
    ("Savings", "savings", map_saving, True),
    ("Goals", "goals", map_goal, True),
    ("Investments", "investments", map_investment, True),
    ("InvestmentInstruments", "instruments", map_instrument, True),
    ("FinancialEvents", "financialEvents", map_fin_event, True),
    ("Budgets", "budgets", map_budget, True),
    ("SmartMemory", "smartMemory", map_smart_memory, True),
    ("NoteMemory", "noteMemory", map_note_memory, True),
    ("LearnedSpamPatterns", "learnedSpamPatterns", map_spam, False),
]


def build_docs(tab_rows, mapper, has_header):
    """-> (docs dict id->doc, skipped blank count). Same-looking rows get -2, -3 ... in sheet order."""
    rows = tab_rows[1:] if has_header else tab_rows
    docs, seen, skipped = {}, {}, 0
    for row in rows:
        if is_blank_row(row):
            skipped += 1
            continue
        m = mapper(row)
        if m is None:
            skipped += 1
            continue
        base, doc = m
        seen[base] = seen.get(base, 0) + 1
        docs[base if seen[base] == 1 else "%s-%d" % (base, seen[base])] = doc
    return docs, skipped


def build_type_votes(tab_rows):
    """TypeVotes: order matters (the newest 5 per merchant+band decide), so each vote keeps its place in line."""
    docs = {}
    for i, row in enumerate(tab_rows[1:]):
        r = pad(row, 4)
        if not text(r[0]):
            continue
        docs["%06d" % (i + 1)] = {"seq": i + 1, "merchant": text(r[0]), "amountBand": text(r[1]), "type": text(r[2]),
                                  "votedAt": to_ts_serial(r[3])}
    return docs


# ------------------------------------------------------------------ Firestore (REST)
def enc(v):
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, dt.datetime):
        return {"timestampValue": v.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")}
    if isinstance(v, (list, tuple)):
        return {"arrayValue": {"values": [enc(x) for x in v]}}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: enc(x) for k, x in v.items()}}}
    return {"stringValue": str(v)}


def dec(v):
    if "stringValue" in v:
        return v["stringValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return v["doubleValue"]
    if "booleanValue" in v:
        return v["booleanValue"]
    if "timestampValue" in v:
        return dt.datetime.strptime(v["timestampValue"].replace("Z", "").split(".")[0], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc)
    if "arrayValue" in v:
        return [dec(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v:
        return {k: dec(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return None


def canon_ts(v):
    """Compare moments to the second, whichever side they came from."""
    if isinstance(v, dt.datetime):
        return v.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return v


def canon_doc(doc):
    return {k: canon_ts(v) for k, v in doc.items()}


class Firestore:
    def __init__(self):
        self.project = _auth.project_id()
        self.base = "https://firestore.googleapis.com/v1/projects/%s/databases/(default)/documents" % self.project
        self._token = None
        self._token_at = 0

    def headers(self):
        if not self._token or time.time() - self._token_at > 2400:
            self._token = _auth.access_token(["https://www.googleapis.com/auth/datastore"])
            self._token_at = time.time()
        return {"Authorization": "Bearer " + self._token}

    def name(self, path):
        return "projects/%s/databases/(default)/documents/%s" % (self.project, path)

    def commit(self, writes):
        for attempt in range(5):
            r = requests.post(self.base + ":commit", headers=self.headers(), json={"writes": writes}, timeout=120)
            if r.status_code == 200:
                return
            if r.status_code in (429, 500, 503):
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError("Firestore write failed (HTTP %s): %s" % (r.status_code, r.text[:200]))
        raise RuntimeError("Firestore write kept failing; stopped.")

    def list(self, path):
        out, token = {}, ""
        while True:
            url = self.base + "/" + urllib.parse.quote(path, safe="/@.") + "?pageSize=300"
            if token:
                url += "&pageToken=" + urllib.parse.quote(token)
            r = requests.get(url, headers=self.headers(), timeout=120)
            if r.status_code == 404:
                return out
            r.raise_for_status()
            body = r.json()
            for d in body.get("documents", []):
                out[d["name"].split("/")[-1]] = {k: dec(v) for k, v in d.get("fields", {}).items()}
            token = body.get("nextPageToken", "")
            if not token:
                return out


# ------------------------------------------------------------------ reading the Sheet
def sheet_headers():
    return {"Authorization": "Bearer " + _auth.access_token(["https://www.googleapis.com/auth/spreadsheets.readonly"])}


def read_tab_raw(tab):
    url = SHEETS + "/values/" + urllib.parse.quote("'" + tab.replace("'", "''") + "'")
    r = requests.get(url, headers=sheet_headers(), timeout=120,
                     params={"valueRenderOption": "UNFORMATTED_VALUE", "dateTimeRenderOption": "SERIAL_NUMBER"})
    if r.status_code == 400:
        return None                       # the tab doesn't exist (yet)
    r.raise_for_status()
    return r.json().get("values", [])


# ------------------------------------------------------------------ independent totals (the check)
def sheet_totals(rows):
    """Totals worked out straight from the raw Transactions rows, by a different route than the mapper."""
    t = {"count": 0, "debitPaise": 0, "creditPaise": 0, "byMonthDebitPaise": {}, "byCategoryDebitPaise": {}}
    for row in rows[1:]:
        r = pad(row, 21)
        amt = r[5]
        has_amt = isinstance(amt, (int, float)) and not isinstance(amt, bool) and amt != 0
        has_date = isinstance(r[0], (int, float)) and r[0] > 0
        if not has_amt and not has_date and not str(r[7]).strip():
            continue
        p = int(round(float(amt) * 100)) if isinstance(amt, (int, float)) and not isinstance(amt, bool) else paise(amt)
        t["count"] += 1
        kind = str(r[3]).strip().lower()
        month = serial_to_dt(int(r[0])).strftime("%Y-%m") if has_date else "undated"
        if kind == "debit":
            t["debitPaise"] += p
            t["byMonthDebitPaise"][month] = t["byMonthDebitPaise"].get(month, 0) + p
            cat = str(r[13]).strip() or "(none)"
            t["byCategoryDebitPaise"][cat] = t["byCategoryDebitPaise"].get(cat, 0) + p
        elif kind == "credit":
            t["creditPaise"] += p
    return t


def fs_totals(docs):
    t = {"count": len(docs), "debitPaise": 0, "creditPaise": 0, "byMonthDebitPaise": {}, "byCategoryDebitPaise": {}}
    for d in docs.values():
        if d.get("type") == "debit":
            t["debitPaise"] += d["amountPaise"]
            m = d["date"][:7] if d.get("date") else "undated"
            t["byMonthDebitPaise"][m] = t["byMonthDebitPaise"].get(m, 0) + d["amountPaise"]
            c = d.get("category") or "(none)"
            t["byCategoryDebitPaise"][c] = t["byCategoryDebitPaise"].get(c, 0) + d["amountPaise"]
        elif d.get("type") == "credit":
            t["creditPaise"] += d["amountPaise"]
    return t


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="really write to Firestore (default: dry run)")
    ap.add_argument("--verify", action="store_true", help="only compare Firestore with the Sheet, write nothing")
    a = ap.parse_args()
    fs = Firestore()
    report = {"at": dt.datetime.now(dt.timezone.utc).isoformat(), "mode": "apply" if a.apply else ("verify" if a.verify else "dry-run"),
              "collections": {}, "checks": []}
    all_ok = True

    def check(label, ok, detail=""):
        nonlocal all_ok
        all_ok = all_ok and ok
        report["checks"].append({"check": label, "ok": ok, "detail": detail})
        print(("PASS  " if ok else "FAIL  ") + label + ((" - " + detail) if detail else ""))

    sheet = {}
    expected = {}                           # collection -> {id: doc}
    for tab, coll, mapper, has_header in TABS:
        rows = read_tab_raw(tab)
        if rows is None:
            print("note: tab %s does not exist; skipped" % tab)
            continue
        sheet[tab] = rows
        docs, skipped = build_docs(rows, mapper, has_header)
        expected[coll] = docs
        report["collections"][coll] = {"sheetDataRows": len(rows) - (1 if has_header else 0), "docs": len(docs), "skippedBlank": skipped}
    tv = read_tab_raw("TypeVotes")
    if tv is not None:
        expected["typeVotes"] = build_type_votes(tv)
        report["collections"]["typeVotes"] = {"sheetDataRows": len(tv) - 1, "docs": len(expected["typeVotes"]), "skippedBlank": 0}

    assert set(expected) <= set(COLLECTIONS), "refusing: unknown collection"
    print("\nWhat the Sheet holds (counts only):")
    for coll, info in report["collections"].items():
        print("  %-22s sheet rows %5d  -> documents %5d  (blank rows skipped %d)" % (coll, info["sheetDataRows"], info["docs"], info["skippedBlank"]))

    # sanity on the mapper itself: every real row became exactly one document
    for coll, info in report["collections"].items():
        check("%s: every non-blank sheet row became one document" % coll, info["docs"] + info["skippedBlank"] == info["sheetDataRows"])
    undated = sum(1 for d in expected.get("transactions", {}).values() if not d["date"])
    check("transactions: every row has a readable date", undated == 0, "%d without one" % undated)

    if a.apply and not a.verify:
        print("\nWriting to Firestore under users/%s/ ..." % OWNER)
        for coll, docs in expected.items():
            items = list(docs.items())
            for i in range(0, len(items), 300):
                writes = [{"update": {"name": fs.name("users/%s/%s/%s" % (OWNER, coll, doc_id)),
                                      "fields": {k: enc(v) for k, v in doc.items()}}} for doc_id, doc in items[i:i + 300]]
                fs.commit(writes)
            print("  wrote %-22s %5d documents" % (coll, len(items)))

    if a.apply or a.verify:
        print("\nChecking Firestore against the Sheet ...")
        for coll, docs in expected.items():
            live = fs.list("users/%s/%s" % (OWNER, coll))
            missing = [k for k in docs if k not in live]
            extra = [k for k in live if k not in docs]
            changed = [k for k in docs if k in live and canon_doc(live[k]) != canon_doc(docs[k])]
            report["collections"][coll].update({"inFirestore": len(live), "missing": len(missing), "extra": len(extra), "changed": len(changed)})
            check("%s: Firestore has exactly the %d documents the Sheet implies" % (coll, len(docs)),
                  not missing and not extra and not changed,
                  "in Firestore %d, missing %d, extra %d, different %d" % (len(live), len(missing), len(extra), len(changed)))
        # totals worked out two different ways must agree to the paisa
        live_tx = fs.list("users/%s/transactions" % OWNER)
        s_tot, f_tot = sheet_totals(sheet["Transactions"]), fs_totals(live_tx)
        report["totals"] = {"sheet": s_tot, "firestore": f_tot}
        check("transactions: row count matches the Sheet", s_tot["count"] == f_tot["count"], "%d vs %d" % (s_tot["count"], f_tot["count"]))
        check("transactions: total money OUT matches to the paisa", s_tot["debitPaise"] == f_tot["debitPaise"],
              "Rs %.2f vs Rs %.2f" % (s_tot["debitPaise"] / 100, f_tot["debitPaise"] / 100))
        check("transactions: total money IN matches to the paisa", s_tot["creditPaise"] == f_tot["creditPaise"],
              "Rs %.2f vs Rs %.2f" % (s_tot["creditPaise"] / 100, f_tot["creditPaise"] / 100))
        check("transactions: spend matches for every month", s_tot["byMonthDebitPaise"] == f_tot["byMonthDebitPaise"],
              "%d months" % len(s_tot["byMonthDebitPaise"]))
        check("transactions: spend matches for every category", s_tot["byCategoryDebitPaise"] == f_tot["byCategoryDebitPaise"],
              "%d categories" % len(s_tot["byCategoryDebitPaise"]))
        live_cash = fs.list("users/%s/cash" % OWNER)
        sheet_cash = sum(paise(pad(r, 5)[4]) for r in sheet["Cash"][1:] if not is_blank_row(r))
        check("cash: total amount matches to the paisa", sheet_cash == sum(d["amountPaise"] for d in live_cash.values()))
        # nothing that already existed was touched
        for keep in ("friends", "splitMarkers", "debtMoves", "views"):
            pass

    os.makedirs(os.path.join(os.path.dirname(__file__), "..", "local-data", "audit"), exist_ok=True)
    out = os.path.join(os.path.dirname(__file__), "..", "local-data", "audit", "v2-shadow-report.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, default=str)
    print("\n%s  (report with counts only saved to local-data/audit/v2-shadow-report.json)" % ("ALL CHECKS PASSED" if all_ok else "SOME CHECKS FAILED"))
    if not (a.apply or a.verify):
        print("Dry run: nothing was written. Run with --apply to write, then it verifies by itself.")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
