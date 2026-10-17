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

  const SITES = {
    shufersal: {
      match: /shufersal\.co\.il$/,
      ready: () => window.ACC && window.$,
      logged: async () => (await (await fetch("/online/he/authentication/get-status-includes-otp")).text()).trim() === "true",
      async add({ name, code, kg }) {
        const ctx = ACC.config.encodedContextPath;
        const tiles = async q => {
          const html = await (await fetch(ctx + "/search?text=" + encodeURIComponent(q))).text();
          return [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("li[data-product-code]")]
            .map(e => ({ code: e.dataset.productCode, method: e.dataset.sellingMethod, name: e.dataset.productName, ok: e.dataset.productPurchasable !== "false" }));
        };
        let found = null;
        const tries = code ? ["P_" + code].concat(/^7290{5,}\d+$/.test(code) ? ["P_" + parseInt(code.slice(3), 10)] : []) : [];
        for (const c of tries) { found = (await tiles(c.slice(2))).find(x => x.code === c); if (found) break; }
        if (!found) { const t = await tiles(name); found = t.find(x => x.ok) || t[0] || null; }
        if (!found) return { ok: false, reason: "לא נמצא באתר" };
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
        for (const q of found ? [] : queries) {
          const r = (await find(q)).filter(p => p && p.name);
          const pool = r.filter(p => !p.available_in || p.available_in.includes(Number(store)));
          const list = pool.length ? pool : r;
          found = (weighted && list.find(p => p.prop && p.prop.sw_shakil)) || list[0] || null;
          if (found) break;
        }
        if (!found || !found.name) return { ok: false, reason: "לא נמצא באתר" };
        const byKilo = !!(found.prop && found.prop.by_kilo && found.prop.sw_shakil);
        const amount = byKilo ? round05(kg) : units(this.it);
        const cur = st.state.cart.items.find(i => i.id === found.id);
        st.commit("cart/updateItem", { ...found, amount: (cur && !byKilo ? cur.amount : 0) + amount });
        await sleep(300);
        return { ok: true, product: found.name, note: byKilo ? amount + " ק\"ג" : "×" + amount };
      },
      async done() {
        for (let i = 0; i < 60 && $nuxt.$store.state.cart.loadingCart; i++) await sleep(500);
        await sleep(1500);
        location.href = "/he/dashboard/checkout";
      },
    },
    sp: {  // טיב טעם, ויקטורי (אותה פלטפורמה)
      match: /(tivtaam\.co\.il|victoryonline\.co\.il)$/,
      ready: () => { try { return !!angular.element(document.body).injector().get("Config").branch; } catch { return false; } },
      logged: async () => { const U = angular.element(document.body).injector().get("User"); return !!((U.session && U.session.token) || (U.data && U.data.id)); },
      async add({ name, code, kg, weighted, product }) {
        const inj = angular.element(document.body).injector();
        const Api = inj.get("Api"), Cart = inj.get("Cart"), cfg = inj.get("Config");
        const url = `/v2/retailers/${cfg.retailer.id}/branches/${cfg.branch.id}/products`;
        const get = async params => ((await Api.request({ method: "GET", url, params: { from: 0, size: 20, ...params } })).products || []);
        const sellable = p => p && p.branch && p.branch.isActive && p.branch.isVisible && !p.branch.isOutOfStock;
        let found = null;
        if (code) found = (await get({ filters: JSON.stringify({ must: { term: { barcode: code } } }) })).find(sellable);
        for (const q of found ? [] : [...new Set([product, name].filter(Boolean))]) {
          const r = (await get({ query: q })).filter(sellable);
          found = r.find(p => p.localName === q) || (weighted && r.find(p => p.isWeighable)) || r[0] || null;
          if (found) break;
        }
        if (!found) return { ok: false, reason: "לא נמצא באתר" };
        const step = found.unitResolution || 0.5;
        const quantity = found.isWeighable ? Math.max(step, Math.round((kg || 1) / step) * step) : units(this.it);
        await Cart.addLine({ product: found, quantity });
        return { ok: true, product: found.localName, note: found.isWeighable ? quantity + " ק\"ג" : "×" + quantity };
      },
      done: async () => { await sleep(2500); },
    },
    yochananof: {
      match: /yochananof\.co\.il$/,
      ready: () => document.readyState !== "loading",
      logged: async () => !!localStorage.getItem("token"),
      async add({ name, code, kg, weighted, product }) {
        const token = localStorage.getItem("token"), store = localStorage.getItem("storeId");
        const headers = { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(store ? { Store: store } : {}) };
        const gql = async (query, variables = {}) => (await fetch("https://api.yochananof.co.il/graphql", { method: "POST", headers, body: JSON.stringify({ query, variables }) })).json();
        if (!window.__slCart) window.__slCart = token ? (await gql("{ customerCart { id } }")).data?.customerCart?.id
          : (localStorage.getItem("cartId") || (await gql("mutation { createEmptyCart }")).data?.createEmptyCart);
        if (!window.__slCart) return { ok: false, reason: "לא נמצאה עגלה" };
        const find = async q => (await gql("query($q:String!){ products(search:$q, pageSize:20){ items { sku name stock_status } } }", { q })).data?.products?.items || [];
        let found = null;
        if (code) found = (await find(code)).find(p => p.sku === code);
        for (const q of found ? [] : [...new Set([product, name].filter(Boolean))]) {
          const r = (await find(q)).filter(p => p.stock_status !== "OUT_OF_STOCK");
          found = r.find(p => p.name === q) || r[0] || null;
          if (found) break;
        }
        if (!found) return { ok: false, reason: "לא נמצא באתר" };
        const quantity = weighted ? round05(kg) : units(this.it);
        const res = await gql("mutation($c:String!,$i:[CartItemInput!]!){ addProductsToCart(cartId:$c, cartItems:$i){ user_errors { message } } }",
          { c: window.__slCart, i: [{ sku: found.sku, quantity }] });
        const err = res.errors?.[0]?.message || res.data?.addProductsToCart?.user_errors?.[0]?.message;
        if (err) return { ok: false, reason: err.slice(0, 80) };
        return { ok: true, product: found.name, note: weighted ? quantity + " ק\"ג" : "×" + quantity };
      },
      done: () => { location.href = "/checkout"; },
    },
  };

  const site = Object.values(SITES).find(s => s.match.test(host));
  if (!site) { head("הכפתור עובד באתרים של שופרסל, רמי לוי, יוחננוף, טיב טעם וויקטורי. פתח את אחד מהם ולחץ שוב."); window.__slRunning = false; return; }

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

  let ok = 0;
  for (const [i, it] of job.items.entries()) {
    head(`מוסיף לעגלה: ${i + 1} מתוך ${job.items.length}`);
    let r;
    try { r = await site.add.call({ it }, it); } catch (e) { r = { ok: false, reason: String(e.message || e).slice(0, 80) }; }
    if (r.ok) ok++;
    row(r.ok, it.name, r.ok ? `${r.product} · ${r.note}` : r.reason);
  }
  sessionStorage.removeItem("__sl_job");
  head(`✅ נוספו ${ok} מתוך ${job.items.length}. עוברים לעגלה – בדוק ושלם בעצמך.`);
  await sleep(2500);
  await site.done();
  window.__slRunning = false;
})();
