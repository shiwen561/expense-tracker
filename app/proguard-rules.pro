# 不混淆，保持 WebView JavaScript 接口可用
-keepclassmembers class com.expensetracker.app.MainActivity$AppBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.expensetracker.app.BillNotificationService { *; }
