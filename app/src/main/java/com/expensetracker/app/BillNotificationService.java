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
        addToQueue(fullText, channel, timestamp, "📩通知");

        // OCR 放到后台线程，不阻塞主线程，不崩溃
        final String ch = channel;
        final long ts = timestamp;
        new Thread(() -> {
            try {
                String ocrText = extractOcrText(n);
                if (!ocrText.isEmpty()) {
                    addToQueue(fullText + " [OCR] " + ocrText, ch, ts, "📩+OCR");
                }
            } catch (Exception ignored) {}
        }).start();
    }

    private String extractAllText(Notification n, StatusBarNotification sbn) {
        Bundle extras = n.extras;
        StringBuilder sb = new StringBuilder();

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

            // 遍历所有 extras
            for (String key : extras.keySet()) {
                if (key.equals(Notification.EXTRA_TITLE) ||
                    key.equals(Notification.EXTRA_TEXT) ||
                    key.equals(Notification.EXTRA_SUB_TEXT) ||
                    key.equals(Notification.EXTRA_BIG_TEXT) ||
                    key.equals(Notification.EXTRA_SUMMARY_TEXT) ||
                    key.equals(Notification.EXTRA_INFO_TEXT)) continue;
                Object val = extras.get(key);
                if (val instanceof String && !((String) val).isEmpty()) {
                    sb.append((String) val).append(" ");
                } else if (val instanceof CharSequence && val.toString().length() > 0) {
                    sb.append(val.toString()).append(" ");
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
            // 去重：相同timestamp的不重复入队
            for (PendingNotification p : pendingList) {
                if (p.timestamp == timestamp) return;
            }
            pendingList.add(new PendingNotification(fullText, channel, timestamp));
            if (pendingList.size() > MAX_PENDING) pendingList.remove(0);
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
        synchronized (pendingList) {
            pendingList.add(new PendingNotification(
                "支付宝 - 交易提醒：您尾号1234的银行卡支出29.90元，商户：美团外卖",
                "alipay",
                System.currentTimeMillis()
            ));
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
