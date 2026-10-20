// מחירים בדפדפן: קורא את קובצי ה-JSON ש-GitHub מעדכן כל שעה (data/prices/*.json),
// ומחפש ומשווה סלים בלי שרת. (אותו היגיון כמו scripts/prices.py)
"use strict";
const PriceDB = (() => {
  const CHAIN_NAMES = { shufersal: "שופרסל", ramilevy: "רמי לוי", carrefour: "קרפור", hazihinam: "חצי חינם",
                        tivtaam: "טיב טעם", wolt: "וולט מרקט", yochananof: "יוחננוף", osherad: "אושר עד" };
  const data = {};   // chain -> {store, updated, items: [[code, name, price, weighted, stems]], byCode: Map}
  let status = null;

  // ---------- התאמת שמות בעברית ----------
  const FIN = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
  function stem(word) {
    const w = word.replace(/["'׳״.,()\/\-]/g, "").replace(/[ךםןףץ]/g, c => FIN[c]);
    if (w.length > 4 && (w.endsWith("ימ") || w.endsWith("ות"))) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("ה")) return w.slice(0, -1);
    return w;
  }
  const stems = t => String(t || "").trim().split(/\s+/).map(stem).filter(Boolean);
  // שום != שומר, חלב != חלבה: במילים קצרות דורשים התאמה מלאה
  const wm = (q, n) => n === q || (q.length >= 4 && n.startsWith(q));
  function nameScore(qs, ns) {
    if (!ns.length || !qs.length || !qs.every(q => ns.some(n => wm(q, n)))) return null;
    return [ns[0] === qs[0] ? 0 : wm(qs[0], ns[0]) ? 1 : 2, ns.length - qs.length];
  }
  const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };

  // ---------- טעינה ----------
  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status === 404 ? "עוד לא הורד" : "שגיאה " + r.status);
    return r.json();
  }

  let statusAt = 0;
  async function load(selected) {
    // קובץ הסטטוס מתעדכן פעם בכמה שעות, אז לא צריך לבקש אותו בכל שינוי ברשימה
    if (Date.now() - statusAt > 5 * 60 * 1000) { status = await getJSON("data/status.json").catch(() => null); statusAt = Date.now(); }
    for (const c of Object.keys(data)) if (selected[c] !== data[c].store) delete data[c];
    await Promise.all(Object.entries(selected).map(async ([chain, store]) => {
      if (data[chain]?.store === store) return;
      try {
        const j = await getJSON(`data/prices/${chain}-${store}.json`);
        const byCode = new Map();
        for (const it of j.items) { it[4] = stems(it[1]); byCode.set(it[0], it); }
        data[chain] = { store, updated: j.updated, items: j.items, byCode };
      } catch (e) {
        data[chain] = { store, missing: e.message, items: [], byCode: new Map() };
      }
    }));
  }

  // ---------- חיפוש ----------
  function search(query, limit = 30) {
    const q = String(query || "").trim();
    if (!q) return [];
    const digits = /^\d+$/.test(q) ? q.replace(/^0+/, "") : null;
    const qs = stems(q);
    const groups = new Map();
    for (const [chain, d] of Object.entries(data)) {
      for (const it of d.items) {
        const [code, name, price, w, ns] = it;
        const score = digits ? (code === digits ? [0, 0] : null) : nameScore(qs, ns);
        if (!score) continue;
        // מוצרים במשקל (ירקות, פירות) מקבלים קוד אחר בכל רשת, אז מקבצים אותם לפי שם
        const key = w ? "w:" + ns.join(" ") : code;
        let g = groups.get(key);
        if (!g) groups.set(key, g = { code, name, weighted: !!w, prices: {}, score });
        g.prices[chain] = price;
        if (name.length < g.name.length) g.name = name;
      }
    }
    return [...groups.values()]
      .sort((a, b) => cmp([a.score[0], -Object.keys(a.prices).length, a.score[1], a.name.length],
                          [b.score[0], -Object.keys(b.prices).length, b.score[1], b.name.length]))
      .slice(0, limit);
  }

  // מוצר דומה ברשת שאין בה את אותו ברקוד (בעיקר ירקות ופירות, שלכל רשת קוד משלה)
  function similar(chain, refName, weighted) {
    const qs = stems(refName);
    if (!qs.length) return null;
    let best = null;
    for (const it of data[chain].items) {
      if (weighted !== null && !!it[3] !== weighted) continue;
      const ns = it[4];
      if (!ns.length || !wm(qs[0], ns[0])) continue;
      const overlap = qs.filter(q => ns.some(n => wm(q, n))).length / qs.length;
      if (overlap < 0.5) continue;
      const key = [-overlap, ns.length, it[2]];
      if (!best || cmp(key, best.key) < 0) best = { key, it };
    }
    return best ? best.it : null;
  }

  // items: [{code, qty, unit, kg, name, product}] -> סכום לכל רשת. מוצר במשקל: מחיר לק"ג × ק"ג.
  function compare(items) {
    const chains = Object.keys(data).filter(c => !data[c].missing);
    const result = Object.fromEntries(chains.map(c => [c, { chain: c, name: CHAIN_NAMES[c], store: data[c].store, total: 0, found: 0, missing: [] }]));
    const lines = items.map(it => {
      const code = String(it.code || "").replace(/^0+/, "");
      const qty = Number(it.qty) || 1, byKg = it.unit === "kg";
      const kg = Number(it.kg) || (byKg ? qty : qty * 0.2);
      const units = byKg ? Math.max(1, Math.round(qty)) : qty;
      const exact = {};
      for (const c of chains) { const r = data[c].byCode.get(code); if (r) exact[c] = r; }
      const ref = Object.values(exact)[0];
      const weighted = ref ? !!ref[3] : (byKg ? true : null);
      const refName = (ref && ref[1]) || it.product || it.name || "";
      const line = { name: it.name, code, qty, kg: Math.round(kg * 100) / 100, units, weighted: !!weighted, prices: {}, approx: {}, codes: {}, names: {} };
      for (const c of chains) {
        let r = exact[c];
        if (!r) { r = similar(c, refName, weighted); if (r) line.approx[c] = r[1]; }
        if (r) {
          line.prices[c] = r[2]; line.codes[c] = r[0]; line.names[c] = r[1];
          result[c].total += r[2] * (r[3] ? kg : units);
          result[c].found++;
        } else result[c].missing.push(it.name);
      }
      return line;
    });
    for (const r of Object.values(result)) r.total = Math.round(r.total * 100) / 100;
    return { chains: Object.values(result).sort((a, b) => b.found - a.found || a.total - b.total), lines };
  }

  const stores = chain => getJSON(`data/stores/${chain}.json`);

  return { CHAIN_NAMES, load, search, compare, stores, info: () => ({ status, data }) };
})();
