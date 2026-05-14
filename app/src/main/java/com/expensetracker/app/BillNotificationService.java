package com.expensetracker.app;

import android.app.Notification;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 原生通知监听服务。
 * 监听支付宝/微信的支付通知，提取原始文本，存放到静态队列中。
 * HTML 页面通过 MainActivity.AppBridge 拉取队列数据。
 */
public class BillNotificationService extends NotificationListenerService {

    // 目标应用包名
    private static final String ALIPAY_PKG = "com.eg.android.AlipayGphone";
    private static final String WECHAT_PKG = "com.tencent.mm";

    // 支付相关关键词（命中任一个才收集）
    private static final String[] PAY_KEYWORDS = {
        "支出", "收入", "消费", "付款", "收款", "转账",
        "扣款", "余额", "缴费", "支付", "退款", "红包",
        "扫码", "刷卡", "网上支付", "快捷支付", "零钱",
        "花呗", "借呗", "余额宝", "零钱通"
    };

    // 静态队列：跨进程共享（Service 和 Activity 在同一个进程）
    private static final List<PendingNotification> pendingList = new ArrayList<>();
    private static final int MAX_PENDING = 100;

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
        if (!isPaymentNotification(fullText)) return;

        String channel = ALIPAY_PKG.equals(pkg) ? "alipay" : "wechat";
        long timestamp = System.currentTimeMillis();

        synchronized (pendingList) {
            pendingList.add(new PendingNotification(fullText, channel, timestamp));
            if (pendingList.size() > MAX_PENDING) {
                pendingList.remove(0);
            }
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        // 不需要处理
    }

    private boolean isPaymentNotification(String text) {
        for (String kw : PAY_KEYWORDS) {
            if (text.contains(kw)) return true;
        }
        return false;
    }

    // ==================== 静态方法：供 MainActivity 桥接层调用 ====================

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
