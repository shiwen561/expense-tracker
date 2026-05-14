package com.expensetracker.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {

    private WebView webView;
    private boolean isServiceEnabled = false;

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

    private void setupWebView() {
        webView = findViewById(R.id.webview);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);       // IndexedDB 需要的
        settings.setDatabaseEnabled(true);          // 同上
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // 通过桥接对象让 JS 可以调用 Java 方法
        webView.addJavascriptInterface(new AppBridge(), "AndroidBridge");

        // 在 WebView 内打开链接，不跳系统浏览器
        webView.setWebViewClient(new WebViewClient());

        webView.loadUrl("file:///android_asset/app.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        // 每次回到页面时检查通知监听权限是否已开启
        isServiceEnabled = isNotificationServiceEnabled();
        // 通知 WebView 权限状态变化
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

        /** JS 调用：获取所有待处理的原始通知 */
        @JavascriptInterface
        public String getPendingNotifications() {
            return BillNotificationService.getPendingNotificationsJson();
        }

        /** JS 调用：确认已导入，从队列中移除 */
        @JavascriptInterface
        public void confirmImported(String idsJson) {
            BillNotificationService.removeImported(idsJson);
        }

        /** JS 调用：测试桥接是否可用 */
        @JavascriptInterface
        public String ping() {
            return "ok";
        }

        /** JS 调用：打开系统通知监听权限设置 */
        @JavascriptInterface
        public void openNotificationSettings() {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            startActivity(intent);
        }

        /** JS 调用：检查通知监听权限 */
        @JavascriptInterface
        public boolean isNotificationEnabled() {
            return isServiceEnabled;
        }

        /** JS 调用：显示 Toast 消息 */
        @JavascriptInterface
        public void showToast(String message) {
            runOnUiThread(() ->
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show()
            );
        }
    }
}
