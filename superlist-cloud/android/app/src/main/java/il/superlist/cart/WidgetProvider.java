package il.superlist.cart;

// ווידג'ט למסך הבית: שלושה כפתורים שפותחים את האפליקציה ישר לפעולה – הוספה, הוספה בקול, מצב קנייה.
// הפעולה עוברת לדף כ-superlist://widget?a=... (MainActivity מעביר אותה ל-window.onWidget).

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

public class WidgetProvider extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) {
            RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.widget);
            v.setOnClickPendingIntent(R.id.w_add, open(context, "add", 1));
            v.setOnClickPendingIntent(R.id.w_voice, open(context, "voice", 2));
            v.setOnClickPendingIntent(R.id.w_shop, open(context, "shop", 3));
            manager.updateAppWidget(id, v);
        }
    }

    static PendingIntent open(Context context, String action, int code) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("superlist://widget?a=" + action), context, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
