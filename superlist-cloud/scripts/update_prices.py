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
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import prices  # noqa: E402  (הורדה ופענוח של קבצי השקיפות)

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "data"
# רשתות שלא עונות לשרתים של GitHub – האפליקציה מורידה את הקבצים שלהן מהחיבור של המשתמש.
# מדלגים עליהן כאן, כדי לא לחכות דקות לניסיון שייכשל.
LOCAL_ONLY = {"carrefour", "hazihinam"}


def firebase_config():
    text = (ROOT / "docs" / "firebase-config.js").read_text("utf-8")
    get = lambda k: (re.search(k + r'\s*:\s*"([^"]+)"', text) or [None, None])[1]
    return get("projectId"), get("apiKey")


MAX_STORES = 40  # תקרה, כדי שהעדכון יישאר מהיר גם כשיש הרבה משתמשים


def _stores_of(doc):
    fields = doc.get("fields", {}).get("stores", {}).get("mapValue", {}).get("fields", {})
    return {(c, v.get("stringValue")) for c, v in fields.items()
            if v.get("stringValue") and c in prices.CHAINS and re.fullmatch(r"\d{1,5}", v.get("stringValue") or "")}


def selected_stores():
    """כל זוגות (רשת, סניף) שנבחרו בכל הרשימות של כל המשתמשים (prefs/<list>), וגם בגרסה הישנה (public/config)."""
    if os.environ.get("STORES"):
        return sorted(tuple(pair.split(":", 1)) for pair in os.environ["STORES"].split(",") if ":" in pair)
    project, key = firebase_config()
    if not project or "PASTE" in project:
        print("Firebase עוד לא הוגדר (docs/firebase-config.js) - אין סניפים להוריד")
        return []
    base = f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents"
    pairs, counts = set(), {}
    try:
        with urllib.request.urlopen(f"{base}/public/config?key={key}", timeout=30) as r:
            pairs |= _stores_of(json.loads(r.read()))
    except Exception as e:
        print("הגדרה ישנה (public/config) לא נקראה:", e)
    token = ""
    for _ in range(20):
        try:
            with urllib.request.urlopen(f"{base}/prefs?pageSize=300&key={key}" + (f"&pageToken={token}" if token else ""), timeout=30) as r:
                page = json.loads(r.read())
        except Exception as e:
            print("לא הצלחתי לקרוא את הסניפים מ-Firebase:", e)
            break
        for doc in page.get("documents", []):
            for p in _stores_of(doc):
                pairs.add(p)
                counts[p] = counts.get(p, 0) + 1
        token = page.get("nextPageToken", "")
        if not token:
            break
    # הסניפים הפופולריים קודם, אם יש יותר מהתקרה
    out = sorted(pairs, key=lambda p: (-counts.get(p, 0), p))[:MAX_STORES]
    print(f"סניפים להורדה: {len(out)} (מתוך {len(pairs)})")
    return out


# ---------- היסטוריית מחירים ----------
# נשמרים רק שינויים: {קוד: [[יום, מחיר], ...]} (יום = ימים מ-1970). המחיר הקודם לכל מוצר נלקח מקובץ המחירים
# שכבר באתר. הקובץ עצמו נשמר ב-cache של GitHub Actions וגם באתר, כדי שלא יאבד בין הרצות.
SITE = "https://tk912.github.io/Superlist"
HISTORY_DAYS = 180


