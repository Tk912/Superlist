// מביא את חלון המשלוח הקרוב מכל רשת. רץ בדפדפן שלך, עם ההתחברות שלך לאתרים (כמו כשאתה גולש בהם).
// לא קונה, לא משנה כלום בחשבון: רק קורא מועדי משלוח.
// תוצאה לכל רשת: {ok, from: "YYYY-MM-DDTHH:MM" (שעון ישראל), to, price, area} או {ok:false, reason, login}

const CACHE_MS = 10 * 60 * 1000;
const pad = n => String(n).padStart(2, "0");
const nowLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const hhmm = s => { const m = String(s || "").match(/(\d{1,2}):(\d{2})/); return m ? `${pad(m[1])}:${m[2]}` : null; };
const clean = s => String(s || "").replace(/["'״׳\-]/g, " ").replace(/\s+/g, " ").trim();
const first = slots => slots.filter(s => s.from > nowLocal()).sort((a, b) => a.from.localeCompare(b.from))[0];

async function json(url, opts = {}) {
  const r = await fetch(url, { credentials: "include", ...opts });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// ---------- קרפור, טיב טעם, ויקטורי (אותה פלטפורמה; ציבורי, לפי עיר) ----------
const SP = {
  carrefour: { base: "https://www.carrefour.co.il", rid: 1540 },
  tivtaam: { base: "https://www.tivtaam.co.il", rid: 1062 },
  victory: { base: "https://www.victoryonline.co.il", rid: 1470 },
};
// רוב אזורי המשלוח שם מוגדרים כשטח על המפה (ולא כשם עיר), אז מאתרים את הכתובת על המפה (OpenStreetMap)
// ובודקים באיזה אזור היא נמצאת. נשמר לכל כתובת, כדי לא לשאול שוב.
async function geocode(addr) {
  const q = [addr.street && `${addr.street} ${addr.num || ""}`.trim(), addr.city].filter(Boolean).join(", ");
  const key = "geo:" + q;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached) return cached;
  try {
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il&accept-language=he&q=" + encodeURIComponent(q));
    const g = (await r.json())[0];
    if (!g) return null;
    const p = { lat: +g.lat, lon: +g.lon };
    await chrome.storage.local.set({ [key]: p });
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
  // השעות מסומנות כ-UTC אבל הן שעון ישראל (האתר מציג 10:00 עבור 10:00Z)
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
  const city = (cities.data || cities).find?.(x => clean(x.city_name) === clean(addr.city)) || (cities.data || cities)[0];
  if (!city) return { ok: false, reason: "העיר לא נמצאה" };
  const streets = await json(`https://www.rami-levy.co.il/api/address-autocomplete/street?q=${encodeURIComponent(addr.street)}&city_id=${city.city_id}`);
  const st = (streets.data || streets).find?.(x => x.city_id == city.city_id && clean(x.street_name) === clean(addr.street))
    || (streets.data || streets).find?.(x => x.city_id == city.city_id);
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

// ---------- חצי חינם (צריך להיות מחובר לאתר בכרום, עם כתובת בחשבון) ----------
async function haziSlot() {
  let j;
  try { j = await json("https://shop.hazi-hinam.co.il/proxy/api/delivery/getNextDeliveries"); }
  catch (e) { if (/40[13]/.test(e.message)) return { ok: false, reason: "התחבר לחצי חינם בכרום", login: true }; throw e; }
  const list = (j.Results?.Addresses || []).flatMap(a => a.Shipments || []);
  if (!list.length && !(j.Results?.Addresses || []).length) return { ok: false, reason: "התחבר לחצי חינם בכרום", login: true };
  const slots = list.filter(s => !s.IsClosedShipment && !s.IsExceeds && s.Date).map(s => {
    const [d, m, y] = s.Date.split("/");
    return { from: `${y}-${m}-${d}T${hhmm(s.Time?.From)}`, to: `${y}-${m}-${d}T${hhmm(s.Time?.To)}`, price: null };
  });
  const s = first(slots);
  return s ? { ok: true, ...s } : { ok: false, reason: "אין חלונות פנויים" };
}

// ---------- שופרסל (צריך להיות מחובר לאתר בכרום, עם כתובת בחשבון) ----------
// המבנה של התשובה למשתמש מחובר לא נבדק, אז מחפשים בה כל תאריך+שעה עם סימון זמינות.
async function shufersalSlot() {
  const r = await fetch("https://www.shufersal.co.il/online/he/timeSlot/preselection/getHomeDeliverySlots?amount=1.0&prescription=false",
    { credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!j || !Object.keys(j).length) return { ok: false, reason: "התחבר לשופרסל בכרום", login: true };
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

async function getSlots(address = {}, chains = Object.keys(FETCHERS), force = false) {
  const key = "slots:" + JSON.stringify(address);
  const cached = (await chrome.storage.session.get(key))[key];
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.results;
  const results = {};
  await Promise.all(chains.filter(c => FETCHERS[c]).map(async c => {
    try { results[c] = await FETCHERS[c](address); }
    catch (e) { results[c] = { ok: false, reason: "שגיאה: " + String(e.message || e).slice(0, 60) }; }
  }));
  results._at = Date.now();
  await chrome.storage.session.set({ [key]: { at: Date.now(), results } });
  return results;
}

// דף מתכון לייבוא (רק קריאה, בלי ההתחברות שלך לאתר)
// binary: קובץ (למשל קובץ מחירים gz של קרפור) – חוזר כ-base64
async function getPage(url, binary) {
  if (!/^https:\/\//.test(url || "")) return { ok: false, status: 0, text: "https only" };
  const r = await fetch(url, { credentials: "omit", redirect: "follow" });
  if (binary) {
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { ok: r.ok, status: r.status, text: btoa(bin), binary: true };
  }
  const text = (await r.text()).slice(0, 3_000_000);
  return { ok: r.ok, status: r.status, text };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "page") {
    getPage(msg.url, msg.binary).then(reply, e => reply({ ok: false, status: 0, text: String(e) }));
    return true;
  }
  if (msg?.type !== "slots") return;
  getSlots(msg.address, msg.chains, msg.force).then(reply, e => reply({ _error: String(e) }));
  return true; // תשובה אסינכרונית
});
