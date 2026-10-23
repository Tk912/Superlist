package il.superlist.cart;

// אפליקציית "מילוי עגלה" לאנדרואיד.
// הסל החכם (האתר) שולח לכאן את הרשימה (קישור superlist://fill?c=רשת&j=רשימה), והאפליקציה פותחת את אתר הסופר
// בתוכה ומריצה שם את אותו קוד מילוי כמו הכפתור במחשב (cart.js מהאתר). הכניסה לחשבון בסופר והתשלום – שלך בלבד.

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

public class MainActivity extends Activity {
    static final String APP_URL = "https://tk912.github.io/Superlist/";
    static final String HOME = "https://superlist.local/";
    static final int GREEN = Color.rgb(15, 122, 74);

    // אותן כתובות כמו CART_URLS באתר
    static final Map<String, String[]> SITES = new LinkedHashMap<>();
    static {
        SITES.put("shufersal", new String[]{"שופרסל", "https://www.shufersal.co.il/online/he/"});
        SITES.put("ramilevy", new String[]{"רמי לוי", "https://www.rami-levy.co.il/he/online"});
        SITES.put("carrefour", new String[]{"קרפור", "https://www.carrefour.co.il/"});
        SITES.put("hazihinam", new String[]{"חצי חינם", "https://shop.hazi-hinam.co.il/"});
        SITES.put("yochananof", new String[]{"יוחננוף", "https://yochananof.co.il/"});
        SITES.put("tivtaam", new String[]{"טיב טעם", "https://www.tivtaam.co.il/"});
        SITES.put("victory", new String[]{"ויקטורי", "https://www.victoryonline.co.il/"});
    }

    WebView web;
    TextView status;
    Button fillBtn;
    String job;          // הרשימה (JSON) כמו שהאתר שלח
    String chain;
    String cartJs;       // הקוד שממלא את העגלה, נטען מהאתר (ובלי אינטרנט – העותק שבאפליקציה)
    boolean autoPending; // למלא אוטומטית כשהאתר נטען בפעם הראשונה
    boolean filled;
    final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(GREEN);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(GREEN);
        int p = dp(8);
        bar.setPadding(p, p, p, p);

