package com.expensetracker.app;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.os.Build;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 无障碍服务 — 全自动提取微信/支付宝支付金额
 *
 * 流程：
 * 1. 监听到支付相关通知（转账、支付凭证等）
 * 2. 自动打开通知栏 → 点击该通知 → 跳转到微信/支付宝详情页
 * 3. 扫描详情页 UI 节点树，提取金额
 * 4. 按返回键回到原来的页面
 */
public class BillAccessibilityService extends AccessibilityService {

    private static final String ALIPAY_PKG = "com.eg.android.AlipayGphone";
    private static final String WECHAT_PKG = "com.tencent.mm";

    // 触发自动提取的关键词
    private static final String[] TRIGGER_KEYWORDS = {
        "转账", "请收款", "支付凭证", "交易提醒", "到账", "入账",
        "消费", "付款成功", "支付成功", "已收款", "收款成功"
    };

    // 金额正则
    private static final Pattern AMOUNT_PATTERN = Pattern.compile(
        "[¥￥]\\s*(\\d+(?:\\.\\d{1,2})?)|(\\d+(?:\\.\\d{1,2})?)\\s*[元塊]");

    // 状态机
    private boolean isProcessing = false;
    private String targetChannel = "";
    private long processStartTime = 0;
    private static final long PROCESS_TIMEOUT = 15000; // 15秒超时

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        try {
            int type = event.getEventType();
            String pkg = event.getPackageName() != null ?
                event.getPackageName().toString() : "";

            // ===== 1. 通知到达 → 触发自动提取 =====
            if (type == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED) {
                handleNotificationEvent(event, pkg);
            }

            // ===== 2. 窗口切换 → 检查是否是支付详情页 =====
            if (isProcessing &&
                (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
                 type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED)) {
                handleWindowEvent(pkg);
            }

            // ===== 3. 超时保护 =====
            if (isProcessing &&
                System.currentTimeMillis() - processStartTime > PROCESS_TIMEOUT) {
                abort("超时");
            }

        } catch (Exception e) {
            abort("异常:" + e.getMessage());
        }
    }

    // ==================== 通知处理 ====================

    private void handleNotificationEvent(AccessibilityEvent event, String pkg) {
        if (isProcessing) return;
        if (!ALIPAY_PKG.equals(pkg) && !WECHAT_PKG.equals(pkg)) return;

        // 提取通知文字
        StringBuilder sb = new StringBuilder();
        for (CharSequence cs : event.getText()) {
            if (cs != null && cs.length() > 0) sb.append(cs.toString()).append(" ");
        }
        String text = sb.toString().trim();
        if (text.isEmpty()) return;

        // 同时通过 NotificationListener 的方式入队（兼容现有逻辑）
        String channel = ALIPAY_PKG.equals(pkg) ? "alipay" : "wechat";
        BillNotificationService.addFromAccessibility(text, channel, System.currentTimeMillis());

        // 检查是否匹配触发关键词
        if (!matchesTrigger(text)) return;

        // 触发全自动提取
        targetChannel = channel;
        startAutoExtract();
    }

    private boolean matchesTrigger(String text) {
        for (String kw : TRIGGER_KEYWORDS) {
            if (text.contains(kw)) return true;
        }
        return false;
    }

    // ==================== 自动提取主流程 ====================

    private void startAutoExtract() {
        isProcessing = true;
        processStartTime = System.currentTimeMillis();

        android.util.Log.d("BillA11y", "开始自动提取金额，渠道=" + targetChannel);

        // 延迟 500ms 等通知栏稳定，然后打开通知栏
        getMainHandler().postDelayed(() -> {
            if (!isProcessing) return;
            openNotificationPanel();
        }, 500);
    }

    /** 步骤1：打开通知栏 */
    private void openNotificationPanel() {
        // 用无障碍全局动作打开通知栏
        if (!performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)) {
            // 某些设备不支持，用下拉手势
            performSwipeDown();
        }

        // 等通知栏展开后找目标通知
        getMainHandler().postDelayed(() -> {
            if (!isProcessing) return;
            findAndClickNotification();
        }, 800);
    }

    /** 步骤2：在通知栏中找到并点击目标通知 */
    private void findAndClickNotification() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            abort("通知栏根节点为空");
            return;
        }

        try {
            AccessibilityNodeInfo target = findNotificationNode(root, targetChannel);
            if (target != null) {
                target.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                target.recycle();
                android.util.Log.d("BillA11y", "已点击通知，等待详情页...");

                // 关闭通知栏
                getMainHandler().postDelayed(() -> {
                    collapseNotificationPanel();
                }, 300);

            } else {
                // 通知栏里找不到，可能已被划掉，回退到扫描当前屏幕
                android.util.Log.d("BillA11y", "通知栏中未找到目标通知，扫描当前屏幕");
                collapseNotificationPanel();
                getMainHandler().postDelayed(() -> {
                    if (!isProcessing) return;
                    scanAndExtract(targetChannel);
                }, 500);
            }
        } catch (Exception e) {
            abort("查找通知异常:" + e.getMessage());
        } finally {
            root.recycle();
        }
    }

    /** 在通知栏节点树中搜索目标通知 */
    private AccessibilityNodeInfo findNotificationNode(AccessibilityNodeInfo root, String channel) {
        String appName = "alipay".equals(channel) ? "支付宝" : "微信";
        String[] searchTexts = "alipay".equals(channel)
            ? new String[]{"支付宝", "交易", "到账", "支付"}
            : new String[]{"微信", "转账", "支付", "收款"};

        // 方法1：按文字搜索
        for (String search : searchTexts) {
            for (AccessibilityNodeInfo node : root.findAccessibilityNodeInfosByText(search)) {
                if (node != null && node.isClickable()) {
                    // 找到一个可点击的、包含搜索文本的节点
                    AccessibilityNodeInfo clickable = findClickableParent(node);
                    node.recycle();
                    if (clickable != null) return clickable;
                }
                if (node != null) node.recycle();
            }
        }

        // 方法2：遍历所有节点找第一个可点击的包含关键词的
        return findClickableWithText(root, searchTexts);
    }

    private AccessibilityNodeInfo findClickableWithText(AccessibilityNodeInfo node, String[] keywords) {
        if (node == null) return null;

        // 检查当前节点
        if (node.isClickable() && node.getText() != null) {
            String text = node.getText().toString();
            for (String kw : keywords) {
                if (text.contains(kw)) {
                    return AccessibilityNodeInfo.obtain(node);
                }
            }
        }
        if (node.isClickable() && node.getContentDescription() != null) {
            String desc = node.getContentDescription().toString();
            for (String kw : keywords) {
                if (desc.contains(kw)) {
                    return AccessibilityNodeInfo.obtain(node);
                }
            }
        }

        // 递归子节点
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                AccessibilityNodeInfo result = findClickableWithText(child, keywords);
                child.recycle();
                if (result != null) return result;
            }
        }
        return null;
    }

    private AccessibilityNodeInfo findClickableParent(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo current = AccessibilityNodeInfo.obtain(node);
        while (current != null && !current.isClickable()) {
            AccessibilityNodeInfo parent = current.getParent();
            current.recycle();
            current = parent;
        }
        return current;
    }

    /** 关闭通知栏（用返回键收起） */
    private void collapseNotificationPanel() {
        performGlobalAction(GLOBAL_ACTION_BACK);
    }

    /** API < 30 的下拉手势 */
    private void performSwipeDown() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;
        Path path = new Path();
        path.moveTo(540, 0);
        path.lineTo(540, 800);
        GestureDescription.Builder builder = new GestureDescription.Builder();
        builder.addStroke(new GestureDescription.StrokeDescription(path, 0, 300));
        dispatchGesture(builder.build(), null, null);
    }

    // ==================== 详情页处理 ====================

    private void handleWindowEvent(String pkg) {
        if (ALIPAY_PKG.equals(pkg) || WECHAT_PKG.equals(pkg)) {
            // 微信/支付宝页面出现，等它加载完再扫描
            getMainHandler().removeCallbacksAndMessages(null);
            getMainHandler().postDelayed(() -> {
                if (!isProcessing) return;
                boolean found = scanAndExtract(targetChannel);
                if (found) {
                    // 提取成功，按返回键退出
                    getMainHandler().postDelayed(() -> {
                        performGlobalAction(GLOBAL_ACTION_BACK);
                        finish("提取成功");
                    }, 500);
                }
            }, 1500);
        }
    }

    /** 步骤3：扫描当前屏幕提取金额 */
    private boolean scanAndExtract(String channel) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return false;

        try {
            String allText = collectAllText(root, 0);
            String amount = extractAmount(allText);

            if (amount != null) {
                String fullText = "自动提取[" + channel + "]: " + allText;
                BillNotificationService.addFromAccessibility(
                    fullText, channel, System.currentTimeMillis());
                android.util.Log.d("BillA11y", "提取到金额: ¥" + amount);
                return true;
            }
            return false;
        } finally {
            root.recycle();
        }
    }

    private String collectAllText(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > 20) return "";
        StringBuilder sb = new StringBuilder();

        CharSequence text = node.getText();
        if (text != null && text.length() > 0) sb.append(text.toString()).append(" ");
        CharSequence desc = node.getContentDescription();
        if (desc != null && desc.length() > 0) sb.append(desc.toString()).append(" ");

        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                sb.append(collectAllText(child, depth + 1));
                child.recycle();
            }
        }
        return sb.toString();
    }

    private String extractAmount(String text) {
        Matcher m = AMOUNT_PATTERN.matcher(text);
        if (m.find()) {
            String amt = m.group(1) != null ? m.group(1) : m.group(2);
            if (amt != null && !amt.isEmpty() && !amt.equals("0") && !amt.equals("0.00")) {
                return amt;
            }
        }
        return null;
    }

    // ==================== 状态管理 ====================

    private void finish(String reason) {
        android.util.Log.d("BillA11y", "流程结束: " + reason);
        isProcessing = false;
        targetChannel = "";
    }

    private void abort(String reason) {
        android.util.Log.d("BillA11y", "流程中止: " + reason);
        isProcessing = false;
        targetChannel = "";
        collapseNotificationPanel();
    }

    @Override
    public void onInterrupt() {
        abort("服务中断");
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        isProcessing = false;
    }
}
