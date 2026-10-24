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
  async function spSlot({ base, rid }, addr) {
    if (!addr.city) return { ok: false, reason: "חסרה עיר בהגדרות" };
    const j = await json(`${base}/v2/retailers/${rid}/areas?appId=4&deliveryTypeId=1`);
    const areas = j.areas || [j];
    const c = clean(addr.city);
    const area = areas.find(a => (a.names || []).some(n => clean(n.name) === c))
      || areas.find(a => (a.names || []).some(n => clean(n.name).includes(c) || c.includes(clean(n.name))));
    if (!area) return { ok: false, reason: "אין משלוחים לעיר" };
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
  async function ramiSlot(addr) {
    if (!addr.city || !addr.street || !addr.num) return { ok: false, reason: "צריך עיר, רחוב ומספר בהגדרות" };
    const cities = await json("https://www.rami-levy.co.il/api/address-autocomplete/city?q=" + encodeURIComponent(addr.city));
    const cl = cities.data || cities;
    const city = (cl.find && cl.find(x => clean(x.city_name) === clean(addr.city))) || cl[0];
    if (!city) return { ok: false, reason: "העיר לא נמצאה" };
    const streets = await json(`https://www.rami-levy.co.il/api/address-autocomplete/street?q=${encodeURIComponent(addr.street)}&city_id=${city.city_id}`);
    const sl = streets.data || streets;
    const st = (sl.find && (sl.find(x => x.city_id == city.city_id && clean(x.street_name) === clean(addr.street)) || sl.find(x => x.city_id == city.city_id)));
    if (!st) return { ok: false, reason: "הרחוב לא נמצא" };
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
  async function shufersalSlot() {
    const r = await fetchNative("https://www.shufersal.co.il/online/he/timeSlot/preselection/getHomeDeliverySlots?amount=1.0&prescription=false",
      { headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" } });
    const j = await r.json().catch(() => ({}));
    if (!j || !Object.keys(j).length) return { ok: false, reason: "התחבר לשופרסל (במילוי עגלה)", login: true };
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

  return { available, get, fetch: fetchNative };
})();
