// מועדי משלוח באפליקציית האנדרואיד. אותו היגיון כמו בתוסף לכרום (extension/background.js),
// רק שהבקשות לאתרי הרשתות עוברות דרך האפליקציה (window.SuperlistNative.http) – כי דף אינטרנט לא יכול לקרוא אותן ישירות.
// ההתחברות לשופרסל/חצי חינם נשמרת באפליקציה (כשנכנסים אליהן במילוי עגלה), אז גם המועדים שלהן מופיעים.
// תוצאה לכל רשת: {ok, from: "YYYY-MM-DDTHH:MM" (שעון ישראל), to, price, area} או {ok:false, reason, login}
"use strict";
const Slots = (() => {
  // ---------- בקשות דרך האפליקציה ----------
  const waiting = {};
  let seq = 0;
  window.__nativeHttp = (id, status, text) => { const w = waiting[id]; if (w) { delete waiting[id]; w({ status, text }); } };
  const available = () => !!(window.SuperlistNative && window.SuperlistNative.http);
  function fetchNative(url, opts = {}) {
    return new Promise((resolve, reject) => {
      const id = "h" + (++seq);
      const timer = setTimeout(() => { delete waiting[id]; reject(new Error("timeout")); }, 25000);
      waiting[id] = ({ status, text }) => {
        clearTimeout(timer);
        if (status <= 0) return reject(new Error(text || "network"));
        resolve({ ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) });
      };
      window.SuperlistNative.http(id, url, opts.method || "GET", JSON.stringify(opts.headers || {}), opts.body || "");
    });
  }

  // קובץ בינארי (קובץ מחירים gz) דרך האפליקציה – מחזיר ArrayBuffer. רק בגרסאות שיש בהן httpBinary.
  const binaryAvailable = () => !!(window.SuperlistNative && window.SuperlistNative.httpBinary);
  function fetchBinary(url) {
    return new Promise((resolve, reject) => {
      const id = "b" + (++seq);
      const timer = setTimeout(() => { delete waiting[id]; reject(new Error("timeout")); }, 90000);
      waiting[id] = ({ status, text }) => {
        clearTimeout(timer);
        if (status < 200 || status >= 300) return reject(new Error(status ? "HTTP " + status : text || "network"));
        const bin = atob(text), out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        resolve(out.buffer);
      };
      window.SuperlistNative.httpBinary(id, url);
    });
  }

  const pad = n => String(n).padStart(2, "0");
  const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const hhmm = s => { const m = String(s || "").match(/(\d{1,2}):(\d{2})/); return m ? `${pad(m[1])}:${m[2]}` : null; };
  const clean = s => String(s || "").replace(/["'״׳\-]/g, " ").replace(/\s+/g, " ").trim();
  const first = slots => slots.filter(s => s.from > nowLocal()).sort((a, b) => a.from.localeCompare(b.from))[0];
  async function json(url, opts) {
    const r = await fetchNative(url, opts);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  // ---------- קרפור, טיב טעם, ויקטורי (אותה פלטפורמה; ציבורי, לפי עיר) ----------
  const SP = {
    carrefour: { base: "https://www.carrefour.co.il", rid: 1540 },
    // לאתר של טיב טעם חסרה תעודת ביניים (אנדרואיד דוחה); אותה פלטפורמה עונה לכל רשת גם מהכתובת של קרפור
    tivtaam: { base: "https://www.carrefour.co.il", rid: 1062 },
    victory: { base: "https://www.victoryonline.co.il", rid: 1470 },
  };
  // רוב אזורי המשלוח שם מוגדרים כשטח על המפה (ולא כשם עיר), אז מאתרים את הכתובת על המפה (OpenStreetMap)
  // ובודקים באיזה אזור היא נמצאת. נשמר במכשיר לכל כתובת, כדי לא לשאול שוב.
  async function geocode(addr) {
    const q = [addr.street && `${addr.street} ${addr.num || ""}`.trim(), addr.city].filter(Boolean).join(", ");
    const key = "superlist-geo:" + q;
    try { const c = JSON.parse(localStorage.getItem(key) || "null"); if (c) return c; } catch {}
    try {
      const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il&accept-language=he&q=" + encodeURIComponent(q));
      const g = (await r.json())[0];
      if (!g) return null;
      const p = { lat: +g.lat, lon: +g.lon };
      try { localStorage.setItem(key, JSON.stringify(p)); } catch {}
      return p;
    } catch { return null; }
  }
  const inRing = (ring, y, x) => {
    let ins = false;
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const [yi, xi] = ring[i], [yk, xk] = ring[k];
      if ((yi > y) !== (yk > y) && x < (xk - xi) * (y - yi) / (yk - yi) + xi) ins = !ins;
    }
    return ins;
  };
  const cityName = s => clean(String(s || "").replace(/(^|\s)ת["״]?א(?=\s|$)/g, "$1תל אביב").replace(/תל אביב\s*יפו/g, "תל אביב"));
  async function spSlot({ base, rid }, addr) {
    if (!addr.city) return { ok: false, reason: "חסרה עיר בהגדרות" };
    const j = await json(`${base}/v2/retailers/${rid}/areas?appId=4&deliveryTypeId=1`);
    const areas = (j.areas || [j]).filter(a => a.isActive !== false && !a.isBranchDisabled);
    const pt = await geocode(addr);
    const c = cityName(addr.city);
    const names = a => [a.name, ...(a.names || []).map(n => n.name)].map(cityName).filter(Boolean);
    const area = (pt && areas.find(a => (a.polygons || []).some(r => r.length > 2 && inRing(r, pt.lat, pt.lon))))
      || areas.find(a => names(a).some(n => n === c))
      || areas.find(a => names(a).some(n => n.includes(c) || c.includes(n)));
    if (!area) return { ok: false, reason: "אין משלוחים לכתובת" };
    const b = await json(`${base}/v2/retailers/${rid}/branches/${area.branchId}/areas?appId=4&deliveryTypeId=1&languageId=1`);
    const full = (b.areas || [b]).find(a => a.id === area.id) || area;
    // השעות מסומנות כ-UTC אבל הן שעון ישראל
    const slots = (full.times?.localDelivery?.["1"] || []).flatMap(d => d.times || [])
      .filter(t => t.isActive !== false && !t.isFull && t.newFrom)
      .map(t => ({ from: t.newFrom.slice(0, 16), to: (t.newTo || "").slice(0, 16), price: t.deliveryTimePrice ?? null }));
    const s = first(slots);
    return s ? { ok: true, ...s, area: area.name } : { ok: false, reason: "אין חלונות פנויים" };
  }

  // ---------- רמי לוי (ציבורי, לפי כתובת מלאה) ----------
  // רמי לוי: החיפוש שלהם קפדני ("פתח תקוה" לא נמצא, רק "פתח תקווה"; "רחוב הרצל" לא נמצא, רק "הרצל";
  // ויש ערים שמופיעות פעמיים), אז מנסים כמה כתיבים ובודקים כל עיר מתאימה
  const loose = s => clean(s).replace(/[וי]/g, "").replace(/\s+/g, " ");
  const cityTries = c => [...new Set([c, c.replace(/קרית/g, "קריית"), c.replace(/קריית/g, "קרית"), c.replace(/תקוה/g, "תקווה"),
    clean(c), ...clean(c).split(" ").filter(w => w.length > 2)])];
  const streetTries = s => {
    const b = clean(String(s).replace(/^\s*(רחוב|רח'|רח|שדרות|שד'|שד)\s+/, ""));
    return [...new Set([String(s).trim(), b, ...b.split(" ").filter(w => w.length > 2).sort((x, y) => y.length - x.length)])];
  };
  const near = (a, b) => loose(a) === loose(b) || loose(a).includes(loose(b)) || loose(b).includes(loose(a));
  // מרחק עריכה קטן: "ז'בוטינסקי" / "זבוטינסקי" / "ז'בוטינסקיי"
  const editDist = (a, b) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  async function ramiAddress(addr) {
    // מספר בית שנכתב בתוך שם הרחוב ("הרצל 12")
    const street = String(addr.street || "").replace(/\s*\d+\s*[א-ת]?\s*$/, "").trim() || String(addr.street || "");
    let cities = [];
    for (const q of cityTries(addr.city)) {
      const r = await json("https://www.rami-levy.co.il/api/address-autocomplete/city?q=" + encodeURIComponent(q));
      const list = r.data || [];
      cities = list.filter(x => loose(x.city_name) === loose(addr.city));
      if (!cities.length) cities = list.filter(x => near(x.city_name, addr.city));
      if (cities.length) break;
    }
    if (!cities.length) return { reason: `העיר "${addr.city}" לא נמצאה ברמי לוי` };
    const seen = [];
    for (const city of cities.slice(0, 3)) {
      const tries = streetTries(street);
      // ולבסוף: תחילת המילה הארוכה, כדי למצוא את הרחוב גם עם שגיאת כתיב
      const longest = clean(street).split(" ").sort((x, y) => y.length - x.length)[0] || "";
      if (longest.length >= 3) tries.push(longest.slice(0, 2));
      for (const q of [...new Set(tries)]) {
        const r = await json(`https://www.rami-levy.co.il/api/address-autocomplete/street?q=${encodeURIComponent(q)}&city_id=${city.city_id}`);
        const list = (r.data || []).filter(x => x.city_id == city.city_id);
        seen.push(...list);
        const st = list.find(x => loose(x.street_name) === loose(street)) || list.find(x => near(x.street_name, street));
        if (st) return { city, st };
      }
      // הכי קרוב בכתיב (עד 2 אותיות הבדל)
      const scored = seen.filter(x => x.city_id == city.city_id).map(x => [editDist(loose(x.street_name), loose(street)), x]).sort((a, b) => a[0] - b[0]);
      if (scored[0] && scored[0][0] <= Math.max(1, Math.min(2, Math.floor(loose(street).length / 4)))) return { city, st: scored[0][1] };
    }
    const maybe = [...new Set(seen.map(x => x.street_name))].slice(0, 3);
    return { reason: `הרחוב "${street}" לא נמצא ברמי לוי${maybe.length ? ` (אולי: ${maybe.join(", ")})` : ""} – תקן בהגדרות` };
  }

  async function ramiSlot(addr) {
    if (!addr.city || !addr.street || !addr.num) return { ok: false, reason: "צריך עיר, רחוב ומספר בהגדרות" };
    const found = await ramiAddress(addr);
    if (!found.city) return { ok: false, reason: found.reason };
    const { city, st } = found;
    const r = await json("https://www-api.rami-levy.co.il/api/v2/site/supply/get-supply-date", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ only_area_availability: false, city_id: city.city_id, street_id: st.street_id, street_name: st.street_name,
        home_num: String(addr.num), entrance: null, is_save_request: false, user_id: null }) });
    if (String(r.status) !== "200" || !r.data) return { ok: false, reason: r.message === "Need specific address" ? "צריך כתובת מלאה" : "אין משלוחים לכתובת" };
    const slots = Object.values(r.data).flat().filter(t => t.active)
      .map(t => ({ from: `${t.date}T${hhmm(t.fromHour)}`, to: `${t.date}T${hhmm(t.toHour)}`, price: t.deliveryCost ?? null }));
    const s = first(slots);
    return s ? { ok: true, ...s } : { ok: false, reason: "אין חלונות פנויים" };
  }

  // ---------- יוחננוף (ציבורי; לפי סניף ברירת המחדל של האתר) ----------
  async function yochananofSlot() {
    const j = await json("https://api.yochananof.co.il/graphql", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ deliverySlots { date timeslots { available label } } }" }) });
    const slots = (j.data?.deliverySlots || []).flatMap(d => (d.timeslots || []).filter(t => t.available).map(t => {
      const [a, b] = String(t.label).split("-").map(hhmm);
      return { from: `${d.date}T${a}`, to: `${d.date}T${b}`, price: null };
    })).filter(s => !s.from.includes("null"));
    const s = first(slots);
    return s ? { ok: true, ...s, note: "לפי סניף ברירת המחדל" } : { ok: false, reason: "אין חלונות פנויים" };
  }

  // ---------- חצי חינם (צריך להיות מחובר לאתר באפליקציה) ----------
  const LOGIN_HAZI = { ok: false, reason: "התחבר לחצי חינם (במילוי עגלה)", login: true };
  async function haziSlot() {
    let j;
    try { j = await json("https://shop.hazi-hinam.co.il/proxy/api/delivery/getNextDeliveries"); }
    catch (e) { if (/40[13]/.test(e.message)) return LOGIN_HAZI; throw e; }
    const list = (j.Results?.Addresses || []).flatMap(a => a.Shipments || []);
    if (!list.length && !(j.Results?.Addresses || []).length) return LOGIN_HAZI;
    const slots = list.filter(s => !s.IsClosedShipment && !s.IsExceeds && s.Date).map(s => {
      const [d, m, y] = s.Date.split("/");
      return { from: `${y}-${m}-${d}T${hhmm(s.Time?.From)}`, to: `${y}-${m}-${d}T${hhmm(s.Time?.To)}`, price: null };
    });
    const s = first(slots);
    return s ? { ok: true, ...s } : { ok: false, reason: "אין חלונות פנויים" };
  }

  // ---------- שופרסל (צריך להיות מחובר לאתר באפליקציה) ----------
  // שופרסל מחזירה {"20261103": [{fromHourString, toHour, selectable, price}, ...]} (כמו שהאתר שלהם קורא אותה)
  const ilLocal = v => { const d = new Date(v); return isNaN(d) ? null : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function shufersalSlots(j) {
    const out = [];
    for (const [day, list] of Object.entries(j || {})) {
      if (!/^\d{8}$/.test(day) || !Array.isArray(list)) continue;
      for (const s of list) {
        if (s.selectable === false) continue;
        const from = ilLocal(s.fromHourString ?? s.fromHour), to = ilLocal(s.toHourString ?? s.toHour);
        if (from) out.push({ from, to, price: s.price?.value ?? null });
      }
    }
    return out;
  }
  async function shufersalSlot() {
    const r = await fetchNative("https://www.shufersal.co.il/online/he/timeSlot/preselection/getHomeDeliverySlots?amount=1.0&prescription=false",
      { headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (!j || !Object.keys(j).length) return { ok: false, reason: "התחבר לשופרסל (במילוי עגלה)", login: true };
    const direct = first(shufersalSlots(j));
    if (direct) return { ok: true, ...direct };
    const slots = [];
    const walk = (o, ctxDate) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach(x => walk(x, ctxDate));
      const vals = Object.entries(o);
      let date = ctxDate, from = null, to = null, available = true;
      for (const [k, v] of vals) {
        if (typeof v === "string") {
          const iso = v.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
          const il = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
          if (/date|day/i.test(k) && (iso || il)) date = iso ? iso[1] : `${il[3]}-${pad(il[2])}-${pad(il[1])}`;
          if (/start|from|begin/i.test(k)) from = iso?.[2] || hhmm(v) || from;
          if (/end|to$|until/i.test(k)) to = iso?.[2] || hhmm(v) || to;
          if (iso && iso[2] && /start|from/i.test(k)) date = iso[1];
        }
        if (typeof v === "boolean" && /full|disabled|blocked|closed|soldout/i.test(k) && v) available = false;
        if (typeof v === "boolean" && /^(is)?avail|enabled|selectable/i.test(k) && !v) available = false;
      }
      if (date && from && available) slots.push({ from: `${date}T${from}`, to: to ? `${date}T${to}` : null, price: null });
      for (const [, v] of vals) if (v && typeof v === "object") walk(v, date);
    };
    walk(j);
    const s = first(slots);
    return s ? { ok: true, ...s } : { ok: false, reason: "לא נמצא חלון פנוי" };
  }

  const FETCHERS = {
    carrefour: a => spSlot(SP.carrefour, a),
    tivtaam: a => spSlot(SP.tivtaam, a),
    victory: a => spSlot(SP.victory, a),
    ramilevy: ramiSlot,
    yochananof: yochananofSlot,
    hazihinam: haziSlot,
    shufersal: shufersalSlot,
    wolt: async () => ({ ok: true, eta: "תוך כשעה", note: "הזמנה באפליקציית Wolt" }),
  };

  async function get(address = {}, chains = Object.keys(FETCHERS)) {
    const results = {};
    await Promise.all(chains.filter(c => FETCHERS[c]).map(async c => {
      try { results[c] = await FETCHERS[c](address); }
      catch (e) { results[c] = { ok: false, reason: "שגיאה: " + String(e.message || e).slice(0, 60) }; }
    }));
    results._at = Date.now();
    return results;
  }

  return { available, get, fetch: fetchNative, binaryAvailable, fetchBinary };
})();
