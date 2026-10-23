package il.superlist.cart;

// מילוי עגלה: פותח את אתר הסופר (עם ההתחברות שלך שנשמרת כאן) ומריץ בו את אותו קוד מילוי כמו הכפתור במחשב
// (cart.js מהאתר). הכניסה לחשבון בסופר והתשלום – שלך בלבד. "סיום" חוזר לרשימה.

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

public class CartActivity extends Activity {
    static final int GREEN = Color.rgb(15, 122, 74);

    // אותן כתובות כמו CART_URLS באתר
    static final Map<String, String[]> SITES = new HashMap<>();
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
    String job, chain, cartJs;
    boolean autoPending = true, filled;
    final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(GREEN);
        chain = getIntent().getStringExtra("chain");
        job = getIntent().getStringExtra("job");
        if (chain == null || job == null || !SITES.containsKey(chain)) { toast("לא התקבלה רשימה"); finish(); return; }

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(GREEN);
        bar.setPadding(dp(8), dp(8), dp(8), dp(8));
        TextView status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        status.setText(SITES.get(chain)[0] + ": " + count() + " פריטים. אם צריך – התחבר, ואז \"מלא עגלה\".");
        bar.addView(status, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        bar.addView(barButton("🛒 מלא עגלה", v -> fill(true)));
        bar.addView(barButton("✓ סיום", v -> finish()));
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
                String scheme = u.getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (autoPending && url.startsWith("http")) { autoPending = false; ui.postDelayed(() -> fill(false), 1500); }
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);

        loadCartJs();
        web.loadUrl(SITES.get(chain)[1]);
    }

    int count() {
        try { return new JSONObject(job).getJSONArray("items").length(); } catch (Exception e) { return 0; }
    }

    // מריץ את cart.js באתר הסופר, עם הרשימה מוכנה ב-sessionStorage (משם cart.js קורא אותה)
    void fill(boolean byUser) {
        if (cartJs == null) {
            if (byUser) toast("טוען את קוד המילוי, נסה שוב בעוד רגע");
            else ui.postDelayed(() -> fill(false), 1000);
            return;
        }
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
                HttpURLConnection c = (HttpURLConnection) new URL(MainActivity.APP_URL + "cart.js?t=" + System.currentTimeMillis()).openConnection();
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

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
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
