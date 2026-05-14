package com.expensetracker.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {

    private WebView webView;
    private boolean isServiceEnabled = false;

    // 文件选择器回调（用于 HTML 中的 <input type="file"> 导入功能）
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // 沉浸式状态栏
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                );
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }

        setupWebView();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        webView = findViewById(R.id.webview);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // JS 桥接
        webView.addJavascriptInterface(new AppBridge(), "AndroidBridge");

        // WebViewClient：在 APP 内打开链接
        webView.setWebViewClient(new WebViewClient());

        // WebChromeClient：处理文件选择器（导入 CSV/Excel 必须）
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView,
                    ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;

                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        webView.loadUrl("file:///android_asset/app.html");
    }

    // 处理文件选择器返回结果
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback == null) return;

            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                Uri uri = data.getData();
                if (uri != null) {
                    results = new Uri[]{uri};
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        isServiceEnabled = isNotificationServiceEnabled();
        if (webView != null) {
            webView.evaluateJavascript(
                "if(typeof onServiceStatusChanged==='function')onServiceStatusChanged(" +
                isServiceEnabled + ")", null
            );
        }
    }

    private boolean isNotificationServiceEnabled() {
        String listeners = Settings.Secure.getString(
            getContentResolver(),
            "enabled_notification_listeners"
        );
        if (listeners == null) return false;
        return listeners.contains(getPackageName());
    }

    // ==================== JS ↔ Java 桥接 ====================

    public class AppBridge {

        @JavascriptInterface
        public String getPendingNotifications() {
            return BillNotificationService.getPendingNotificationsJson();
        }

        @JavascriptInterface
        public void confirmImported(String idsJson) {
            BillNotificationService.removeImported(idsJson);
        }

        @JavascriptInterface
        public String ping() {
            return "ok";
        }

        @JavascriptInterface
        public void openNotificationSettings() {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            startActivity(intent);
        }

        @JavascriptInterface
        public boolean isNotificationEnabled() {
            return isServiceEnabled;
        }

        @JavascriptInterface
        public void showToast(String message) {
            runOnUiThread(() ->
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show()
            );
        }

        /** 模拟一条测试通知，验证整个自动记账链路 */
        @JavascriptInterface
        public void simulateNotification() {
            BillNotificationService.addTestNotification();
            runOnUiThread(() ->
                Toast.makeText(MainActivity.this, "测试通知已生成，5秒内将自动记账", Toast.LENGTH_SHORT).show()
            );
        }
    }
}