        status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        bar.addView(status, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        fillBtn = barButton("🛒 מלא עגלה", v -> fill(true));
        bar.addView(fillBtn);
        bar.addView(barButton("☰", v -> showHome()));
        root.addView(bar);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebChromeClient(new WebChromeClient()); // חלונות confirm/prompt של האתר ושל המילוי
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String url = u.toString();
                if (url.startsWith(HOME)) { homeLink(u.getPath()); return true; }
                String scheme = u.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) return false;
                // tel:, mailto:, intent: וכו' – לאפליקציה המתאימה בטלפון
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (autoPending && chain != null && url.startsWith("http") && !url.startsWith(HOME)) {
                    autoPending = false;
                    ui.postDelayed(() -> fill(false), 1500);
                }
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);

        loadCartJs();
        if (!handle(getIntent())) showHome();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    // superlist://fill?c=shufersal&j=<base64url של הרשימה>
    boolean handle(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"superlist".equals(data.getScheme())) return false;
        String c = data.getQueryParameter("c"), j = data.getQueryParameter("j");
        if (c == null || j == null || !SITES.containsKey(c)) { toast("הקישור לא תקין. שלח שוב מהסל החכם."); return false; }
        try {
            job = new String(Base64.decode(j, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP), StandardCharsets.UTF_8);
            new JSONObject(job); // רק בדיקה שזה JSON
        } catch (Exception e) { toast("לא הצלחתי לקרוא את הרשימה. שלח שוב מהסל החכם."); return false; }
        chain = c;
        filled = false;
        autoPending = true;
        status.setText(SITES.get(c)[0] + ": " + count() + " פריטים. אם צריך – התחבר לחשבון, ואז \"מלא עגלה\".");
        fillBtn.setVisibility(View.VISIBLE);
        web.loadUrl(SITES.get(c)[1]);
        return true;
    }

    int count() {
        try { JSONArray a = new JSONObject(job).getJSONArray("items"); return a.length(); } catch (Exception e) { return 0; }
    }

    // מריץ את cart.js בתוך אתר הסופר, עם הרשימה מוכנה ב-sessionStorage (משם cart.js קורא אותה)
    void fill(boolean byUser) {
        if (job == null) { toast("אין רשימה. בסל החכם לוחצים \"שלח לסופר\" ובוחרים רשת."); return; }
        String url = web.getUrl();
        if (url == null || url.startsWith(HOME)) { toast("פותח את " + SITES.get(chain)[0] + "…"); autoPending = true; web.loadUrl(SITES.get(chain)[1]); return; }
        if (cartJs == null) { toast("טוען את כפתור המילוי, נסה שוב בעוד רגע"); loadCartJs(); return; }
        if (filled && byUser) {
            new AlertDialog.Builder(this).setMessage("כבר מילאת את העגלה עם הרשימה הזו. להוסיף שוב את כל הפריטים?")
                .setPositiveButton("כן, שוב", (d, w) -> { filled = false; fill(true); })
                .setNegativeButton("ביטול", null).show();
            return;
        }
        filled = true;
        web.evaluateJavascript("try{sessionStorage.setItem('__sl_job'," + JSONObject.quote(job) + ");window.__slRunning=false;}catch(e){}", null);
        web.evaluateJavascript(cartJs, null);
    }

    void loadCartJs() {
        new Thread(() -> {
            String code = null;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(APP_URL + "cart.js?t=" + System.currentTimeMillis()).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                if (c.getResponseCode() == 200) code = read(c.getInputStream());
            } catch (Exception ignored) { }
            if (code == null) { try { code = read(getAssets().open("cart.js")); } catch (Exception ignored) { } }
            final String done = code;
            ui.post(() -> { if (done != null) cartJs = done; });
        }).start();
    }

    static String read(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[8192];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    // מסך פתיחה (כשפותחים את האפליקציה ישירות ולא מהסל החכם)
    void showHome() {
        StringBuilder h = new StringBuilder("<!doctype html><html dir=rtl lang=he><meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:16px;background:#f4f6f3;color:#1b2620}"
            + "a{display:block;background:#fff;border-radius:12px;padding:14px;margin:8px 0;color:#1b2620;text-decoration:none;box-shadow:0 1px 3px rgba(0,0,0,.08)}"
            + "a.main{background:#0f7a4a;color:#fff;text-align:center;font-weight:700}.m{color:#6b7a71;font-size:14px}</style>"
            + "<h2>🛒 מילוי עגלה</h2><p class=m>בסל החכם לוחצים \"שלח לסופר\" ובוחרים רשת – והעגלה מתמלאת כאן. התשלום תמיד אצלך.</p>"
            + "<a class=main href='" + HOME + "app'>פתח את הסל החכם</a>"
            + "<p class=m>כדאי להתחבר פעם אחת לחשבון בכל רשת שקונים בה (נשמר באפליקציה):</p>");
        for (Map.Entry<String, String[]> e : SITES.entrySet())
            h.append("<a href='").append(HOME).append("open/").append(e.getKey()).append("'>").append(e.getValue()[0]).append(" ←</a>");
        if (job != null) h.append("<a class=main href='").append(HOME).append("open/").append(chain).append("'>חזרה למילוי ב").append(SITES.get(chain)[0]).append("</a>");
        web.loadDataWithBaseURL(HOME, h.toString(), "text/html", "UTF-8", null);
        if (job == null) { status.setText("הסל החכם – מילוי עגלה"); fillBtn.setVisibility(View.GONE); }
    }

    void homeLink(String path) {
        if (path == null) return;
        if (path.equals("/app")) { open(APP_URL); return; }
        if (path.startsWith("/open/")) {
            String c = path.substring(6);
            if (!SITES.containsKey(c)) return;
            if (job == null || !c.equals(chain)) { status.setText(SITES.get(c)[0]); fillBtn.setVisibility(job != null && c.equals(chain) ? View.VISIBLE : View.GONE); }
            web.loadUrl(SITES.get(c)[1]);
        }
    }

    void open(String url) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception e) { toast("לא נמצא דפדפן"); }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    Button barButton(String text, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(GREEN);
        b.setBackgroundColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        b.setPadding(dp(12), 0, dp(12), 0);
        b.setMinHeight(dp(36));
        b.setMinimumHeight(dp(36));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(38));
        lp.setMarginStart(dp(6));
        b.setLayoutParams(lp);
        b.setOnClickListener(l);
        return b;
    }

    int dp(int v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }

    void toast(String t) { Toast.makeText(this, t, Toast.LENGTH_LONG).show(); }
}
