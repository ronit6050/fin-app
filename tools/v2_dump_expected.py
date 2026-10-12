# tools/v2_dump_expected.py
#
# PLAIN-ENGLISH WHAT THIS IS: writes out, as a plain JSON file, the documents the Python migration tool
# works out from a Sheet backup folder. backend/tests/v2Sync.test.js uses it to prove the Apps Script sync
# (JavaScript) builds IDENTICAL documents from the same data. Offline: reads only local backup files.
#
# Run:  python tools/v2_dump_expected.py <backup folder> <output.json>

import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import v2_migrate as m  # noqa: E402


def load(folder, tab):
    path = os.path.join(folder, tab + ".raw.json")
    if not os.path.exists(path):
        return None
    d = json.load(open(path, encoding="utf-8"))
    return d if isinstance(d, list) else d.get("values", d)


def plain(doc):
    return {k: (v.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S") if isinstance(v, dt.datetime) else v) for k, v in doc.items()}


def main():
    folder, out = sys.argv[1], sys.argv[2]
    result = {}
    for tab, coll, mapper, has_header in m.TABS:
        rows = load(folder, tab)
        if rows is None:
            continue
        docs, _ = m.build_docs(rows, mapper, has_header)
        result[coll] = {k: plain(v) for k, v in docs.items()}
    tv = load(folder, "TypeVotes")
    if tv is not None:
        result["typeVotes"] = {k: plain(v) for k, v in m.build_type_votes(tv).items()}
    json.dump(result, open(out, "w", encoding="utf-8"))
    print("dumped %d collections, %d documents" % (len(result), sum(len(v) for v in result.values())))


if __name__ == "__main__":
    main()
