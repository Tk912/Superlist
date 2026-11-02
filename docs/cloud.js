// חיבור ל-Firebase: התחברות עם Google, והרשימות עם עדכונים בזמן אמת.
// כל משתמש מקבל רשימה משלו בכניסה הראשונה, ויכול ליצור עוד רשימות ולשתף אותן (lists/{id}, עם members ו-owner).
// האפליקציה (index.html) משתמשת רק ב-window.Cloud, כך שכל הקוד של Firebase נמצא כאן.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
  signInWithCredential,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, query, where, onSnapshot,
  runTransaction, setDoc, updateDoc, deleteDoc, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const configured = !String(firebaseConfig.projectId || "").includes("PASTE");
let auth, db, listRef = null;

if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // שמירה מקומית: הרשימה נפתחת ונערכת גם בלי אינטרנט, ומסתנכרנת כשהחיבור חוזר
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  getRedirectResult(auth).catch(() => {});
}

const clean = obj => JSON.parse(JSON.stringify(obj)); // Firestore לא מקבל undefined
const live = d => (d.items || []).filter(i => !i.deleted && !i.done).length;

window.Cloud = {
  configured,
  user: null,
  listId: null,

  onUser(cb) {
    if (!configured) return cb(null);
    onAuthStateChanged(auth, u => { this.user = u; cb(u); });
  },

  async signIn() {
    // באפליקציית האנדרואיד: Google לא מאפשרת התחברות מתוך דף שבתוך אפליקציה, אז האפליקציה מתחברת
    // עם החשבון שבטלפון ומחזירה ID token, ואיתו נכנסים ל-Firebase
    if (window.SuperlistNative) {
      const token = await new Promise((res, rej) => { window.__nativeSignIn = { res, rej }; window.SuperlistNative.signIn(); });
      return signInWithCredential(auth, GoogleAuthProvider.credential(token));
    }
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      // בטלפון חלונות קופצים לפעמים נחסמים - עוברים להתחברות בהפניה
      if (/popup/i.test(e.code || "")) return signInWithRedirect(auth, provider);
      throw e;
    }
  },

  signOut() { try { window.SuperlistNative?.signOut(); } catch {} return signOut(auth); },

  email() { return (this.user?.email || "").toLowerCase(); },

  // כל הרשימות שהמשתמש חבר בהן (שלו, ושמשתפים איתו). cb([{id, name, owner, members, open}])
  lists(cb, onError) {
    const q = query(collection(db, "lists"), where("members", "array-contains", this.email()));
    return onSnapshot(q, snap => {
      cb(snap.docs.map(d => { const x = d.data(); return { id: d.id, name: x.name || "הרשימה שלי", owner: x.owner || "", members: x.members || [], open: live(x) }; }));
    }, e => onError && onError(e.code || String(e)));
  },

  // הרשימה שעובדים עליה עכשיו
  open(id) { this.listId = id; listRef = doc(db, "lists", id); },

  // מאזין לרשימה הפתוחה. onData(data) / onError(code)
  watch(onData, onError) {
    return onSnapshot(listRef, { includeMetadataChanges: false }, snap => {
      if (snap.metadata.hasPendingWrites) return; // שינוי שלנו שעוד לא אושר
      onData(snap.exists() ? snap.data() : null);
    }, e => onError(e.code || String(e)));
  },

  // רשימה חדשה: היוצר הוא הבעלים והחבר הראשון. מחזיר את המזהה שלה.
  async createList(name, initial) {
    const ref = doc(collection(db, "lists"));
    await setDoc(ref, clean({ ...initial, name, members: [this.email()], owner: this.email(), created: Date.now() }));
    return ref.id;
  },

  // שמירה עם מיזוג: קוראים את מה שבשרת, ממזגים עם המקומי (fn), וכותבים - בטרנזקציה אחת
  async save(fn) {
    const ref = listRef;
    return runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      const server = snap.exists() ? snap.data() : null;
      const next = clean(fn(server));
      if (server) { next.members = server.members; next.owner = server.owner ?? null; next.name = server.name ?? null; next.created = server.created ?? null; }
      tx.set(ref, next);
      return next;
    });
  },

  // רק הבעלים משנה את רשימת השותפים
  setMembers(members) {
    return updateDoc(listRef, { members: [...new Set(members.map(m => m.trim().toLowerCase()).filter(Boolean))] });
  },

  renameList(id, name) { return updateDoc(doc(db, "lists", id), { name }); },

  // בעלים: מוחק את הרשימה לגמרי. חבר: יוצא מהרשימה (היא נשארת אצל השאר).
  async deleteList(id) {
    try { await deleteDoc(doc(db, "prefs", id)); } catch {}
    return deleteDoc(doc(db, "lists", id));
  },
  leaveList(id) { return updateDoc(doc(db, "lists", id), { members: arrayRemove(this.email()) }); },

  // מספרי הסניפים שנבחרו ברשימה (בלי שום מידע אישי) - כדי שהעדכון האוטומטי ב-GitHub ידע אילו מחירים להוריד
  setPublicStores(stores) {
    if (!this.listId) return Promise.resolve();
    return setDoc(doc(db, "prefs", this.listId), { stores: clean(stores), updated: Date.now() });
  },
};

window.dispatchEvent(new Event("cloud-ready"));
