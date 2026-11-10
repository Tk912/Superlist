# העלאת הסל החכם ל-Google Play – מה נשאר לעשות

כל מה שאפשר כבר מוכן: האפליקציה בנויה לדרישות של Google Play (אנדרואיד 16, API 36), קובץ ההעלאה נבנה אוטומטית,
דף מדיניות הפרטיות באוויר, ויש מחיקת חשבון באפליקציה. נשארו רק הצעדים שדורשים אותך.

## 1. חשבון מפתח (פעם אחת)
1. נכנסים ל-https://play.google.com/console/signup עם חשבון ה-Google שבו רוצים לנהל את האפליקציה
   (מומלץ חשבון ייעודי, לא האישי – ראו "חשבונות" למטה).
2. בוחרים **חשבון אישי** (Personal), משלמים 25$ (פעם אחת), ומאמתים זהות (צילום תעודה) וטלפון.
3. האימות לוקח בדרך כלל כמה ימים.

## 2. יצירת האפליקציה
Play Console → **Create app**:
- App name: `הסל החכם – רשימת קניות` · Default language: עברית · App · Free
- מסמנים את האישורים ← Create app

## 3. העלאת הקובץ (בדיקה סגורה)
חשבון אישי חדש חייב קודם **בדיקה סגורה: 12 בודקים לפחות, במשך 14 יום** – רק אחרי זה אפשר לפרסם לכולם.
1. Testing → **Closed testing** → Create track → Create new release.
2. כשמוצג Play App Signing – מאשרים (**Use Google-generated key**).
3. מעלים את הקובץ `superlist.aab` מכאן: https://github.com/Tk912/Superlist/releases/latest/download/superlist.aab
4. Release notes: `גרסה ראשונה בחנות`.
5. Testers: מוסיפים רשימת מיילים של 12 אנשים לפחות (משפחה וחברים), ושולחים להם את קישור ההצטרפות.

## 4. חשוב: התחברות עם Google אחרי ההעלאה
Google חותמת מחדש את האפליקציה שבחנות, ולכן צריך להוסיף את "טביעת האצבע" שלה ל-Firebase – אחרת ההתחברות לא תעבוד
באפליקציה שהותקנה מהחנות:
1. Play Console → Test and release → Setup → **App signing** → מעתיקים את **SHA-1** של App signing key certificate.
2. Firebase Console → Project settings → האפליקציה il.superlist.cart → **Add fingerprint** → מדביקים → Save.

## 5. דף החנות
Grow → Store presence → **Main store listing**: מעתיקים מהקובץ `listing.md` (שם, תיאור קצר, תיאור מלא),
ומעלים את `icon-512.png`, `feature-graphic.png`, ו-4 צילומי מסך מהטלפון:
1. הרשימה עם המחלקות (מסך הבית).
2. "מחיר הסל" עם ההשוואה בין הרשתות.
3. לשונית המחירים (פירוט לפי מוצר / שינויי מחיר).
4. מצב קנייה בסופר או מילוי עגלה.

## 6. שאלונים (App content)
- **Privacy policy:** `https://tk912.github.io/Superlist/privacy.html`
- **Ads:** No, my app does not contain ads.
- **App access:** All or some functionality is restricted → "Sign in with any Google account – no special credentials needed. Tap 'התחברות עם Google'."
- **Content rating:** Category = Utility/Productivity/Other; תשובה "No" לכל השאלות → Everyone / 3+.
- **Target audience:** 18 and over.
- **News app:** No. **Government app:** No. **Financial features:** None.
- **Data safety** (Data collection and security):
  - Does your app collect or share user data? **Yes**
  - Is all data encrypted in transit? **Yes**
  - Do you provide a way for users to request deletion? **Yes** – `https://tk912.github.io/Superlist/privacy.html#delete`
  - Data types – Collected (not shared), purpose **App functionality** (+ **Account management** for email/name):
    - Personal info → **Name**, **Email address** (required)
    - Personal info → **Address** (optional – לבדיקת מועדי משלוח)
    - App activity → **Other user-generated content** (רשימות, מתכונים, הזמנות)
  - Not collected: Location, Financial info, Contacts, Photos, Audio, Device IDs.
- **Account deletion URL:** `https://tk912.github.io/Superlist/privacy.html#delete`

## 7. אחרי 14 יום של בדיקה
Production → Create new release → אותו קובץ (או חדש יותר) → Review → Start rollout.
Google בודקת את האפליקציה (בדרך כלל כמה ימים).

## חשבונות – המלצה
כרגע האפליקציה תלויה בחשבונות האישיים שלך (GitHub ‏Tk912, ‏Firebase בחשבון ה-Google האישי). לחנות מומלץ חשבון Google
ייעודי (למשל superlist.app@gmail.com) ל-Play Console. את Firebase ו-GitHub אפשר להעביר אליו גם אחר כך.
כתובת המייל שתופיע בדף החנות היא ציבורית – כדאי להשתמש בכתובת הייעודית.

## עדכונים בהמשך
כל עדכון ל-android ב-GitHub בונה קובץ חדש. בחנות: Create new release → מעלים את `superlist.aab` החדש.
(אם תרצה, אפשר בהמשך לחבר העלאה אוטומטית לחנות.)
