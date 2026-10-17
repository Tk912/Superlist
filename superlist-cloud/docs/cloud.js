// חיבור ל-Firebase: התחברות עם Google, והרשימה המשותפת (מסמך אחד: lists/home) עם עדכונים בזמן אמת.
// האפליקציה (index.html) משתמשת רק ב-window.Cloud, כך שכל הקוד של Firebase נמצא כאן.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, onSnapshot, runTransaction, setDoc, updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const configured = !String(firebaseConfig.projectId || "").includes("PASTE");
let auth, db, listRef, configRef;

if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  // שמירה מקומית: הרשימה נפתחת ונערכת גם בלי אינטרנט, ומסתנכרנת כשהחיבור חוזר
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  listRef = doc(db, "lists", "home");
  configRef = doc(db, "public", "config");
  getRedirectResult(auth).catch(() => {});
}

const clean = obj => JSON.parse(JSON.stringify(obj)); // Firestore לא מקבל undefined

window.Cloud = {
  configured,
  user: null,

  onUser(cb) {
    if (!configured) return cb(null);
    onAuthStateChanged(auth, u => { this.user = u; cb(u); });
  },

  async signIn() {
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

  signOut() { return signOut(auth); },

  email() { return (this.user?.email || "").toLowerCase(); },

  // מאזין לרשימה. onData(data, fromServer) / onError(code)
  watch(onData, onError) {
    return onSnapshot(listRef, { includeMetadataChanges: false }, snap => {
      if (snap.metadata.hasPendingWrites) return; // שינוי שלנו שעוד לא אושר
      onData(snap.exists() ? snap.data() : null);
    }, e => onError(e.code || String(e)));
  },

  // פעם ראשונה: מי שמתחבר ראשון יוצר את הרשימה ונהיה החבר הראשון בה
  async createList(initial) {
    await setDoc(listRef, clean({ ...initial, members: [this.email()], owner: this.email() }));
  },

  // שמירה עם מיזוג: קוראים את מה שבשרת, ממזגים עם המקומי (fn), וכותבים - בטרנזקציה אחת
  async save(fn) {
    return runTransaction(db, async tx => {
      const snap = await tx.get(listRef);
      const server = snap.exists() ? snap.data() : null;
      const next = clean(fn(server));
      if (server) { next.members = server.members; next.owner = server.owner; }
      tx.set(listRef, next);
      return next;
    });
  },

  setMembers(members) {
    return updateDoc(listRef, { members: [...new Set(members.map(m => m.trim().toLowerCase()).filter(Boolean))] });
  },

  // מספרי הסניפים שנבחרו - כדי שהעדכון האוטומטי ב-GitHub ידע אילו מחירים להוריד
  setPublicStores(stores) {
    return setDoc(configRef, { stores: clean(stores), updated: Date.now() });
  },
};

window.dispatchEvent(new Event("cloud-ready"));
