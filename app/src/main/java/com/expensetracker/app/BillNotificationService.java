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

public class BillNotificationService extends NotificationListenerService {

    private static final String ALIPAY_PKG = "com.eg.android.AlipayGphone";
    private static final String WECHAT_PKG = "com.tencent.mm";

    private static final String[] PAY_KEYWORDS = {
        "支出", "收入", "消费", "付款", "收款", "转账",
        "扣款", "余额", "缴费", "支付", "退款", "红包",
        "扫码", "刷卡", "网上支付", "快捷支付", "零钱",
        "花呗", "借呗", "余额宝", "零钱通"
    };

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

        android.util.Log.d("BillNotification", "Captured: " + fullText.substring(0, Math.min(60, fullText.length())));
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

    /** 添加一条模拟测试通知 */
    public static void addTestNotification() {
        synchronized (pendingList) {
            pendingList.add(new PendingNotification(
                "支付宝 - 交易提醒：您尾号1234的银行卡支出29.90元，商户：美团外卖，时间：今天",
                "alipay",
                System.currentTimeMillis()
            ));
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
