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
    if (w.length > 5 && w.endsWith("ית")) return w.slice(0, -1);   // עגבנית = עגבניה, טבעית = טבעי
    return w;
  }
  const stems = t => String(t || "").trim().split(/\s+/).map(stem).filter(Boolean);
  // שום != שומר, חלב != חלבה: במילים קצרות דורשים התאמה מלאה
  const wm = (q, n) => n === q || (q.length >= 4 && n.startsWith(q));
  // typing: המילה האחרונה עוד נכתבת, אז היא מתאימה גם לתחילת מילה ("עגב" -> עגבניות)
  function nameScore(qs, ns, typing) {
    if (!ns.length || !qs.length) return null;
    const last = qs.length - 1;
    const ok = (q, i) => ns.some(n => wm(q, n) || (typing && i === last && q.length >= 2 && n.startsWith(q)));
    if (!qs.every(ok)) return null;
    const exact = qs.filter(q => ns.includes(q)).length;
    return [ns[0] === qs[0] ? 0 : wm(qs[0], ns[0]) ? 1 : 2, qs.length - exact, ns.length - qs.length];
  }
  const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };

  // ---------- טעינה ----------
  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status === 404 ? "עוד לא הורד" : "שגיאה " + r.status);
    return r.json();
  }

  // מחירים שהאפליקציה הורידה בעצמה (חצי חינם: הקובץ הרשמי, מהחיבור שלך) – במקום הקובץ מ-GitHub
  const local = {};
  function setLocal(chain, json) {
    local[chain] = json;
    if (data[chain]?.store === json.store) delete data[chain]; // ייטען מחדש מהמקומי
    vocab = null;
  }

  let statusAt = 0;
  async function load(selected) {
    // קובץ הסטטוס מתעדכן פעם בכמה שעות, אז לא צריך לבקש אותו בכל שינוי ברשימה
    if (Date.now() - statusAt > 5 * 60 * 1000) { status = await getJSON("data/status.json").catch(() => null); statusAt = Date.now(); }
    for (const c of Object.keys(data)) if (selected[c] !== data[c].store) { delete data[c]; vocab = null; }
    await Promise.all(Object.entries(selected).map(async ([chain, store]) => {
      if (data[chain]?.store === store) return;
      vocab = null;
      try {
        const j = local[chain]?.store === store ? local[chain] : await getJSON(`data/prices/${chain}-${store}.json`);
        const byCode = new Map();
        for (const it of j.items) { it[4] = stems(it[1]); byCode.set(it[0], it); }
        data[chain] = { store, updated: j.updated, items: j.items, byCode };
      } catch (e) {
        data[chain] = { store, missing: e.message, items: [], byCode: new Map() };
      }
    }));
  }

  // ---------- חיפוש ----------
  function search(query, limit = 30, typing = false) {
    const q = String(query || "").trim();
    if (!q) return [];
    const digits = /^\d+$/.test(q) ? q.replace(/^0+/, "") : null;
    const qs = stems(q);
    const groups = new Map();
    for (const [chain, d] of Object.entries(data)) {
      for (const it of d.items) {
        const [code, name, price, w, ns] = it;
        const score = digits ? (code === digits ? [0, 0, 0] : null) : nameScore(qs, ns, typing);
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
      .sort((a, b) => cmp([a.score[0], a.score[1], -Object.keys(a.prices).length, a.score[2], a.name.length],
                          [b.score[0], b.score[1], -Object.keys(b.prices).length, b.score[2], b.name.length]))
      .slice(0, limit);
  }

  // ---------- תיקון איות ----------
  // אוצר המילים מכל שמות המוצרים בסניפים שנבחרו: שורש -> [כמה מוצרים, איך המילה כתובה]
  let vocab = null, byStem = null;   // byStem: שורש -> המוצרים שיש בהם את המילה (לבדיקה מהירה של תיקון)
  function getVocab() {
    if (vocab) return vocab;
    vocab = new Map(); byStem = new Map();
    for (const d of Object.values(data)) for (const it of d.items) for (const raw of String(it[1]).split(/\s+/)) {
      const word = raw.replace(/["'׳״.,()\/\-]/g, "");
      if (word.length < 2 || /[\d%]/.test(word)) continue;
      const s = stem(word), v = vocab.get(s);
      if (v) { v[0]++; v[2].set(word, (v[2].get(word) || 0) + 1); byStem.get(s).push(it); }
      else { vocab.set(s, [1, word, new Map([[word, 1]])]); byStem.set(s, [it]); }
    }
    // הצורה הנפוצה של כל מילה (צהובה ולא צהוב)
    for (const v of vocab.values()) { let best = 0; for (const [f, n] of v[2]) if (n > best) { best = n; v[1] = f; } v[2] = null; }
    return vocab;
  }
  // כמה מוצרים (עד 3) מתאימים לחיפוש, כשידוע שמילה אחת בו היא keyStem
  function quickCount(words, keyStem) {
    const qs = stems(words.join(" "));
    let n = 0;
    for (const it of byStem.get(keyStem) || []) if (nameScore(qs, it[4], true) && ++n >= 3) break;
    return n;
  }
  // אותיות שנשמעות דומה (ט/ת, כ/ק, ס/ש, א/ע, ב/ו, ח/כ) עולות חצי; גם הוספה/השמטה של ו/י (כתיב מלא/חסר)
  const SOUND = new Set(["טת", "תט", "כק", "קכ", "סש", "שס", "אע", "עא", "בו", "וב", "חכ", "כח"]);
  const sub = (a, b) => a === b ? 0 : SOUND.has(a + b) ? 0.5 : 1;
  const indel = c => c === "ו" || c === "י" ? 0.5 : 1;
  function dist(a, b, max) {
    let prev2 = null, prev = [0];
    for (let j = 1; j <= b.length; j++) prev[j] = prev[j - 1] + indel(b[j - 1]);
    for (let i = 1; i <= a.length; i++) {
      const cur = [prev[0] + indel(a[i - 1])];
      let rowMin = cur[0];
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(prev[j] + indel(a[i - 1]), cur[j - 1] + indel(b[j - 1]), prev[j - 1] + sub(a[i - 1], b[j - 1]));
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return Infinity;
      prev2 = prev; prev = cur;
    }
    return prev[b.length];
  }
  // המילים הכי קרובות שקיימות במוצרים (partial: המילה עוד נכתבת, משווים גם לתחילת מילים)
  function candidates(s, partial, n = 4) {
    const max = s.length <= 2 ? 0 : s.length <= 5 ? 1 : 2;
    if (!max) return [];
    const out = [];
    for (const [w, [count, surface]] of getVocab()) {
      if (Math.abs(w.length - s.length) > max && !(partial && w.length > s.length)) continue;
      let d = dist(s, w, max);
      if (partial && w.length > s.length) d = Math.min(d, dist(s, w.slice(0, s.length), max) + 0.25);
      if (d > max || d === 0) continue;
      out.push({ d, count, surface, stem: w });
    }
    return out.sort((a, b) => a.d - b.d || b.count - a.count).slice(0, n);
  }
  // בכמה מוצרים המילה מופיעה (כולל כמילה שמתחילה בה)
  function frequency(s, partial) {
    const v = getVocab();
    let n = v.get(s)?.[0] || 0;
    if ((partial && s.length >= 2) || s.length >= 4) for (const [w, [c]] of v) if (w !== s && w.startsWith(s)) n += c;
    return n;
  }
  // השלמה בזמן הקלדה: מוצרים כמו שהם כתובים ברשתות, ואם יש שגיאת כתיב גם "האם התכוונת ל..."
  // מחליפים מילה רק אם התיקון באמת מוצא יותר מוצרים (שוקולד פרע -> פרה ולא פרא)
  function suggest(query, limit = 8) {
    const words = String(query || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { results: [], fixed: null };
    let results = search(query, limit, true);
    if (results.length >= 3 || /^\d+$/.test(query.trim())) return { results, fixed: null };
    const fw = [...words];
    let found = results.length, changed = false;
    words.forEach((w, i) => {
      if (/[\d%]/.test(w)) return;
      const s = stem(w), last = i === words.length - 1;
      const own = frequency(s, last);
      // כשכבר נמצאו מוצרים, מילה שקיימת מוחלפת רק במילה נפוצה בהרבה
      const cands = candidates(s, last, 30).filter(c => !own || !found || c.count >= 5 * own);
      let best = null;
      for (const c of cands) {
        const t = [...fw]; t[i] = c.surface;
        const n = quickCount(t, c.stem);
        if (n > found && (!best || n > best.n)) best = { n, surface: c.surface };
      }
      if (best) { fw[i] = best.surface; found = best.n; changed = true; }
    });
    if (!changed) return { results, fixed: null };
    const fixed = fw.join(" ");
    const fr = search(fixed, limit, true), seen = new Set(fr.map(r => r.code));
    results = fr.concat(results.filter(r => !seen.has(r.code))).slice(0, limit);
    return { results, fixed };
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

  // מוצר לפי ברקוד (סריקה): השם והמחירים בכל הרשתות שנטענו
  function lookup(barcode) {
    const code = String(barcode || "").replace(/\D/g, "").replace(/^0+/, "");
    if (!code) return null;
    let found = null;
    for (const [chain, d] of Object.entries(data)) {
      const it = d.byCode.get(code);
      if (!it) continue;
      found ||= { code, name: it[1], weighted: !!it[3], prices: {} };
      found.prices[chain] = it[2];
      if (it[1].length < found.name.length) found.name = it[1];
    }
    return found;
  }

  // תמונת מוצר לפי ברקוד (אין תמונות בקובצי המחירים). ירקות ופירות במשקל הם בלי ברקוד אמיתי.
  function images(code) {
    const c = String(code || "").replace(/^0+/, "");
    return /^\d{8,14}$/.test(c) ? [`https://m.pricez.co.il/ProductPictures/${c}.jpg`, `https://img.rami-levy.co.il/product/${c}/small.jpg`] : [];
  }

  // האם המילה מופיעה בשמות המוצרים (לפיצול משפט מוקלט: "חלב ולחם" -> חלב, לחם)
  const isWord = w => getVocab().has(stem(w));

  return { CHAIN_NAMES, load, setLocal, search, suggest, lookup, isWord, images, compare, stores, info: () => ({ status, data, local }) };
})();
