"""הורדת קבצי מחירים מהרשתות (חוק שקיפות המחירים) ושמירתם ב-SQLite.

הרשתות הנתמכות:
  shufersal  - prices.shufersal.co.il
  ramilevy, yochananof, osherad, tivtaam - url.publishedprices.co.il

שימוש מהשורה:
  python prices.py stores ramilevy        # רשימת סניפים
  python prices.py update ramilevy 39     # הורדת מחירי סניף
"""
import gzip
import html
import http.cookiejar
import io
import json
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
DB_PATH = DATA_DIR / "prices.db"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SuperList/1.0"

CHAINS = {
    "shufersal": {"name": "שופרסל", "kind": "shufersal"},
    "ramilevy": {"name": "רמי לוי", "kind": "cerberus", "user": "RamiLevi"},
    "yochananof": {"name": "יוחננוף", "kind": "cerberus", "user": "yohananof"},
    "osherad": {"name": "אושר עד", "kind": "cerberus", "user": "osherad"},
    "tivtaam": {"name": "טיב טעם", "kind": "cerberus", "user": "TivTaam"},
    "carrefour": {"name": "קרפור", "kind": "carrefour"},
    "hazihinam": {"name": "חצי חינם", "kind": "hazi"},
    "wolt": {"name": "וולט מרקט", "kind": "wolt"},
}

# PriceFull<chain>-<subchain>-<store>-<yyyymmdd>-<hhmmss>
FILE_RE = re.compile(r"PriceFull\d+-(\d+)-(\d+)-(\d{8})-?(\d{4,6})", re.I)
STAMP_RE = re.compile(r"-(20\d{6})-?(\d{4,6})")
ONLINE_FILE_RE = re.compile(r"^pricefull\d+-(\d{3})-20\d{10}", re.I)


# ---------- רשת ----------

def _opener():
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.addheaders = [("User-Agent", UA)]
    return op


def _get(op, url, data=None, timeout=120):
    if isinstance(data, dict):
        data = urllib.parse.urlencode(data).encode()
    with op.open(url, data, timeout=timeout) as r:
        return r.read()


