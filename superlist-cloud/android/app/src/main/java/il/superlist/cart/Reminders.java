package il.superlist.cart;

// תזכורות בטלפון בלי שרת: הדף מחשב מה יקרה בימים הקרובים (מוצרים קבועים שחוזרים, מוצרים שכנראה נגמרו)
// ומעביר רשימה [{at, title, body}]. כאן קובעים לכל אחת "שעון מעורר" של אנדרואיד, שמציג הודעה גם כשהאפליקציה סגורה.
// הרשימה נשמרת, כדי לקבוע אותה מחדש אחרי הפעלה מחדש של הטלפון.

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

public class Reminders extends BroadcastReceiver {
    static final String PREFS = "superlist", KEY = "reminders", COUNT = "remindersCount", CHANNEL = "reminders";
    static final int MAX = 30;

    // הרשימה החדשה מחליפה את הקודמת
    static void set(Context ctx, String json) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        cancelAll(ctx, p.getInt(COUNT, MAX));
        int n = 0;
        try {
            JSONArray a = new JSONArray(json == null ? "[]" : json);
            long now = System.currentTimeMillis();
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            for (int i = 0; i < a.length() && n < MAX; i++) {
                JSONObject r = a.getJSONObject(i);
                long at = r.getLong("at");
                if (at <= now) continue;
                Intent it = new Intent(ctx, Reminders.class).putExtra("title", r.optString("title")).putExtra("body", r.optString("body"));
                PendingIntent pi = PendingIntent.getBroadcast(ctx, 1000 + n, it, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                // לא צריך דיוק לדקה – כך אין צורך בהרשאת "שעון מעורר מדויק", והסוללה נחסכת
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                n++;
            }
        } catch (Exception ignored) { }
        p.edit().putString(KEY, json).putInt(COUNT, n).apply();
    }

    static void cancelAll(Context ctx, int count) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        for (int i = 0; i < Math.max(count, 1); i++) {
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 1000 + i, new Intent(ctx, Reminders.class),
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
            if (pi != null) { am.cancel(pi); pi.cancel(); }
        }
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        // אחרי הפעלה מחדש של הטלפון השעונים נמחקים – קובעים שוב מהרשימה השמורה
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) || "android.intent.action.MY_PACKAGE_REPLACED".equals(intent.getAction())) {
            set(ctx, ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "[]"));
            return;
        }
        show(ctx, intent.getStringExtra("title"), intent.getStringExtra("body"));
    }

    static void show(Context ctx, String title, String body) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "תזכורות קניות", NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent open = PendingIntent.getActivity(ctx, 0, new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        android.app.Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new android.app.Notification.Builder(ctx, CHANNEL) : new android.app.Notification.Builder(ctx);
        b.setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new android.app.Notification.BigTextStyle().bigText(body))
            .setContentIntent(open)
            .setAutoCancel(true);
        try { nm.notify((int) (System.currentTimeMillis() % 100000), b.build()); } catch (SecurityException ignored) { }
    }
}
