package com.expensetracker.app;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;

/**
 * 无障碍服务：监听通知变化，提取通知中所有可见文字（含 RemoteViews 自定义布局中的文字）。
 * 这些文字往往是 NotificationListenerService 拿不到的。
 */
public class BillAccessibilityService extends AccessibilityService {

    private static final String ALIPAY_PKG = "com.eg.android.AlipayGphone";
    private static final String WECHAT_PKG = "com.tencent.mm";

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) return;

        String pkg = event.getPackageName() != null ? event.getPackageName().toString() : "";
        if (!ALIPAY_PKG.equals(pkg) && !WECHAT_PKG.equals(pkg)) return;

        // 从 AccessibilityEvent 提取文字（通常比 Notification.extras 更完整）
        StringBuilder sb = new StringBuilder();
        for (CharSequence cs : event.getText()) {
            if (cs != null && cs.length() > 0) {
                sb.append(cs.toString()).append(" ");
            }
        }

        String fullText = sb.toString().trim();
        if (fullText.isEmpty()) return;

        String channel = ALIPAY_PKG.equals(pkg) ? "alipay" : "wechat";
        long timestamp = System.currentTimeMillis();

        // 直接写入 BillNotificationService 的静态队列
        BillNotificationService.addFromAccessibility(fullText, channel, timestamp);

        android.util.Log.d("BillA11y", "Captured via Accessibility: " +
            fullText.substring(0, Math.min(80, fullText.length())));
    }

    @Override
    public void onInterrupt() {}
}