def _unpack(raw):
    """gz / zip / xml רגיל -> bytes של XML."""
    if raw[:2] == b"\x1f\x8b":
        return gzip.decompress(raw)
    if raw[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            return z.read(z.namelist()[0])
    return raw


def _parse_xml(raw):
    try:
        return ET.fromstring(raw)
    except ET.ParseError:
        pass
    for enc in ("utf-8-sig", "utf-16", "windows-1255"):
        try:
            text = raw.decode(enc)
        except UnicodeDecodeError:
            continue
        text = re.sub(r"^\s*<\?xml[^>]*\?>", "", text)
        try:
            return ET.fromstring(text)
        except ET.ParseError:
            continue
    raise ValueError("קובץ XML לא תקין")


def _local(tag):
    return tag.rsplit("}", 1)[-1].lower()


def _fields(el):
    return {_local(c.tag): (c.text or "").strip() for c in el}


# ---------- שופרסל ----------

SHUF = "https://prices.shufersal.co.il"


def _shuf_links(cat, store_id=0):
    op = _opener()
    page = _get(op, f"{SHUF}/FileObject/UpdateCategory?catID={cat}&storeId={store_id}&page=1").decode("utf-8", "replace")
    return [html.unescape(u) for u in re.findall(r'href="(https://[^"]+\.gz[^"]*)"', page)]


def _latest(urls_or_names):
    def key(s):
        m = STAMP_RE.search(s)
        return (m.group(1), m.group(2).ljust(6, "0")) if m else ("", "")
    return max(urls_or_names, key=key) if urls_or_names else None


def shufersal_stores():
    url = _latest(_shuf_links(5))
    root = _parse_xml(_unpack(_get(_opener(), url)))
    return _stores_from_xml(root)


def shufersal_pricefull(store_id):
    links = [u for u in _shuf_links(2, store_id) if f"-{int(store_id):03d}-" in u]
    url = _latest(links)
    if not url:
        raise RuntimeError(f"לא נמצא קובץ מחירים לסניף {store_id}")
    return _unpack(_get(_opener(), url, timeout=300))


# ---------- publishedprices (Cerberus) ----------

CERB = "https://url.publishedprices.co.il"


class Cerberus:
    def __init__(self, user):
        self.op = _opener()
        page = _get(self.op, CERB + "/login").decode()
        tok = self._token(page)
        page = _get(self.op, CERB + "/login/user",
                    {"username": user, "password": "", "csrftoken": tok, "Submit": "Sign in"}).decode()
        self.tok = self._token(page) or tok

    @staticmethod
    def _token(page):
        m = re.search(r'name="csrftoken"\s+content="([^"]+)"', page)
        return m.group(1) if m else None

    def files(self, search):
        raw = _get(self.op, CERB + "/file/json/dir",
                   {"sSearch": search, "iDisplayLength": 100000, "csrftoken": self.tok, "cd": "/"})
        return [f["name"] for f in json.loads(raw)["aaData"]]

    def download(self, name):
        return _unpack(_get(self.op, CERB + "/file/d/" + urllib.parse.quote(name), timeout=300))


def cerberus_stores(user):
    c = Cerberus(user)
    name = _latest([n for n in c.files("Stores") if STAMP_RE.search(n)])
    return _stores_from_xml(_parse_xml(c.download(name)))


def cerberus_pricefull(user, store_id):
    c = Cerberus(user)
    sid = f"{int(store_id):03d}"
    names = [n for n in c.files("PriceFull") if (m := FILE_RE.search(n)) and m.group(2) == sid]
    # סניפי אונליין (למשל רמי לוי 039) מפרסמים בשם אחר: pricefull<רשת>-<סניף>-<yyyymmddhhmm>
    names += [n for n in c.files("pricefull") if (m := ONLINE_FILE_RE.search(n)) and m.group(1) == sid]
    name = _latest(names)
    if not name:
        raise RuntimeError(f"לא נמצא קובץ מחירים לסניף {store_id}")
    return c.download(name)


# ---------- קרפור (prices.carrefour.co.il: רשימת הקבצים של היום מוטמעת בדף) ----------

CARREFOUR = "https://prices.carrefour.co.il"


def _carrefour_files():
    page = _get(_opener(), CARREFOUR + "/").decode("utf-8", "replace")
    path = re.search(r"const path = '(\d+)'", page).group(1)
    files = json.loads(re.search(r"const files = (\[.*?\]);", page, re.S).group(1))
    return path, [f["name"] for f in files]


def carrefour_stores():
    path, names = _carrefour_files()
    name = _latest([n for n in names if n.lower().startswith("stores")])
    return _stores_from_xml(_parse_xml(_unpack(_get(_opener(), f"{CARREFOUR}/{path}/{name}"))))


def carrefour_pricefull(store_id):
    path, names = _carrefour_files()
    sid = f"{int(store_id):03d}"
    name = _latest([n for n in names if (m := FILE_RE.search(n)) and m.group(2) == sid])
    if not name:
        raise RuntimeError(f"לא נמצא קובץ מחירים לסניף {store_id}")
    return _unpack(_get(_opener(), f"{CARREFOUR}/{path}/{name}", timeout=300))


# ---------- חצי חינם (shop.hazi-hinam.co.il/Prices, t=1 מחירים, t=3 חנויות) ----------

HAZI = "https://shop.hazi-hinam.co.il/Prices"


def _hazi_links(ftype, pages=8):
    links = []
    for p in range(1, pages + 1):
        page = _get(_opener(), f"{HAZI}?p={p}&s=&f=&t={ftype}&d=").decode("utf-8", "replace")
        found = re.findall(r'href="(https://hazihinamprod01[^"]+)"', page)
        if not found:
            break
        links += found
        if ftype == 3:
            break
    return links


def hazi_stores():
    url = _latest([l for l in _hazi_links(3) if "Stores" in l])
    return _stores_from_xml(_parse_xml(_unpack(_get(_opener(), url))))


def hazi_pricefull(store_id):
    sid = f"{int(store_id):03d}"
    url = _latest([l for l in _hazi_links(1) if (m := FILE_RE.search(l)) and m.group(2) == sid])
    if not url:
        raise RuntimeError(f"לא נמצא קובץ מחירים לסניף {store_id}")
    return _unpack(_get(_opener(), url, timeout=300))


# ---------- Wolt Market (wm-gateway.wolt.com: דף לכל יום, ובו קבצים לכל חנות) ----------

WOLT = "https://wm-gateway.wolt.com/isr-prices/public/v1/"


def _wolt_files():
    op = _opener()
    days = re.findall(r'href="([^"]+\.html)"', _get(op, WOLT + "index.html").decode("utf-8", "replace"))
    for day in sorted(days, reverse=True)[:3]:  # היום, ואם עוד לא פורסם - אתמול
        files = re.findall(r'href="([^"]+)"', _get(op, WOLT + day).decode("utf-8", "replace"))
        if any("PriceFull" in f for f in files):
            return files
    return []


def wolt_stores():
    url = _latest([f for f in _wolt_files() if "/Stores" in f])
    stores = _stores_from_xml(_parse_xml(_unpack(_get(_opener(), WOLT + url))))
    return [s for s in stores if not re.search(r"closed|test", s["name"], re.I)]


def wolt_pricefull(store_id):
    sid = f"{int(store_id):03d}"
    url = _latest([f for f in _wolt_files() if (m := FILE_RE.search(f)) and m.group(2) == sid])
    if not url:
        raise RuntimeError(f"לא נמצא קובץ מחירים לחנות {store_id}")
    return _unpack(_get(_opener(), WOLT + url, timeout=300))


def chain_stores(chain):
    cfg = CHAINS[chain]
    return {"shufersal": shufersal_stores, "carrefour": carrefour_stores, "hazi": hazi_stores, "wolt": wolt_stores,
            }.get(cfg["kind"], lambda: cerberus_stores(cfg["user"]))()


def chain_pricefull(chain, store_id):
    cfg = CHAINS[chain]
    fn = {"shufersal": shufersal_pricefull, "carrefour": carrefour_pricefull, "hazi": hazi_pricefull,
          "wolt": wolt_pricefull}.get(cfg["kind"])
    return fn(store_id) if fn else cerberus_pricefull(cfg["user"], store_id)


# ---------- פענוח ----------

def _stores_from_xml(root):
    out = {}
    for el in root.iter():
        if _local(el.tag) != "store":
            continue
        f = _fields(el)
        sid = f.get("storeid")
        if not sid:
            continue
        out[str(int(sid))] = {
            "id": str(int(sid)),
            "name": f.get("storename", ""),
            "city": f.get("city", ""),
            "address": f.get("address", ""),
        }
    return sorted(out.values(), key=lambda s: (s["city"], s["name"]))


def _num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _items_from_xml(root):
    for el in root.iter():
        if _local(el.tag) != "item":
            continue
        f = _fields(el)
        code = f.get("itemcode")
        price = _num(f.get("itemprice"))
        if not code or price is None:
            continue
        yield {
            "code": code.lstrip("0") or code,
            "name": f.get("itemname", "") or f.get("manufactureritemdescription", ""),
            "manufacturer": f.get("manufacturername", ""),
            "qty": _num(f.get("quantity")),
            "unit": f.get("unitqty", "") or f.get("unitofmeasure", ""),
            "price": price,
            "unit_price": _num(f.get("unitofmeasureprice")),
            "weighted": f.get("bisweighted", "0") in ("1", "true"),
        }


# ---------- מסד נתונים ----------

def db():
    DATA_DIR.mkdir(exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.executescript("""
        CREATE TABLE IF NOT EXISTS prices(
            chain TEXT, store_id TEXT, code TEXT, name TEXT, manufacturer TEXT,
            qty REAL, unit TEXT, price REAL, unit_price REAL, weighted INTEGER,
            PRIMARY KEY(chain, store_id, code));
        CREATE INDEX IF NOT EXISTS prices_code ON prices(code);
        CREATE TABLE IF NOT EXISTS updates(
            chain TEXT, store_id TEXT, updated REAL, items INTEGER,
            PRIMARY KEY(chain, store_id));
        CREATE TABLE IF NOT EXISTS stores_cache(chain TEXT PRIMARY KEY, data TEXT, fetched REAL);
    """)
    return con


def list_stores(chain, refresh=False):
    con = db()
    row = con.execute("SELECT data, fetched FROM stores_cache WHERE chain=?", (chain,)).fetchone()
    if row and not refresh and time.time() - row["fetched"] < 7 * 86400:
        return json.loads(row["data"])
    cfg = CHAINS[chain]
    stores = shufersal_stores() if cfg["kind"] == "shufersal" else cerberus_stores(cfg["user"])
    con.execute("REPLACE INTO stores_cache VALUES(?,?,?)", (chain, json.dumps(stores, ensure_ascii=False), time.time()))
    con.commit()
    return stores


def update_store(chain, store_id):
    cfg = CHAINS[chain]
    raw = shufersal_pricefull(store_id) if cfg["kind"] == "shufersal" else cerberus_pricefull(cfg["user"], store_id)
    items = list(_items_from_xml(_parse_xml(raw)))
    if not items:
        raise RuntimeError("קובץ המחירים ריק")
    con = db()
    with con:
        con.execute("DELETE FROM prices WHERE chain=? AND store_id=?", (chain, store_id))
        con.executemany(
            "INSERT OR REPLACE INTO prices VALUES(?,?,?,?,?,?,?,?,?,?)",
            [(chain, store_id, i["code"], i["name"], i["manufacturer"], i["qty"], i["unit"],
              i["price"], i["unit_price"], int(i["weighted"])) for i in items])
        con.execute("REPLACE INTO updates VALUES(?,?,?,?)", (chain, store_id, time.time(), len(items)))
    return len(items)


def last_updates():
    return {f'{r["chain"]}:{r["store_id"]}': {"updated": r["updated"], "items": r["items"]}
            for r in db().execute("SELECT * FROM updates")}


# ---------- התאמת שמות בעברית ----------

FINALS = str.maketrans("ךםןףץ", "כמנפצ")


def stem(word):
    """עגבניה/עגבניות -> עגבני, מלפפון/מלפפונים -> מלפפנ... מספיק טוב להשוואה."""
    w = re.sub(r"[\"'׳״.,()/\-]", "", word).translate(FINALS)
    for suf in ("ימ", "ות"):  # ם כבר הומרה ל-מ
        if len(w) > 4 and w.endswith(suf):
            return w[:-2]
    if len(w) > 3 and w.endswith("ה"):
        return w[:-1]
    return w


def stems(text):
    return [stem(w) for w in re.split(r"\s+", text.strip()) if w and stem(w)]


def _broad(word):
    """תבנית LIKE רחבה (בלי אות אחרונה, כדי לתפוס אותיות סופיות וריבוי)."""
    s = stem(word)
    return s[:-1] if len(s) >= 3 else s


def _word_match(q, n):
    """שום != שומר, חלב != חלבה: במילים קצרות דורשים התאמה מלאה."""
    return n == q or (len(q) >= 4 and n.startswith(q))


def _name_score(query_stems, name):
    """כמה טוב שם מוצר מתאים לחיפוש (נמוך = טוב). None = לא מתאים."""
    ns = stems(name)
    if not ns or not query_stems:
        return None
    if not all(any(_word_match(q, n) for n in ns) for q in query_stems):
        return None
    first = 0 if ns[0] == query_stems[0] else 1 if _word_match(query_stems[0], ns[0]) else 2
    return (first, len(ns) - len(query_stems))


def _store_filter(selected):
    pairs = list(selected.items())
    return " OR ".join("(chain=? AND store_id=?)" for _ in pairs), [x for p in pairs for x in p]


# ---------- חיפוש והשוואה ----------

def search(query, selected, limit=30):
    """selected: {chain: store_id}. מחזיר מוצרים מקובצים לפי ברקוד עם מחיר בכל רשת."""
    words = [w for w in re.split(r"\s+", query.strip()) if w]
    if not words or not selected:
        return []
    store_sql, args = _store_filter(selected)
    if query.strip().isdigit():
        word_sql, wargs = "code=?", [query.strip().lstrip("0")]
    else:
        word_sql = " AND ".join("(name LIKE ? OR manufacturer LIKE ?)" for _ in words)
        wargs = [x for w in words for x in (f"%{_broad(w)}%", f"%{_broad(w)}%")]
    rows = db().execute(
        f"SELECT * FROM prices WHERE ({store_sql}) AND {word_sql} LIMIT 5000", args + wargs).fetchall()
    qs = stems(query)
    groups = {}
    for r in rows:
        score = (0, 0) if query.strip().isdigit() else _name_score(qs, r["name"])
        if score is None:
            continue
        # מוצרים במשקל (ירקות, פירות) מקבלים קוד אחר בכל רשת, אז מקבצים אותם לפי שם
        key = "w:" + " ".join(stems(r["name"])) if r["weighted"] else r["code"]
        g = groups.setdefault(key, {"code": r["code"], "name": r["name"], "manufacturer": r["manufacturer"],
                                          "unit": r["unit"], "qty": r["qty"], "weighted": bool(r["weighted"]),
                                          "prices": {}, "_score": score})
        g["prices"][r["chain"]] = r["price"]
        if len(r["name"]) < len(g["name"]) or not g["name"]:
            g["name"] = r["name"]
    # עדיפות: מתחיל במילת החיפוש, זמין בכמה שיותר רשתות, מעט מילים נוספות (מוצר "בסיסי")
    out = sorted(groups.values(), key=lambda g: (g["_score"][0], -len(g["prices"]), g["_score"][1], len(g["name"])))
    for g in out:
        del g["_score"]
    return out[:limit]


def _similar(con, chain, store, ref_name, weighted):
    """מוצר דומה ברשת שאין בה את אותו ברקוד (בעיקר ירקות ופירות, שלכל רשת קוד משלה)."""
    qs = stems(ref_name)
    if not qs:
        return None
    rows = con.execute("SELECT code, name, price, weighted FROM prices WHERE chain=? AND store_id=? AND name LIKE ?",
                       (chain, store, f"%{_broad(ref_name.split()[0])}%")).fetchall()
    best = None
    for r in rows:
        if weighted is not None and bool(r["weighted"]) != weighted:
            continue
        ns = stems(r["name"])
        if not ns or not _word_match(qs[0], ns[0]):
            continue
        overlap = sum(any(_word_match(q, n) for n in ns) for q in qs) / len(qs)
        if overlap < 0.5:
            continue
        key = (-overlap, len(ns), r["price"])
        if best is None or key < best[0]:
            best = (key, r)
    return best[1] if best else None


def compare(items, selected):
    """items: [{code, qty, unit, kg, name, product}] -> סכום לכל רשת, ופריטים חסרים.

    מוצר שהברקוד שלו לא קיים ברשת מסוימת מוחלף במוצר דומה בשמו (מסומן approx).
    מוצר שנמכר במשקל מחושב לפי הק"ג שברשימה (kg); מוצר באריזה לפי מספר היחידות.
    """
    con = db()
    result = {c: {"chain": c, "name": CHAINS[c]["name"], "store_id": s, "total": 0.0, "found": 0, "missing": []}
              for c, s in selected.items()}
    lines = []
    for it in items:
        code = str(it.get("code") or "").lstrip("0")
        qty = float(it.get("qty") or 1)
        by_kg = it.get("unit") == "kg"
        kg = float(it.get("kg") or (qty if by_kg else qty * 0.2))
        # "1.5 ק"ג" של מוצר שנמכר באריזה -> לפחות אריזה אחת
        units = max(1, round(qty)) if by_kg else qty
        exact = {}
        for c, s in selected.items():
            r = con.execute("SELECT code, name, price, weighted FROM prices WHERE chain=? AND store_id=? AND code=?",
                            (c, s, code)).fetchone()
            if r:
                exact[c] = r
        ref = next(iter(exact.values()), None)
        weighted = bool(ref["weighted"]) if ref else (True if by_kg else None)
        ref_name = (ref["name"] if ref else None) or it.get("product") or it.get("name") or ""
        line = {"name": it.get("name"), "code": code, "qty": qty, "kg": round(kg, 2), "units": units,
                "weighted": bool(weighted), "prices": {}, "approx": {}, "codes": {}, "names": {}}
        for c, s in selected.items():
            r = exact.get(c)
            if not r:
                r = _similar(con, c, s, ref_name, weighted)
                if r:
                    line["approx"][c] = r["name"]
            if r:
                line["prices"][c] = r["price"]
                line["codes"][c] = r["code"]
                line["names"][c] = r["name"]
                # מחיר במשקל הוא לק"ג; מחיר רגיל הוא ליחידה/אריזה
                result[c]["total"] += r["price"] * (kg if r["weighted"] else units)
                result[c]["found"] += 1
            else:
                result[c]["missing"].append(it.get("name"))
        lines.append(line)
    for r in result.values():
        r["total"] = round(r["total"], 2)
    return {"chains": sorted(result.values(), key=lambda r: (-r["found"], r["total"])), "lines": lines}


def prune(selected):
    """מוחק מחירים של סניפים שכבר לא נבחרו, כדי שהמסד לא יתנפח."""
    con = db()
    with con:
        for chain in CHAINS:
            keep = selected.get(chain)
            con.execute("DELETE FROM prices WHERE chain=? AND store_id IS NOT ?", (chain, keep))
            con.execute("DELETE FROM updates WHERE chain=? AND store_id IS NOT ?", (chain, keep))


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "stores":
        for s in list_stores(sys.argv[2], refresh=True):
            print(s["id"], s["city"], s["name"], sep=" | ")
    elif len(sys.argv) >= 4 and sys.argv[1] == "update":
        print("עודכנו", update_store(sys.argv[2], sys.argv[3]), "מוצרים")
    else:
        print(__doc__)