def fetch_site_json(path):
    """קובץ JSON מהאתר החי; None אם אין (404). שגיאת רשת – מנסים שוב, ואז None."""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(f"{SITE}/{path}?t={int(time.time())}", timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception:
            pass
        time.sleep(3 * (attempt + 1))
    return None


def update_history(chain, store, items, prev_file):
    path = OUT / "history" / f"{chain}-{store}.json"
    local = json.loads(path.read_text("utf-8")) if path.exists() else None   # מה-cache
    remote = fetch_site_json(f"data/history/{chain}-{store}.json")
    hist = max([h for h in (local, remote) if h], key=lambda h: h.get("updated", 0), default={"h": {}})
    h = hist.get("h", {})
    today = int(time.time() // 86400)
    prev_day = int((prev_file or {}).get("updated", time.time() - 86400) // 86400)
    prev = {c: p for c, _, p, _ in (prev_file or {}).get("items", [])}
    for code, _, price, _ in items:
        pts = h.get(code)
        old = pts[-1][1] if pts else prev.get(code)
        if old is None or abs(old - price) < 0.005:
            continue
        if not pts:
            pts = h[code] = [[min(prev_day, today - 1), old]]
        if pts[-1][0] == today:
            pts[-1][1] = price
        else:
            pts.append([today, price])
    # שומרים חצי שנה אחורה, ועוד נקודה אחת לפני כן (המחיר שממנו התחיל)
    cut = today - HISTORY_DAYS
    for code in list(h):
        pts = h[code]
        keep = [p for p in pts if p[0] >= cut]
        older = [p for p in pts if p[0] < cut]
        h[code] = ([older[-1]] if older else []) + keep
        if len(h[code]) < 2:
            del h[code]
    write_json(path, {"chain": chain, "store": store, "updated": time.time(), "h": h})
    return len(h)


# ---------- מחיר ליחידת מידה ----------
# מהגודל והיחידה שבקובץ (Quantity + UnitQty): מחיר ל-100 גרם (מוצקים) או לליטר (נוזלים), וגודל האריזה בגרם/מ"ל.
# השדה המוכן UnitOfMeasurePrice לא אחיד בין הרשתות (לפעמים לגרם, לפעמים ל-100 גרם), ולכן מחשבים לבד.
def unit_info(item):
    if item["weighted"] or not item["qty"]:
        return None
    u = re.sub(r"[\s'\".]", "", item["unit"] or "")
    if u in ("גרם", "גר", "ג"):
        kind, size = "g", item["qty"]
    elif u in ("קג", "קילוגרם", "קילו"):
        kind, size = "g", item["qty"] * 1000
    elif u in ("מל", "מיליליטר", "מיליליטרים"):
        kind, size = "l", item["qty"]
    elif u in ("ליטר", "ל", "ליטרים"):
        kind, size = "l", item["qty"] * 1000
    else:
        return None
    if not 5 <= size <= 50000:
        return None
    per = item["price"] / size * (100 if kind == "g" else 1000)
    return [round(per, 2), kind, round(size)]


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), "utf-8")


def main():
    status = {"updated": time.time(), "stores": {}, "errors": {}}
    # רשימות סניפים לכל הרשתות (לבחירת סניף באפליקציה)
    for chain, cfg in prices.CHAINS.items():
        if chain in LOCAL_ONLY:
            continue
        try:
            stores = prices.chain_stores(chain)
            write_json(OUT / "stores" / f"{chain}.json", stores)
            print(f"{cfg['name']}: {len(stores)} סניפים")
        except Exception as e:
            status["errors"][f"stores:{chain}"] = str(e)[:200]
            print(f"{cfg['name']}: שגיאה ברשימת הסניפים - {e}")
    # מחירים לסניפים שנבחרו
    for chain, store in selected_stores():
        if chain in LOCAL_ONLY:
            continue
        cfg = prices.CHAINS[chain]
        try:
            raw = prices.chain_pricefull(chain, store)
            parsed = list(prices._items_from_xml(prices._parse_xml(raw)))
            items = [[i["code"], i["name"], i["price"], 1 if i["weighted"] else 0] for i in parsed]
            # {קוד: [מחיר ל-100 גרם / לליטר, "g"|"l", גודל האריזה בגרם/מ"ל]}
            units = {i["code"]: u for i in parsed if (u := unit_info(i))}
            # מבצעים: רק למוצרים שבאמת יורדים במחיר; אם הקובץ לא זמין – ממשיכים בלי
            promos = {}
            try:
                praw = prices.chain_promofull(chain, store)
                if praw:
                    regular = {c: p for c, _, p, _ in items}
                    today = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 3 * 3600))
                    # הנחה של יותר מ-75% היא כמעט תמיד טעות בקובץ (מחיר ל-100 גרם וכו') – לא סומכים עליה
                    promos = {c: v for c, v in prices._promos_from_xml(prices._parse_xml(praw), today).items()
                              if c in regular and regular[c] * 0.25 <= v[0] < regular[c] - 0.005}
            except Exception as e:
                status["errors"][f"promos:{chain}:{store}"] = str(e)[:200]
            changed = 0
            try:
                changed = update_history(chain, store, items, fetch_site_json(f"data/prices/{chain}-{store}.json"))
            except Exception as e:
                status["errors"][f"history:{chain}:{store}"] = str(e)[:200]
            write_json(OUT / "prices" / f"{chain}-{store}.json",
                       {"chain": chain, "store": store, "updated": time.time(), "items": items, "promos": promos, "units": units})
            status["stores"][f"{chain}:{store}"] = {"updated": time.time(), "items": len(items), "promos": len(promos), "history": changed}
            print(f"{cfg['name']} סניף {store}: {len(items):,} מוצרים, {len(promos):,} במבצע, {changed:,} עם שינויי מחיר")
        except Exception as e:
            status["errors"][f"{chain}:{store}"] = str(e)[:200]
            print(f"{cfg['name']} סניף {store}: שגיאה - {e}")
    write_json(OUT / "status.json", status)


if __name__ == "__main__":
    main()
