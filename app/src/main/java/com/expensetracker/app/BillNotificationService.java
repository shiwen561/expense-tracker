package com.expensetracker.app;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

public class BillNotificationService extends NotificationListenerService {

    private static final String ALIPAY_PKG = "com.eg.android.AlipayGphone";
    private static final String WECHAT_PKG = "com.tencent.mm";

    // 支付关键词 —— 先在原生层初筛，但同时也记录未匹配的到调试列表
    private static final String[] PAY_KEYWORDS = {
        "支出", "收入", "消费", "付款", "收款", "转账",
        "扣款", "余额", "缴费", "支付", "退款", "红包",
        "扫码", "刷卡", "网上支付", "快捷支付", "零钱",
        "花呗", "借呗", "余额宝", "零钱通", "到账", "入账",
        "提现", "充值", "订单"
    };

    // 支付通知队列
    private static final List<PendingNotification> pendingList = new ArrayList<>();
    // 调试队列：记录最近所有通知（含未匹配的）
    private static final List<String> debugLog = new ArrayList<>();
    private static final int MAX_PENDING = 100;
    private static final int MAX_DEBUG = 50;

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String pkg = sbn.getPackageName();
        if (!ALIPAY_PKG.equals(pkg) && !WECHAT_PKG.equals(pkg)) return;

        Notification n = sbn.getNotification();
        if (n == null) return;

        Bundle extras = n.extras;
        String title = extras != null ? extras.getString(Notification.EXTRA_TITLE, "") : "";
        String content = extras != null ? extras.getString(Notification.EXTRA_TEXT, "") : "";
        if (title == null) title = "";
        if (content == null) content = "";

        String fullText = (title + " " + content).trim();
        if (fullText.isEmpty()) return;

        String channel = ALIPAY_PKG.equals(pkg) ? "alipay" : "wechat";
        long timestamp = System.currentTimeMillis();
        String timeStr = new SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(new Date());

        // 记录到调试日志
        String appName = ALIPAY_PKG.equals(pkg) ? "支付宝" : "微信";
        String matched = isPaymentNotification(fullText) ? "✓匹配" : "✗未匹配";
        String logEntry = "[" + timeStr + "] " + appName + " " + matched + ": " +
                          fullText.substring(0, Math.min(80, fullText.length()));
        synchronized (debugLog) {
            debugLog.add(logEntry);
            if (debugLog.size() > MAX_DEBUG) debugLog.remove(0);
        }

        // 支付通知入队
        if (isPaymentNotification(fullText)) {
            synchronized (pendingList) {
                pendingList.add(new PendingNotification(fullText, channel, timestamp));
                if (pendingList.size() > MAX_PENDING) pendingList.remove(0);
            }
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {}

    private boolean isPaymentNotification(String text) {
        for (String kw : PAY_KEYWORDS) {
            if (text.contains(kw)) return true;
        }
        return false;
    }

    // ==================== 静态方法 ====================

    public static String getPendingNotificationsJson() {
        JSONArray arr = new JSONArray();
        synchronized (pendingList) {
            for (PendingNotification p : pendingList) {
                try {
                    JSONObject obj = new JSONObject();
                    obj.put("rawText", p.rawText);
                    obj.put("channel", p.channel);
                    obj.put("createdAt", p.timestamp);
                    arr.put(obj);
                } catch (Exception ignored) {}
            }
        }
        return arr.toString();
    }

    public static void removeImported(String idsJson) {
        try {
            JSONArray ids = new JSONArray(idsJson);
            List<Long> idList = new ArrayList<>();
            for (int i = 0; i < ids.length(); i++) {
                idList.add(ids.getLong(i));
            }
            synchronized (pendingList) {
                Iterator<PendingNotification> it = pendingList.iterator();
                while (it.hasNext()) {
                    if (idList.contains(it.next().timestamp)) {
                        it.remove();
                    }
                }
            }
        } catch (Exception ignored) {}
    }

    public static void addTestNotification() {
        synchronized (pendingList) {
            pendingList.add(new PendingNotification(
                "支付宝 - 交易提醒：您尾号1234的银行卡支出29.90元，商户：美团外卖",
                "alipay",
                System.currentTimeMillis()
            ));
        }
    }

    /** 返回调试日志：最近捕获到的所有微信/支付宝通知（含未匹配的） */
    public static String getDebugLog() {
        JSONArray arr = new JSONArray();
        synchronized (debugLog) {
            for (String entry : debugLog) {
                arr.put(entry);
            }
        }
        return arr.toString();
    }

    /** 清空调试日志 */
    public static void clearDebugLog() {
        synchronized (debugLog) {
            debugLog.clear();
        }
    }

    // ==================== 内部数据类 ====================

    private static class PendingNotification {
        final String rawText;
        final String channel;
        final long timestamp;

        PendingNotification(String rawText, String channel, long timestamp) {
            this.rawText = rawText;
            this.channel = channel;
            this.timestamp = timestamp;
        }
    }
}
