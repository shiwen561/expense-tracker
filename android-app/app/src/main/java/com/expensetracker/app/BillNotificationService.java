package com.expensetracker.app;

import android.app.Notification;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public class BillNotificationService extends NotificationListenerService {

    private static final String ALIPAY_PKG = "com.eg.android.AlipayGphone";
    private static final String WECHAT_PKG = "com.tencent.mm";

    private static final List<PendingNotification> pendingList = new ArrayList<>();
    private static final List<String> debugLog = new ArrayList<>();
    private static final int MAX_PENDING = 100;
    private static final int MAX_DEBUG = 50;

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String pkg = sbn.getPackageName();
        if (!ALIPAY_PKG.equals(pkg) && !WECHAT_PKG.equals(pkg)) return;

        Notification n = sbn.getNotification();
        if (n == null) return;

        // 提取所有文字
        String fullText = extractAllText(n, sbn);
        if (fullText.isEmpty()) return;

        String channel = ALIPAY_PKG.equals(pkg) ? "alipay" : "wechat";
        long timestamp = System.currentTimeMillis();

        // 先入库（不含OCR），后续OCR完成后原地更新
        addToQueue(fullText, channel, timestamp, "📩通知");

        // OCR 放到后台线程，完成后追加到同一条记录
        final String ch = channel;
        final long ts = timestamp;
        new Thread(() -> {
            try {
                String ocrText = extractOcrText(n);
                if (!ocrText.isEmpty()) {
                    appendOcrText(ch, ts, ocrText);
                }
            } catch (Exception ignored) {}
        }).start();
    }

    private String extractAllText(Notification n, StatusBarNotification sbn) {
        Bundle extras = n.extras;
        StringBuilder sb = new StringBuilder();

        // 记录通知的原始 key，方便调试
        if (extras != null) {
            String title = extras.getString(Notification.EXTRA_TITLE, "");
            String text = extras.getString(Notification.EXTRA_TEXT, "");
            String subText = extras.getString(Notification.EXTRA_SUB_TEXT, "");
            String bigText = extras.getString(Notification.EXTRA_BIG_TEXT, "");
            String summary = extras.getString(Notification.EXTRA_SUMMARY_TEXT, "");
            String info = extras.getString(Notification.EXTRA_INFO_TEXT, "");

            if (title != null && !title.isEmpty()) sb.append(title).append(" ");
            if (text != null && !text.isEmpty()) sb.append(text).append(" ");
            if (subText != null && !subText.isEmpty()) sb.append(subText).append(" ");
            if (bigText != null && !bigText.isEmpty()) sb.append(bigText).append(" ");
            if (summary != null && !summary.isEmpty()) sb.append(summary).append(" ");
            if (info != null && !info.isEmpty()) sb.append(info).append(" ");

            // 遍历所有 extras（包括自定义 key）
            for (String key : extras.keySet()) {
                if (key.equals(Notification.EXTRA_TITLE) ||
                    key.equals(Notification.EXTRA_TEXT) ||
                    key.equals(Notification.EXTRA_SUB_TEXT) ||
                    key.equals(Notification.EXTRA_BIG_TEXT) ||
                    key.equals(Notification.EXTRA_SUMMARY_TEXT) ||
                    key.equals(Notification.EXTRA_INFO_TEXT)) continue;

                Object val = extras.get(key);
                if (val == null) continue;

                // 跳过已知的非文本 key
                if (key.contains(".") &&
                    (key.endsWith(".icon") || key.endsWith(".large_icon") ||
                     key.endsWith(".picture") || key.endsWith(".actions") ||
                     key.endsWith(".progress") || key.endsWith(".color") ||
                     key.contains("intent") || key.contains("pending"))) continue;

                if (val instanceof String && !((String) val).isEmpty()) {
                    sb.append((String) val).append(" ");
                } else if (val instanceof CharSequence && val.toString().length() > 0) {
                    sb.append(val.toString()).append(" ");
                } else if (val instanceof String[]) {
                    for (String s : (String[]) val) {
                        if (s != null && !s.isEmpty()) sb.append(s).append(" ");
                    }
                }
            }
        }

        if (n.tickerText != null) sb.append(n.tickerText.toString()).append(" ");
        return sb.toString().trim();
    }

    /** 后台线程跑 OCR，不阻塞主线程 */
    private String extractOcrText(Notification n) {
        List<Bitmap> bitmaps = new ArrayList<>();
        if (n.extras != null) {
            Bitmap pic = n.extras.getParcelable(Notification.EXTRA_PICTURE);
            if (pic != null) bitmaps.add(pic);
            Bitmap largeIcon = n.extras.getParcelable(Notification.EXTRA_LARGE_ICON);
            if (largeIcon != null) bitmaps.add(largeIcon);
        }
        if (n.largeIcon != null) bitmaps.add(n.largeIcon);
        if (bitmaps.isEmpty()) return "";

        TextRecognizer recognizer = TextRecognition.getClient(
            new ChineseTextRecognizerOptions.Builder().build());
        StringBuilder result = new StringBuilder();

        for (Bitmap bitmap : bitmaps) {
            if (bitmap == null) continue;
            int maxSize = 1024;
            Bitmap scaled = bitmap;
            if (bitmap.getWidth() > maxSize || bitmap.getHeight() > maxSize) {
                float ratio = Math.min((float) maxSize / bitmap.getWidth(),
                                       (float) maxSize / bitmap.getHeight());
                scaled = Bitmap.createScaledBitmap(bitmap,
                    Math.round(bitmap.getWidth() * ratio),
                    Math.round(bitmap.getHeight() * ratio), true);
            }
            try {
                Text ocrResult = Tasks.await(recognizer.process(
                    InputImage.fromBitmap(scaled, 0)), 10, TimeUnit.SECONDS);
                String text = ocrResult.getText();
                if (text != null && !text.trim().isEmpty()) {
                    result.append(text.trim()).append(" ");
                }
            } catch (Exception ignored) {}
        }
        try { recognizer.close(); } catch (Exception ignored) {}
        return result.toString().trim();
    }

    private void addToQueue(String fullText, String channel, long timestamp, String tag) {
        String timeStr = new SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(new Date(timestamp));
        String appName = "alipay".equals(channel) ? "支付宝" : "微信";
        String logEntry = "[" + timeStr + "] " + appName + " " + tag + ": " +
                          fullText.substring(0, Math.min(100, fullText.length()));

        synchronized (debugLog) {
            debugLog.add(logEntry);
            if (debugLog.size() > MAX_DEBUG) debugLog.remove(0);
        }

        synchronized (pendingList) {
            // 去重：5秒内同渠道+文本相似度高的记录视为重复
            for (PendingNotification p : pendingList) {
                if (p.channel.equals(channel) &&
                    Math.abs(p.timestamp - timestamp) < 5000) {
                    // 取两者文本的前30字符比较，相似则合并
                    String a = p.rawText.length() > 30 ? p.rawText.substring(0, 30) : p.rawText;
                    String b = fullText.length() > 30 ? fullText.substring(0, 30) : fullText;
                    if (a.equals(b) || (a.contains(b) || b.contains(a))) {
                        if (!p.rawText.contains(fullText)) {
                            p.rawText = p.rawText + " | " + fullText;
                        }
                        return;
                    }
                }
            }
            pendingList.add(new PendingNotification(fullText, channel, timestamp));
            if (pendingList.size() > MAX_PENDING) pendingList.remove(0);
        }
    }

    /** OCR 完成后追加文本到已有记录 */
    private void appendOcrText(String channel, long originalTimestamp, String ocrText) {
        synchronized (pendingList) {
            for (PendingNotification p : pendingList) {
                if (p.channel.equals(channel) && p.timestamp == originalTimestamp) {
                    if (!p.rawText.contains(ocrText)) {
                        p.rawText = p.rawText + "\n[OCR] " + ocrText;
                    }
                    String timeStr = new SimpleDateFormat("HH:mm:ss", Locale.getDefault())
                        .format(new Date(System.currentTimeMillis()));
                    String appName = "alipay".equals(channel) ? "支付宝" : "微信";
                    synchronized (debugLog) {
                        debugLog.add("[" + timeStr + "] " + appName +
                            " 🔍OCR: " + ocrText.substring(0, Math.min(80, ocrText.length())));
                        if (debugLog.size() > MAX_DEBUG) debugLog.remove(0);
                    }
                    return;
                }
            }
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {}

    /** 供 BillAccessibilityService 调用 */
    public static void addFromAccessibility(String fullText, String channel, long timestamp) {
        String timeStr = new SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(new Date(timestamp));
        String appName = "alipay".equals(channel) ? "支付宝" : "微信";
        String logEntry = "[" + timeStr + "] " + appName + " ♿无障碍: " +
                          fullText.substring(0, Math.min(100, fullText.length()));

        synchronized (debugLog) {
            debugLog.add(logEntry);
            if (debugLog.size() > MAX_DEBUG) debugLog.remove(0);
        }

        synchronized (pendingList) {
            for (PendingNotification p : pendingList) {
                if (p.timestamp == timestamp) return;
            }
            pendingList.add(new PendingNotification(fullText, channel, timestamp));
            if (pendingList.size() > MAX_PENDING) pendingList.remove(0);
        }
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
        long now = System.currentTimeMillis();
        synchronized (pendingList) {
            // 模拟各种真实通知格式，用于测试解析链路
            pendingList.add(new PendingNotification(
                "支付宝 交易提醒 您尾号1234的银行卡支出29.90元 商户:美团外卖",
                "alipay", now + 1));
            pendingList.add(new PendingNotification(
                "微信支付 支付凭证 支付金额¥15.50 商品:星巴克",
                "wechat", now + 2));
            pendingList.add(new PendingNotification(
                "支付宝 到账通知 收到转账1000.00元 付款方:张三",
                "alipay", now + 3));
            pendingList.add(new PendingNotification(
                "微信支付 收款到账 收到¥200.00 来自:李四",
                "wechat", now + 4));
            pendingList.add(new PendingNotification(
                "支付宝 支付成功 88.00元 商户:肯德基",
                "alipay", now + 5));
            pendingList.add(new PendingNotification(
                "微信支付 已支付¥108.00 商户:滴滴出行",
                "wechat", now + 6));
            pendingList.add(new PendingNotification(
                "支付宝 交易退款 退款金额39.90元 原商户:淘宝",
                "alipay", now + 7));
            pendingList.add(new PendingNotification(
                "支付宝 生活缴费 电费156.00元",
                "alipay", now + 8));
        }
    }

    public static String getDebugLog() {
        JSONArray arr = new JSONArray();
        synchronized (debugLog) {
            for (String entry : debugLog) {
                arr.put(entry);
            }
        }
        return arr.toString();
    }

    public static void clearDebugLog() {
        synchronized (debugLog) {
            debugLog.clear();
        }
    }

    private static class PendingNotification {
        String rawText;       // 非final，OCR 后可追加
        final String channel;
        final long timestamp;
        PendingNotification(String rawText, String channel, long timestamp) {
            this.rawText = rawText;
            this.channel = channel;
            this.timestamp = timestamp;
        }
    }
}
