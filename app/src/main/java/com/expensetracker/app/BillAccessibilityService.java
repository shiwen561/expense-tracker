package com.expensetracker.app;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 无障碍服务：
 * 1. 监听通知变化，读取通知中所有文字
 * 2. 当微信/支付宝在前台时，扫描屏幕上的金额信息
 */
public class BillAccessibilityService extends AccessibilityService {

    private static final String ALIPAY_PKG = "com.eg.android.AlipayGphone";
    private static final String WECHAT_PKG = "com.tencent.mm";

    // 金额匹配正则
    private static final Pattern AMOUNT_PATTERN = Pattern.compile(
        "[¥￥]\\s*(\\d+(?:\\.\\d{1,2})?)|(\\d+(?:\\.\\d{1,2})?)\\s*[元塊]");

    private String lastCapturedAmount = "";
    private long lastCaptureTime = 0;
    private static final long MIN_INTERVAL_MS = 3000; // 3秒内不重复捕获

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        try {
            int type = event.getEventType();

            // ===== 1. 通知变化 =====
            if (type == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) {
                handleNotification(event);
            }

            // ===== 2. 窗口内容变化（微信/支付宝页面切换时） =====
            if (type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ||
                type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                String pkg = event.getPackageName() != null ?
                    event.getPackageName().toString() : "";
                if (ALIPAY_PKG.equals(pkg) || WECHAT_PKG.equals(pkg)) {
                    scanScreenForAmount(pkg);
                }
            }
        } catch (Exception ignored) {}
    }

    /** 处理通知事件 */
    private void handleNotification(AccessibilityEvent event) {
        String pkg = event.getPackageName() != null ?
            event.getPackageName().toString() : "";
        if (!ALIPAY_PKG.equals(pkg) && !WECHAT_PKG.equals(pkg)) return;

        StringBuilder sb = new StringBuilder();
        for (CharSequence cs : event.getText()) {
            if (cs != null && cs.length() > 0) {
                sb.append(cs.toString()).append(" ");
            }
        }

        String text = sb.toString().trim();
        if (text.isEmpty()) return;

        String channel = ALIPAY_PKG.equals(pkg) ? "alipay" : "wechat";
        BillNotificationService.addFromAccessibility(text, channel, System.currentTimeMillis());
    }

    /** 扫描当前屏幕上的金额信息 */
    private void scanScreenForAmount(String pkg) {
        long now = System.currentTimeMillis();
        if (now - lastCaptureTime < MIN_INTERVAL_MS) return;

        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;

        try {
            String screenText = collectAllText(root, 0);
            if (screenText.isEmpty()) return;

            // 查找金额
            String amount = extractAmount(screenText);
            if (amount == null || amount.equals(lastCapturedAmount)) return;

            lastCapturedAmount = amount;
            lastCaptureTime = now;

            String channel = ALIPAY_PKG.equals(pkg) ? "alipay" : "wechat";
            String fullText = "屏幕扫描: " + screenText;
            BillNotificationService.addFromAccessibility(fullText, channel, now);

            android.util.Log.d("BillA11y", "Screen capture: " + amount + " at " + pkg);

        } catch (Exception ignored) {
        } finally {
            root.recycle();
        }
    }

    /** 递归收集节点树中的所有文字（限制深度防止性能问题） */
    private String collectAllText(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 15) return "";
        StringBuilder sb = new StringBuilder();

        // 读当前节点的文字
        CharSequence text = node.getText();
        if (text != null && text.length() > 0) {
            sb.append(text.toString()).append(" ");
        }
        CharSequence desc = node.getContentDescription();
        if (desc != null && desc.length() > 0) {
            sb.append(desc.toString()).append(" ");
        }

        // 递归子节点
        int childCount = node.getChildCount();
        for (int i = 0; i < childCount; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                sb.append(collectAllText(child, depth + 1));
                child.recycle();
            }
        }
        return sb.toString();
    }

    /** 从文字中提取金额数字 */
    private String extractAmount(String text) {
        Matcher m = AMOUNT_PATTERN.matcher(text);
        if (m.find()) {
            String amt = m.group(1) != null ? m.group(1) : m.group(2);
            if (amt != null && !amt.isEmpty()) {
                return amt;
            }
        }
        return null;
    }

    @Override
    public void onInterrupt() {}

    @Override
    public void onDestroy() {
        super.onDestroy();
        lastCapturedAmount = "";
    }
}
