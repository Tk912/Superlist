"""מוריד מחירים לסניפים שנבחרו באפליקציה ושומר אותם כקובצי JSON שהאתר קורא.

רץ אוטומטית ב-GitHub Actions כל שעה (ראו .github/workflows/site.yml).
הסניפים שנבחרו נקראים מ-Firebase (המסמך public/config, שקריא לכולם ומכיל רק מספרי סניפים).

הרצה ידנית:  python scripts/update_prices.py [יעד]   (ברירת מחדל: docs/data)
אפשר גם לבחור סניפים בלי Firebase:  STORES="ramilevy:39,shufersal:1" python scripts/update_prices.py
"""
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import prices  # noqa: E402  (הורדה ופענוח של קבצי השקיפות)

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "data"


def firebase_config():
    text = (ROOT / "docs" / "firebase-config.js").read_text("utf-8")
    get = lambda k: (re.search(k + r'\s*:\s*"([^"]+)"', text) or [None, None])[1]
    return get("projectId"), get("apiKey")


def selected_stores():
    if os.environ.get("STORES"):
        return dict(pair.split(":", 1) for pair in os.environ["STORES"].split(",") if ":" in pair)
    project, key = firebase_config()
    if not project or "PASTE" in project:
        print("Firebase עוד לא הוגדר (docs/firebase-config.js) - אין סניפים להוריד")
        return {}
    url = (f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/public/config"
           f"?key={key}")
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            doc = json.loads(r.read())
    except Exception as e:
        print("לא הצלחתי לקרוא את הסניפים מ-Firebase:", e)
        return {}
    fields = doc.get("fields", {}).get("stores", {}).get("mapValue", {}).get("fields", {})
    return {c: v.get("stringValue") for c, v in fields.items() if v.get("stringValue") and c in prices.CHAINS}


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")


def main():
    status = {"updated": time.time(), "stores": {}, "errors": {}}
    # רשימות סניפים לכל הרשתות (לבחירת סניף באפליקציה)
    for chain, cfg in prices.CHAINS.items():
        try:
            stores = prices.shufersal_stores() if cfg["kind"] == "shufersal" else prices.cerberus_stores(cfg["user"])
            write_json(OUT / "stores" / f"{chain}.json", stores)
            print(f"{cfg['name']}: {len(stores)} סניפים")
        except Exception as e:
            status["errors"][f"stores:{chain}"] = str(e)[:200]
            print(f"{cfg['name']}: שגיאה ברשימת הסניפים - {e}")
    # מחירים לסניפים שנבחרו
    for chain, store in selected_stores().items():
        cfg = prices.CHAINS[chain]
        try:
            raw = prices.shufersal_pricefull(store) if cfg["kind"] == "shufersal" else prices.cerberus_pricefull(cfg["user"], store)
            items = [[i["code"], i["name"], i["price"], 1 if i["weighted"] else 0]
                     for i in prices._items_from_xml(prices._parse_xml(raw))]
            write_json(OUT / "prices" / f"{chain}-{store}.json", {"chain": chain, "store": store, "updated": time.time(), "items": items})
            status["stores"][f"{chain}:{store}"] = {"updated": time.time(), "items": len(items)}
            print(f"{cfg['name']} סניף {store}: {len(items):,} מוצרים")
        except Exception as e:
            status["errors"][f"{chain}:{store}"] = str(e)[:200]
            print(f"{cfg['name']} סניף {store}: שגיאה - {e}")
    write_json(OUT / "status.json", status)


if __name__ == "__main__":
    main()
