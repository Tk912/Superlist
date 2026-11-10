package il.superlist.cart;

// התאמות לאנדרואיד 15–16 (Google Play דורשת targetSdk 36):
// 1. המסך נפרס מקצה לקצה – גם מתחת לשורת הסטטוס ולסרגל הניווט. מוסיפים ריווח בגודל הסרגלים (וגם המקלדת),
//    כדי שהתוכן לא יוסתר, וצובעים את האזור שמאחוריהם בירוק של האפליקציה.
// 2. מחוות "חזרה" החדשה (predictive back): onBackPressed כבר לא נקרא, אז נרשמים לחזרה בדרך החדשה.

import android.app.Activity;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.window.OnBackInvokedDispatcher;

final class Screen {
    private Screen() { }

    static void fitBars(Activity a, View root, int barColor) {
        root.setBackgroundColor(barColor);
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
            return ins;
        });
        // אייקונים לבנים בשורת הסטטוס ובסרגל הניווט (על רקע ירוק)
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = a.getWindow().getInsetsController();
            if (c != null) c.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
    }

    // מה עושים בלחיצה על "חזרה"; בגרסאות ישנות onBackPressed של המסך עצמו עדיין נקרא
    static void onBack(Activity a, Runnable action) {
        if (Build.VERSION.SDK_INT >= 33)
            a.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, action::run);
    }
}
