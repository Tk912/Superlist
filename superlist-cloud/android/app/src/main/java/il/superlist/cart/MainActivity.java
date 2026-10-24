package il.superlist.cart;

// אפליקציית "הסל החכם" לאנדרואיד: כל האפליקציה (האתר tk912.github.io/Superlist) בתוך האפליקציה,
// ובנוסף מה שאתר לבד לא יכול: התחברות Google דרך החשבון בטלפון, ומילוי עגלה אוטומטי באתר הסופר (CartActivity).
// הדף מדבר עם האפליקציה דרך window.SuperlistNative.

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

import android.content.ActivityNotFoundException;
import android.speech.RecognizerIntent;
import java.util.ArrayList;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    static final String APP_URL = "https://tk912.github.io/Superlist/";
    // מזהה ה-Web client של פרויקט ה-Firebase (superlist-205f4). לא סוד – מופיע בכל התחברות Google.
    static final String WEB_CLIENT_ID = "712350919796-ra3a3gu2srifrgqq8kqn9ktutb5cbc52.apps.googleusercontent.com";

    WebView web;
    final Handler ui = new Handler(Looper.getMainLooper());
    final Executor onUi = ui::post;
    final ExecutorService net = Executors.newFixedThreadPool(4);
    String sharedText;   // טקסט ששותף לאפליקציה (קישור למתכון / רשימת קניות), נמסר לדף כשהוא מוכן
    int shareTries;
    boolean pageReady;
    String userAgent;    // לבקשות הרשת (WebView אפשר לשאול רק מה-UI thread)

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.rgb(15, 122, 74));

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // הדף מזהה שהוא בתוך האפליקציה גם לפי זה
        userAgent = s.getUserAgentString();
        s.setUserAgentString(userAgent + " SuperlistApp/1");
        CookieManager.getInstance().setAcceptCookie(true);
        web.addJavascriptInterface(new Bridge(), "SuperlistNative");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                // רק דפי הסל החכם נפתחים כאן; כל קישור אחר – בדפדפן
                if ("tk912.github.io".equals(u.getHost()) && u.getPath() != null && u.getPath().startsWith("/Superlist")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                deliverShared();
            }
        });
        setContentView(web);

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(APP_URL);
        handle(getIntent());
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // חזרה מהמילוי (אולי התחברת לרשת) – הדף יכול לרענן מועדי משלוח
        if (pageReady) js("window.onAppResume&&onAppResume()");
    }

    // "שיתוף" מאפליקציה אחרת: קישור למתכון מהדפדפן, או רשימת קניות מוואטסאפ/פתקים/AddIt
    void deliverShared() {
        if (sharedText == null || !pageReady) return;
        String t = sharedText;
        sharedText = null;
        // הדף מחזיר true כשקיבל; אם עוד לא נטען (או מחכה להתחברות) מנסים שוב, עד דקה
        ui.postDelayed(() -> web.evaluateJavascript("window.onSharedText?onSharedText(" + JSONObject.quote(t) + "):false", r -> {
            if (!"true".equals(r) && ++shareTries < 60) { sharedText = t; ui.postDelayed(this::deliverShared, 1000); }
            else shareTries = 0;
        }), 300);
    }

    // קישור ישן מהאתר בכרום: superlist://fill?c=רשת&j=רשימה – פותח מילוי עגלה
    void handle(Intent intent) {
        if (intent != null && Intent.ACTION_SEND.equals(intent.getAction())) {
            String t = intent.getStringExtra(Intent.EXTRA_TEXT);
            String subj = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (t != null) { sharedText = (subj != null && !t.contains(subj) ? subj + "\n" : "") + t; deliverShared(); }
            return;
        }
        Uri d = intent == null ? null : intent.getData();
        if (d == null || !"superlist".equals(d.getScheme())) return;
        String c = d.getQueryParameter("c"), j = d.getQueryParameter("j");
        if (c == null || j == null) return;
        try {
            String job = new String(Base64.decode(j, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP), StandardCharsets.UTF_8);
            openCart(c, job);
        } catch (Exception ignored) { }
    }

    void openCart(String chain, String job) {
        startActivity(new Intent(this, CartActivity.class).putExtra("chain", chain).putExtra("job", job));
    }

    void js(String code) { ui.post(() -> web.evaluateJavascript(code, null)); }

    // התחברות עם חשבון Google שבטלפון. מחזירה לדף ID token, והדף נכנס איתו ל-Firebase (cloud.js).
    void googleSignIn() {
        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(WEB_CLIENT_ID).build();
        GetCredentialRequest req = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        CredentialManager.create(this).getCredentialAsync(this, req, new CancellationSignal(), onUi,
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse r) {
                    Credential c = r.getCredential();
                    if (c instanceof CustomCredential && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(c.getType())) {
                        try {
                            String token = GoogleIdTokenCredential.createFrom(((CustomCredential) c).getData()).getIdToken();
                            js("window.__nativeSignIn&&__nativeSignIn.res(" + JSONObject.quote(token) + ")");
                            return;
                        } catch (Exception e) { fail("native/bad-credential", e.getMessage()); return; }
                    }
                    fail("native/unexpected-credential", c.getType());
                }

                @Override
                public void onError(GetCredentialException e) {
                    fail(e instanceof GetCredentialCancellationException ? "native/cancelled" : "native/" + e.getClass().getSimpleName(), e.getMessage());
                }
            });
    }

    void fail(String code, String msg) {
        js("window.__nativeSignIn&&__nativeSignIn.rej({code:" + JSONObject.quote(code) + ",message:" + JSONObject.quote(msg == null ? "" : msg) + "})");
    }

    void googleSignOut() {
        CredentialManager.create(this).clearCredentialStateAsync(new ClearCredentialStateRequest(), new CancellationSignal(), onUi,
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override public void onResult(Void v) { }
                @Override public void onError(ClearCredentialException e) { }
            });
    }

    // בקשת רשת מהאפליקציה (בלי מגבלות הדפדפן), עם ההתחברות שנשמרה באפליקציה לאתרי הרשתות.
    // משמשת למועדי משלוח (slots.js) ולייבוא מתכון מקישור. התשובה חוזרת ל-window.__nativeHttp(id, status, text).
    void http(String id, String url, String method, String headersJson, String body) {
        net.execute(() -> {
            int status = 0;
            String text;
            try {
                if (!url.startsWith("https://")) throw new Exception("https only");
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(12000);
                c.setReadTimeout(15000);
                c.setInstanceFollowRedirects(true);
                c.setRequestMethod(method == null || method.isEmpty() ? "GET" : method);
                c.setRequestProperty("User-Agent", userAgent);
                c.setRequestProperty("Accept-Language", "he-IL,he;q=0.9");
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) c.setRequestProperty("Cookie", cookies);
                if (headersJson != null && !headersJson.isEmpty()) {
                    JSONObject h = new JSONObject(headersJson);
                    for (Iterator<String> it = h.keys(); it.hasNext(); ) { String k = it.next(); c.setRequestProperty(k, h.getString(k)); }
                }
                if (body != null && !body.isEmpty()) {
                    c.setDoOutput(true);
                    try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
                }
                status = c.getResponseCode();
                for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet())
                    if ("Set-Cookie".equalsIgnoreCase(e.getKey())) for (String v : e.getValue()) CookieManager.getInstance().setCookie(url, v);
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                text = in == null ? "" : read(in);
            } catch (Exception e) {
                text = String.valueOf(e.getMessage());
            }
            js("window.__nativeHttp&&__nativeHttp(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(text) + ")");
        });
    }

    static String read(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[8192];
        int n;
        while ((n = in.read(b)) > 0) out.write(b, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    // סריקת ברקוד: הסורק של Google (נפתח מעל האפליקציה). התוצאה ל-window.onNativeBarcode(code | null, error)
    void scanBarcode() {
        GmsBarcodeScannerOptions opts = new GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A, Barcode.FORMAT_UPC_E, Barcode.FORMAT_CODE_128)
            .build();
        GmsBarcodeScanning.getClient(this, opts).startScan()
            .addOnSuccessListener(b -> js("window.onNativeBarcode&&onNativeBarcode(" + JSONObject.quote(String.valueOf(b.getRawValue())) + ")"))
            .addOnCanceledListener(() -> js("window.onNativeBarcode&&onNativeBarcode(null,'cancelled')"))
            .addOnFailureListener(e -> js("window.onNativeBarcode&&onNativeBarcode(null," + JSONObject.quote(String.valueOf(e.getMessage())) + ")"));
    }

    // הוספה קולית: זיהוי הדיבור של הטלפון (עברית). התוצאה ל-window.onNativeVoice(text | null, error)
    static final int REQ_VOICE = 41;
    void voice() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "he-IL");
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, "מה להוסיף לרשימה?");
        try { startActivityForResult(i, REQ_VOICE); }
        catch (ActivityNotFoundException e) { js("window.onNativeVoice&&onNativeVoice(null,'no-recognizer')"); }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != REQ_VOICE) return;
        ArrayList<String> r = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        String t = res == RESULT_OK && r != null && !r.isEmpty() ? r.get(0) : null;
        js("window.onNativeVoice&&onNativeVoice(" + (t == null ? "null,'cancelled'" : JSONObject.quote(t)) + ")");
    }

    // מה שהדף יכול לבקש מהאפליקציה
    class Bridge {
        @JavascriptInterface public String version() { return "5"; }
        // מספר הגרסה המותקנת (מספר הבנייה ב-GitHub) – הדף משווה לגרסה האחרונה ומציג "יש עדכון זמין"
        @SuppressWarnings("deprecation")
        @JavascriptInterface public int appVersion() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode; } catch (Exception e) { return 0; }
        }
        @JavascriptInterface public void scan() { ui.post(MainActivity.this::scanBarcode); }
        @JavascriptInterface public void voice() { ui.post(MainActivity.this::voice); }
        @JavascriptInterface public void http(String id, String url, String method, String headers, String body) { MainActivity.this.http(id, url, method, headers, body); }
        @JavascriptInterface public void signIn() { ui.post(MainActivity.this::googleSignIn); }
        @JavascriptInterface public void signOut() { ui.post(MainActivity.this::googleSignOut); }
        @JavascriptInterface public void fill(String chain, String job) { ui.post(() -> openCart(chain, job)); }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
