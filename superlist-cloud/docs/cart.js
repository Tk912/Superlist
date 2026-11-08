// כפתור "מלא עגלה" (סימנייה). רץ בתוך אתר הסופר, בדפדפן שלך, כשאתה כבר מחובר לחשבון.
// מקבל את הרשימה מהאפליקציה (מהכתובת, מהלוח או מהדבקה), ומוסיף כל פריט לעגלה עם הבקשות של האתר עצמו.
// לא מבצע תשלום: בסוף נשארים בעגלה, ומשלמים בעצמכם.
(async () => {
  if (window.__slRunning) return;
  window.__slRunning = true;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const host = location.hostname;

  // ---------- חלונית התקדמות ----------
  const box = document.createElement("div");
  box.dir = "rtl";
  box.style.cssText = "position:fixed;z-index:2147483647;left:12px;right:12px;bottom:12px;margin:auto;max-width:520px;max-height:70vh;overflow:auto;" +
    "background:#fff;color:#1b2620;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.35);font:15px/1.45 system-ui,Arial,sans-serif;padding:14px 16px;border-top:6px solid #0f7a4a";
  box.innerHTML = '<div style="display:flex;align-items:center;gap:8px"><b style="flex:1">🛒 הסל החכם</b>' +
    '<button id="__sl_x" style="border:0;background:#eef2ef;border-radius:8px;padding:4px 10px;cursor:pointer">סגור</button></div>' +
    '<div id="__sl_head" style="margin:6px 0;font-weight:600">מתחיל…</div><div id="__sl_list" style="font-size:13px"></div>';
  document.documentElement.appendChild(box);
  const head = t => { box.querySelector("#__sl_head").textContent = t; };
  const row = (ok, name, note) => {
    const d = document.createElement("div");
    d.style.cssText = "padding:4px 0;border-bottom:1px solid #e3e8e4";
    d.textContent = (ok ? "✓ " : "✕ ") + name + (note ? " · " + note : "");
    if (!ok) d.style.color = "#b5470b";
    box.querySelector("#__sl_list").appendChild(d);
  };
  box.querySelector("#__sl_x").onclick = () => { box.remove(); window.__slRunning = false; };

  // ---------- הרשימה מהאפליקציה ----------
  const parse = t => { try { const j = JSON.parse(t); return j && j.superlist && Array.isArray(j.items) ? j : null; } catch { return null; } };
  let job = null;
  const m = location.hash.match(/sl=([^&]+)/);
  if (m) { try { job = parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, "+").replace(/_/g, "/"))))); } catch {} }
  if (!job) job = parse(sessionStorage.getItem("__sl_job") || "");
  if (!job) { try { job = parse(await navigator.clipboard.readText()); } catch {} }
  if (!job) job = parse(prompt("הדבק כאן את הרשימה שהעתקת מהאפליקציה (בלחיצה על \"שלח לסופר\"):") || "");
  if (!job) { head("לא נמצאה רשימה. באפליקציה לוחצים \"שלח לסופר\", ואז חוזרים לכאן ולוחצים שוב על הכפתור."); window.__slRunning = false; return; }
  sessionStorage.setItem("__sl_job", JSON.stringify(job));
  if (m) history.replaceState(null, "", location.pathname + location.search);

  // ---------- המתאמים לכל אתר ----------
  const round05 = x => Math.max(0.5, Math.round((x || 1) * 2) / 2);
  const units = it => Math.max(1, Math.round(it.qty || 1));

  // בחירת מוצר מתוצאות החיפוש של האתר. מוסיפים רק מוצר שבאמת מתאים לשם ברשימה – אף פעם לא "התוצאה הראשונה"
  // (החיפוש באתר מחזיר גם מוצרים אחרים: "עגבניות" -> "עגבניות שרי", "חלב" -> "שוקו"). אין התאמה בטוחה = לא מוסיפים.
  const FIN = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
  const stem = w => {
    w = w.replace(/["'׳״.,()\/\-]/g, "").replace(/[ךםןףץ]/g, c => FIN[c]);
    if (w.length > 4 && w.endsWith("ימ")) return w.slice(0, -2);
    const s = w.length > 4 && w.endsWith("ות") ? w.slice(0, -2) + "ה" : w;   // עגבניות = עגבניה, אבל חלבה != חלב
    if (s.length > 4 && s.endsWith("יה")) return s.slice(0, -1);
    if (s.length > 5 && s.endsWith("ית")) return s.slice(0, -1);
    return s;
  };
  const words = t => String(t || "").replace(/(\d)([א-ת])/g, "$1 $2").split(/[\s,]+/).map(stem).filter(Boolean);
  const NOISE = new Set(["רמי", "לוי", "שופרסל", "יוחננוף", "קרפור", "ויקטורי", "חצי", "חינמ", "בדצ", "כשר", "גרמ", "גר", "ג", "קג", "ל", "ליטר", "מל", "יח"]);
  // כתיב מלא/חסר: "נישנושי" = "נשנושי", "משולש" ~ "משולשי" (משווים גם בלי י/ו)
  const lo = s => s.replace(/[יו]/g, "");
  const wm = (q, n) => n === q || (q.length >= 4 && n.startsWith(q)) || (n.length >= 4 && q.startsWith(n) && q.length - n.length <= 1)
    || (q.length >= 4 && lo(q).length >= 3 && (lo(n) === lo(q) || lo(n).startsWith(lo(q))));
  const same = (a, b) => words(a).join(" ") === words(b).join(" ");
  // מילים שהופכות מוצר למוצר אחר ("תות קפוא" מול "תות קפוא בציפוי שוקולד") – אם הן לא ברשימה, המוצר מאחור
  const MODS = /^(ב?ציפוי|מצופ|ב?שוקולד|ב?טעמ|ממולא|ב?מילוי|ממותק|מסוכר|ב?קרמ|מטוגנ|בטמפורה|ב?רוטב|מרוכז|אבקת)$/;
  const extraMods = (ns, qs) => ns.filter(n => MODS.test(n) && !qs.includes(n)).length;
  const less = (a, b) => { const i = a.findIndex((v, k) => v !== b[k]); return i >= 0 && a[i] < b[i]; };
  // product: השם המדויק מקובץ המחירים (מחמירים פחות – שמות באתר ובקובץ כתובים קצת אחרת); name: מה שכתוב ברשימה
  function pick(list, nameOf, { product, name, weighted, isWeighted }) {
    for (const [q, need] of [[product, 0.75], [name, 1]]) {
      if (!q) continue;
      const exact = list.find(p => same(nameOf(p), q));
      if (exact) return { found: exact, exact: true };
      const qs = words(q).filter(w => !NOISE.has(w));
      if (!qs.length) continue;
      let best = null;
      for (const [rank, p] of list.entries()) {
        const ns = words(nameOf(p));
        if (!ns.length || !wm(qs[0], ns[0]) && !(ns[1] && wm(qs[0], ns[1]))) continue;  // סוג המוצר בתחילת השם
        const hit = qs.filter(w => ns.some(n => wm(w, n))).length / qs.length;
        if (hit < need) continue;
        // אחרי ההתאמה עצמה – הסדר של האתר (הנפוץ קודם)
        const key = [-hit, extraMods(ns, qs), weighted && isWeighted && !isWeighted(p) ? 1 : 0, wm(qs[0], ns[0]) ? 0 : 1, rank];
        if (!best || less(key, best.key)) best = { key, p };
      }
      if (best) return { found: best.p };
    }
    return { found: null, closest: list[0] ? nameOf(list[0]) : null };
  }
  // מחפשים באתר לפי השם המדויק, לפי מה שכתוב ברשימה, ובלשון יחיד ("עגבניות" -> "עגבניה": ברמי לוי רק כך מופיעות העגבניות עצמן).
  // עוצרים כשנמצא שם זהה; אחרת בוחרים את ההתאמה הטובה מכל התוצאות.
  const singular = s => String(s || "").split(/\s+/).map(w => w.length > 4 && /ות$/.test(w) ? w.slice(0, -2) + "ה" : w.length > 4 && /ים$/.test(w) ? w.slice(0, -2) : w).join(" ");
  async function searchPick(search, nameOf, it, isWeighted) {
    const pool = [];
    let m = { found: null };
    for (const q of [...new Set([it.product, it.name, singular(it.name)].filter(Boolean))]) {
      pool.push(...await search(q));
      m = pick(pool, nameOf, { ...it, isWeighted });
      if (m.exact) break;
    }
    return m;
  }
  const notFound = r => ({ ok: false, reason: r.closest ? `אין התאמה בטוחה – לא נוסף (באתר: ${r.closest.slice(0, 40)})` : "לא נמצא באתר" });

  const SITES = {
    shufersal: {
      match: /shufersal\.co\.il$/,
      ready: () => window.ACC && window.$,
      logged: async () => (await (await fetch("/online/he/authentication/get-status-includes-otp")).text()).trim() === "true",
      async add({ name, code, kg, weighted, product }) {
        const ctx = ACC.config.encodedContextPath;
        const tiles = async q => {
          const html = await (await fetch(ctx + "/search?text=" + encodeURIComponent(q))).text();
          return [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("li[data-product-code]")]
            .map(e => ({ code: e.dataset.productCode, method: e.dataset.sellingMethod, name: e.dataset.productName, ok: e.dataset.productPurchasable !== "false" }));
        };
        let found = null;
        const tries = code ? ["P_" + code].concat(/^7290{5,}\d+$/.test(code) ? ["P_" + parseInt(code.slice(3), 10)] : []) : [];
        for (const c of tries) { found = (await tiles(c.slice(2))).find(x => x.code === c); if (found) break; }
        if (!found) { const m = await searchPick(async q => (await tiles(q)).filter(x => x.ok), x => x.name, this.it, x => /WEIGHT/i.test(x.method || "")); found = m.found; if (!found) return notFound(m); }
        const method = (found.method || "BY_UNIT").toUpperCase(), byW = method === "BY_WEIGHT";
        const q = byW ? round05(kg) : units(this.it);
        try {
          await $.ajax({ type: "POST", url: ctx + "/cart/add", contentType: "application/json", headers: { CSRFToken: ACC.config.CSRFToken },
            data: JSON.stringify({ productCodePost: found.code, productCode: found.code, sellingMethod: method, qty: q, frontQuantity: q, comment: "", affiliateCode: "" }) });
        } catch (e) { return { ok: false, reason: "האתר דחה (" + e.status + ")" }; }
        return { ok: true, product: found.name, note: byW ? q + " ק\"ג" : "×" + q };
      },
      done: () => { location.href = "/online/he/cart/cartsummary"; },
    },
    ramilevy: {
      match: /rami-levy\.co\.il$/,
      ready: () => window.$nuxt && $nuxt.$store,
      logged: async () => !!$nuxt.$store.getters["authuser/isAuthenticated"],
      existing: () => ($nuxt.$store.state.cart.items || []).length,
      async add({ name, code, kg, weighted, product }) {
        const st = $nuxt.$store, store = String(st.state.cart.storeId || 331);
        const find = async q => (await (await fetch("/api/catalog", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, store, aggs: 0, size: 20 }) })).json()).data || [];
        const queries = [...new Set([product, name].filter(Boolean))];
        let found = null;
        if (code) {
          found = (await find(code)).find(p => String(p.barcode) === code);
          if (!found && /^7290{5,}\d+$/.test(code)) {
            const short = String(parseInt(code.slice(3), 10));
            for (const q of queries) { found = (await find(q)).find(p => String(p.barcode) === short); if (found) break; }
          }
        }
        const here = p => !p.available_in || p.available_in.includes(Number(store));
        if (!found) {
          const m = await searchPick(async q => { const r = (await find(q)).filter(p => p && p.name); return r.some(here) ? r.filter(here) : r; }, p => p.name, this.it, p => !!(p.prop && p.prop.sw_shakil));
          found = m.found;
          if (!found) return notFound(m);
        }
        const byKilo = !!(found.prop && found.prop.by_kilo && found.prop.sw_shakil);
        const amount = byKilo ? round05(kg) : units(this.it);
        const cur = st.state.cart.items.find(i => i.id === found.id);
        st.commit("cart/updateItem", { ...found, amount: (cur && !byKilo ? cur.amount : 0) + amount });
        await sleep(300);
        return { ok: true, id: found.id, merged: !!cur, product: found.name, note: (byKilo ? amount + " ק\"ג" : "×" + amount) + (cur ? " (אוחד עם פריט קודם)" : "") };
      },
      async inCart() {
        for (let i = 0; i < 60 && $nuxt.$store.state.cart.loadingCart; i++) await sleep(500);
        return new Set(($nuxt.$store.state.cart.items || []).map(i => i.id));
      },
      async done() {
        for (let i = 0; i < 60 && $nuxt.$store.state.cart.loadingCart; i++) await sleep(500);
        await sleep(1500);
        location.href = "/he/dashboard/checkout";
      },
    },
    sp: {  // טיב טעם, ויקטורי, קרפור (אותה פלטפורמה)
      match: /(tivtaam\.co\.il|victoryonline\.co\.il|carrefour\.co\.il)$/,
      ready: () => { try { return !!angular.element(document.body).injector().get("Config").branch; } catch { return false; } },
      logged: async () => { const U = angular.element(document.body).injector().get("User"); return !!((U.session && U.session.token) || (U.data && U.data.id)); },
      existing: () => Object.keys(angular.element(document.body).injector().get("Cart").lines || {}).length,
      async add({ name, code, kg, weighted, product }) {
        const inj = angular.element(document.body).injector();
        const Api = inj.get("Api"), Cart = inj.get("Cart"), cfg = inj.get("Config");
        const url = `/v2/retailers/${cfg.retailer.id}/branches/${cfg.branch.id}/products`;
        const get = async params => ((await Api.request({ method: "GET", url, params: { from: 0, size: 20, ...params } })).products || []);
        const sellable = p => p && p.branch && p.branch.isActive && p.branch.isVisible && !p.branch.isOutOfStock;
        let found = null;
        if (code) found = (await get({ filters: JSON.stringify({ must: { term: { barcode: code } } }) })).find(sellable);
        if (!found) { const m = await searchPick(async q => (await get({ query: q })).filter(sellable), p => p.localName, this.it, p => !!p.isWeighable); found = m.found; if (!found) return notFound(m); }
        const step = found.unitResolution || 0.5;
        const quantity = found.isWeighable ? Math.max(step, Math.round((kg || 1) / step) * step) : units(this.it);
        await Cart.addLine({ product: found, quantity });
        return { ok: true, product: found.localName, note: found.isWeighable ? quantity + " ק\"ג" : "×" + quantity };
      },
      done: async () => { await sleep(2500); },
    },
    hazihinam: {  // חצי חינם: ה-API של האתר עצמו (proxy/api), Type 1 = יחידות, Type 2 = ק"ג
      match: /hazi-hinam\.co\.il$/,
      ready: () => document.readyState !== "loading",
      logged: async () => !!(await (await fetch("/proxy/api/user/info", { credentials: "include" })).json())?.Results?.UserInfo,
      async add({ name, code, kg, weighted, product }) {
        const call = async (u, b) => (await fetch("/proxy/api/" + u, { method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json();
        const find = async q => (await call("item/getItemsBySearch",
          { Paging: { Page: 1, PageSize: 20 }, Object: { SearchPhrase: q, SearchPhrases: [], ItemGroupping: 0 } }))?.Results?.Items || [];
        let found = null;
        if (code) found = (await find(code)).find(p => String(p.BarKod) === code);
        if (!found) { const m = await searchPick(async q => (await find(q)).filter(p => p.IsInStock !== false), p => p.Name, this.it, p => !!p.IsShakil); found = m.found; if (!found) return notFound(m); }
        const byKg = !!found.IsShakil;
        const quantity = byKg ? round05(kg) : units(this.it);
        // באתר הזה הוספה חוזרת של אותו מוצר מחליפה את הכמות (לא מוסיפה). שני פריטים ברשימה שהם אותו מוצר – מחברים
        const tot = window.__slTot ||= {}, locks = window.__slLocks ||= {};
        const run = (locks[found.Id] || Promise.resolve()).then(async () => {
          const before = tot[found.Id] || 0, sum = Math.round((before + quantity) * 100) / 100;
          const res = await call("item/addItemToCart", { Object: { ItemId: found.Id, Quantity: sum, Type: byKg ? 2 : 1, IsCalculateCart: true } });
          if (res?.IsOK) tot[found.Id] = sum;
          return { res, before, sum };
        });
        locks[found.Id] = run.catch(() => {});
        const { res, before, sum } = await run;
        if (!res?.IsOK) return { ok: false, reason: res?.ErrorResponse?.ErrorDescription?.slice(0, 80) || "האתר דחה" };
        return { ok: true, id: found.Id, product: found.Name, merged: before > 0, note: (byKg ? sum + " ק\"ג" : "×" + sum) + (before > 0 ? " (אוחד עם פריט קודם)" : "") };
      },
      // מה באמת בעגלה באתר (לבדיקה בסוף)
      async inCart() {
        const j = await (await fetch("/proxy/api/item/getItemsInCart", { credentials: "include" })).json();
        return new Set((j?.Results?.CartItems?.Items || []).map(p => p.Id));
      },
      done: () => { location.href = "/checkout/cart"; },
    },
    yochananof: {
      match: /yochananof\.co\.il$/,
      ready: () => document.readyState !== "loading",
      logged: async () => !!(localStorage.getItem("token") || localStorage.getItem("remember-me-token")),
      async prepare() {
        const token = localStorage.getItem("token"), store = localStorage.getItem("storeId");
        const headers = { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(store ? { Store: store } : {}) };
        const gql = async query => (await fetch("https://api.yochananof.co.il/graphql", { method: "POST", headers, body: JSON.stringify({ query }) })).json();
        window.__slCart = token ? (await gql("{ customerCart { id } }")).data?.customerCart?.id
          : (localStorage.getItem("cartId") || (await gql("mutation { createEmptyCart }")).data?.createEmptyCart);
      },
      async add({ name, code, kg, weighted, product }) {
        const token = localStorage.getItem("token"), store = localStorage.getItem("storeId");
        const headers = { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(store ? { Store: store } : {}) };
        const gql = async (query, variables = {}) => (await fetch("https://api.yochananof.co.il/graphql", { method: "POST", headers, body: JSON.stringify({ query, variables }) })).json();
        if (!window.__slCart) await this.site?.prepare?.();
        if (!window.__slCart) return { ok: false, reason: "לא נמצאה עגלה" };
        const find = async q => (await gql("query($q:String!){ products(search:$q, pageSize:20){ items { sku name stock_status } } }", { q })).data?.products?.items || [];
        let found = null;
        if (code) found = (await find(code)).find(p => p.sku === code);
        if (!found) { const m = await searchPick(async q => (await find(q)).filter(p => p.stock_status !== "OUT_OF_STOCK"), p => p.name, this.it); found = m.found; if (!found) return notFound(m); }
        const quantity = weighted ? round05(kg) : units(this.it);
        const res = await gql("mutation($c:String!,$i:[CartItemInput!]!){ addProductsToCart(cartId:$c, cartItems:$i){ user_errors { message } } }",
          { c: window.__slCart, i: [{ sku: found.sku, quantity }] });
        const err = res.errors?.[0]?.message || res.data?.addProductsToCart?.user_errors?.[0]?.message;
        if (err) return { ok: false, reason: err.slice(0, 80) };
        return { ok: true, id: found.sku, product: found.name, note: weighted ? quantity + " ק\"ג" : "×" + quantity };
      },
      async inCart() {
        const token = localStorage.getItem("token"), store = localStorage.getItem("storeId");
        const headers = { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(store ? { Store: store } : {}) };
        const j = await (await fetch("https://api.yochananof.co.il/graphql", { method: "POST", headers,
          body: JSON.stringify({ query: "query($c:String!){ cart(cart_id:$c){ items { product { sku } } } }", variables: { c: window.__slCart } }) })).json();
        return new Set((j.data?.cart?.items || []).map(i => i.product.sku));
      },
      // האתר שומר עותק של העגלה במטמון (Service Worker) ומציג אותו – בלי למחוק אותו, העגלה נראית ריקה
      async done() {
        try { for (const n of await caches.keys()) { const c = await caches.open(n); for (const r of await c.keys()) if (/operationName=(Cart|CustomerCart|MiniCart)/i.test(r.url)) await c.delete(r); } } catch {}
        location.href = "/checkout";
      },
    },
  };

  const site = Object.values(SITES).find(s => s.match.test(host));
  if (!site) { head("הכפתור עובד באתרים של שופרסל, רמי לוי, קרפור, חצי חינם, יוחננוף, טיב טעם וויקטורי. פתח את אחד מהם ולחץ שוב."); window.__slRunning = false; return; }

  // רמי לוי העבירו את החנות מ-/he/online (היום דף 404) ל-/he
  if (/rami-levy\.co\.il$/.test(host) && /^\/he\/online/.test(location.pathname)) {
    window.__slRunning = false;
    location.replace("/he");
    return;
  }

  head("מחכה שהאתר ייטען…");
  for (let i = 0; i < 60 && !site.ready(); i++) await sleep(500);
  if (!site.ready()) { head("האתר עוד לא נטען. חכה כמה שניות ולחץ שוב על הכפתור."); window.__slRunning = false; return; }
  let logged = true;
  try { logged = await site.logged(); } catch {}
  if (!logged && !confirm("נראה שאתה לא מחובר לחשבון באתר הזה. מומלץ להתחבר קודם (ואז ללחוץ שוב על הכפתור).\n\nלהמשיך בכל זאת כאורח?")) {
    head("התחבר לחשבון באתר, ואז לחץ שוב על הכפתור.");
    window.__slRunning = false;
    return;
  }

  // מוצרים שכבר היו בעגלה באתר (מקנייה קודמת) – לא מהרשימה. מציינים, כדי שלא ייראה כאילו המילוי הוסיף אותם
  let before = 0;
  try { before = site.existing ? site.existing() : 0; } catch {}
  if (before) row(false, `בעגלה באתר כבר היו ${before} מוצרים מלפני (לא מהרשימה)`, "כדאי לבדוק ולהסיר בעגלה מה שלא צריך");

  // 4 מוצרים במקביל (חיפוש והוספה) – הרבה יותר מהיר מאחד-אחד
  const n = job.items.length, results = new Array(n);
  let next = 0, doneCount = 0;
  if (site.prepare) { try { await site.prepare(); } catch {} }
  const worker = async () => {
    while (next < n) {
      const k = next++, it = job.items[k];
      let r;
      try { r = await site.add.call({ it, site }, it); } catch (e) { r = { ok: false, reason: String(e.message || e).slice(0, 80) }; }
      // המוצר עצמו לא נמצא באתר, וההשוואה מצאה תחליף דומה – מוסיפים אותו, ומדווחים שזה תחליף
      if (!r.ok && it.alt && (it.alt.code || it.alt.name)) {
        const alt = { ...it, code: it.alt.code, product: it.alt.name, name: it.alt.name, alt: null };
        let r2;
        try { r2 = await site.add.call({ it: alt, site }, alt); } catch { r2 = { ok: false }; }
        if (r2.ok) r = { ...r2, substituted: it.alt.name, note: `${r2.note} · 🔄 תחליף (המוצר עצמו לא נמצא)` };
      }
      results[k] = r;
      head(`מוסיף לעגלה: ${++doneCount} מתוך ${n}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, n) }, worker));
  // בדיקה מול העגלה האמיתית באתר: מוצר שהאתר "אישר" אבל לא שמר – נחשב כלא עבר
  if (site.inCart) {
    head("בודק מה באמת נכנס לעגלה…");
    try {
      const have = await site.inCart();
      results.forEach(r => { if (r.ok && r.id != null && !have.has(r.id)) Object.assign(r, { ok: false, reason: "האתר לא שמר את המוצר בעגלה (נסו להוסיף ידנית)" }); });
    } catch {}
  }
  // קודם מה שלא עבר, ואז מה שעבר (בסדר של הרשימה)
  const failed = [], merged = [], substituted = [];
  results.forEach((r, k) => { if (!r.ok) { failed.push({ name: job.items[k].name, reason: r.reason }); row(false, job.items[k].name, r.reason); } });
  results.forEach((r, k) => { if (r.ok && r.substituted) { substituted.push({ name: job.items[k].name, alt: r.product }); row(false, job.items[k].name, `🔄 נוסף תחליף: ${r.product}`); } });
  results.forEach((r, k) => { if (r.ok && !r.substituted) { if (r.merged) merged.push(job.items[k].name); row(true, job.items[k].name, `${r.product} · ${r.note}`); } });
  const ok = n - failed.length;
  // כמה שורות ייראו בעגלה: מוצרים שונים. פריטים ברשימה שהם אותו מוצר – שורה אחת
  const lines = new Set(results.filter(r => r.ok).map((r, k) => r.id ?? "k" + k)).size;
  const mergedNote = merged.length ? ` · ${merged.length} מהם היו אותו מוצר כמו פריט אחר ברשימה, ולכן בעגלה ${lines} שורות (הכמויות חוברו)` : "";
  sessionStorage.removeItem("__sl_job");
  // הדוח חוזר לאפליקציה (מופיע בראש הרשימה): מה לא עבר, ומה אוחד
  const report = { chain: job.chain || null, at: Date.now(), total: n, ok, lines, failed, merged, substituted };
  try { window.SuperlistCart?.report(JSON.stringify(report)); } catch {}
  const subNote = substituted.length ? ` · 🔄 ${substituted.length} לא נמצאו ונוסף במקומם תחליף (מסומנים למטה)` : "";
  if (!failed.length && !substituted.length) {
    head(`✅ כל ${n} המוצרים נוספו${mergedNote}. עוברים לעגלה – בדקו ושלמו בעצמכם.`);
    await sleep(2500);
    await site.done();
    window.__slRunning = false;
    return;
  }
  // יש מוצרים שלא עברו: לא עוברים לבד – שיהיה זמן לראות מה חסר
  head(`⚠️ נוספו ${ok} מתוך ${n}${mergedNote}${subNote}.${failed.length ? ` ${failed.length} לא עברו – מסומנים ב-✕ למטה (אפשר להוסיף אותם ידנית באתר).` : ""}`);
  const go = document.createElement("button");
  go.textContent = "המשך לעגלה ←";
  go.style.cssText = "display:block;width:100%;margin:8px 0;padding:10px;border:0;border-radius:10px;background:#0f7a4a;color:#fff;font:600 15px system-ui;cursor:pointer";
  go.onclick = async () => { await site.done(); };
  box.querySelector("#__sl_head").after(go);
  window.__slRunning = false;
})();
