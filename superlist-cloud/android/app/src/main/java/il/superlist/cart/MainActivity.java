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

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executor;

public class MainActivity extends Activity {
    static final String APP_URL = "https://tk912.github.io/Superlist/";
    // מזהה ה-Web client של פרויקט ה-Firebase (superlist-205f4). לא סוד – מופיע בכל התחברות Google.
    static final String WEB_CLIENT_ID = "712350919796-ra3a3gu2srifrgqq8kqn9ktutb5cbc52.apps.googleusercontent.com";

    WebView web;
    final Handler ui = new Handler(Looper.getMainLooper());
    final Executor onUi = ui::post;

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
        s.setUserAgentString(s.getUserAgentString() + " SuperlistApp/1");
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

    // קישור ישן מהאתר בכרום: superlist://fill?c=רשת&j=רשימה – פותח מילוי עגלה
    void handle(Intent intent) {
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

    // מה שהדף יכול לבקש מהאפליקציה
    class Bridge {
        @JavascriptInterface public String version() { return "2"; }
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
