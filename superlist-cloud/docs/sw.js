// מאפשר לפתוח את האפליקציה גם בלי אינטרנט (למשל בתוך הסופר בלי קליטה).
// תמיד מנסים קודם את הרשת, כדי שעדכונים יופיעו מיד; רק כשאין רשת משתמשים בעותק השמור.
// הרשימה עצמה נשמרת ומסונכרנת ע"י Firebase, לא כאן.
const CACHE = "superlist-v7";
const SHELL = ["./", "index.html", "app.html", "prices.js", "recipes.js", "slots.js", "cloud.js", "firebase-config.js", "cart.js",
  "manifest.json", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  // רק גרסאות ישנות של האתר עצמו (לא קובצי המחירים שהאפליקציה שמרה: superlist-local-prices)
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => /^superlist-v\d+$/.test(k) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  // רק קבצים של האתר עצמו; Firebase, תמונות מוצרים וכו' עוברים כרגיל
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // no-cache: תמיד בודקים מול השרת שהקובץ עדכני (בדיקה קצרה), כדי שעדכון יופיע מיד ולא אחרי 10 דקות
  e.respondWith(fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })
    .then(r => r || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
