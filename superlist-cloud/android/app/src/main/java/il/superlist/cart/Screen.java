package il.superlist.cart;

// התאמות לאנדרואיד 15–16 (Google Play דורשת targetSdk 36):
// 1. המסך נפרס מקצה לקצה – גם מתחת לשורת הסטטוס ולסרגל הניווט. מוסיפים ריווח בגודל הסרגלים (וגם המקלדת),
//    כדי שהתוכן לא יוסתר. האזור שמאחורי שורת הסטטוס – בירוק של האפליקציה; האזור שמתחת לתפריט התחתון –
//    בצבע של התפריט עצמו, כדי שהתפריט ייראה צמוד לתחתית המסך (ולא "מרחף" מעל פס ירוק).
// 2. מחוות "חזרה" החדשה (predictive back): onBackPressed כבר לא נקרא, אז נרשמים לחזרה בדרך החדשה.

import android.app.Activity;
import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.window.OnBackInvokedDispatcher;

final class Screen {
    private Screen() { }

    static void fitBars(Activity a, View root, int barColor) { fitBars(a, root, barColor, barColor); }

    // topColor: מאחורי שורת הסטטוס; bottomColor: מאחורי סרגל הניווט של הטלפון (ומאחורי המקלדת)
    static void fitBars(Activity a, View root, int topColor, int bottomColor) {
        final int[] top = { 0 };
        final Drawable bg = new Drawable() {
            private final Paint p = new Paint();
            @Override public void draw(Canvas c) {
                Rect r = getBounds();
                p.setColor(bottomColor); c.drawRect(r, p);
                p.setColor(topColor); c.drawRect(r.left, r.top, r.right, r.top + top[0], p);
            }
            @Override public void setAlpha(int alpha) { }
            @Override public void setColorFilter(ColorFilter cf) { }
            @Override public int getOpacity() { return PixelFormat.OPAQUE; }
        };
        root.setBackground(bg);
        root.setOnApplyWindowInsetsListener((v, ins) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = ins.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                l = i.left; t = i.top; r = i.right; b = i.bottom;
            } else {
                l = ins.getSystemWindowInsetLeft(); t = ins.getSystemWindowInsetTop();
                r = ins.getSystemWindowInsetRight(); b = ins.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            top[0] = t;
            bg.invalidateSelf();
            return ins;
        });
        // אייקונים לבנים בשורת הסטטוס (על ירוק); בסרגל הניווט – כהים על רקע בהיר, לבנים על רקע כהה
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = a.getWindow().getInsetsController();
            if (c != null) {
                boolean lightBottom = luminance(bottomColor) > 0.6;
                c.setSystemBarsAppearance(lightBottom ? WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
        }
    }

    private static double luminance(int c) {
        return (0.299 * ((c >> 16) & 0xff) + 0.587 * ((c >> 8) & 0xff) + 0.114 * (c & 0xff)) / 255.0;
    }

    // מה עושים בלחיצה על "חזרה"; בגרסאות ישנות onBackPressed של המסך עצמו עדיין נקרא
    static void onBack(Activity a, Runnable action) {
        if (Build.VERSION.SDK_INT >= 33)
            a.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, action::run);
    }
}
