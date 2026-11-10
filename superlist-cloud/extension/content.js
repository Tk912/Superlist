// מחבר בין דף האפליקציה לתוסף: הדף שולח בקשה (postMessage), התוסף מחזיר את מועדי המשלוח.
const VERSION = chrome.runtime.getManifest().version;
document.documentElement.dataset.superlistExt = VERSION;

window.addEventListener("message", ev => {
  if (ev.source !== window || !ev.data || ev.data.type !== "superlist-slots-request") return;
  const { id, address, chains, force } = ev.data;
  chrome.runtime.sendMessage({ type: "slots", address, chains, force }, results => {
    window.postMessage({ type: "superlist-slots", id, results: results || {}, error: chrome.runtime.lastError?.message }, "*");
  });
});

// ייבוא מתכון מקישור: התוסף מביא את הדף (האפליקציה לבד חסומה ע"י הדפדפן)
window.addEventListener("message", ev => {
  if (ev.source !== window || !ev.data || ev.data.type !== "superlist-page-request") return;
  const { id, url, binary } = ev.data;
  chrome.runtime.sendMessage({ type: "page", url, binary: !!binary }, res => {
    window.postMessage({ type: "superlist-page", id, ...(res || { ok: false, status: 0, text: chrome.runtime.lastError?.message || "" }) }, "*");
  });
});

window.postMessage({ type: "superlist-ext-ready", version: VERSION }, "*");
