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

    // ML Kit 中文 OCR（懒加载）
    private TextRecognizer ocr;

    private TextRecognizer getOcr() {
        if (ocr == null) {
            ocr = TextRecognition.getClient(new ChineseTextRecognizerOptions.Builder().build());
        }
        return ocr;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String pkg = sbn.getPackageName();
        if (!ALIPAY_PKG.equals(pkg) && !WECHAT_PKG.equals(pkg)) return;

        Notification n = sbn.getNotification();
        if (n == null) return;

        // ===== 1. 提取所有文字字段 =====
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

            for (String key : extras.keySet()) {
                if (key.equals(Notification.EXTRA_TITLE) ||
                    key.equals(Notification.EXTRA_TEXT) ||
                    key.equals(Notification.EXTRA_SUB_TEXT) ||
                    key.equals(Notification.EXTRA_BIG_TEXT) ||
                    key.equals(Notification.EXTRA_SUMMARY_TEXT) ||
                    key.equals(Notification.EXTRA_INFO_TEXT)) continue;

                Object val = extras.get(key);
                if (val instanceof String) {
                    String s = (String) val;
                    if (!s.isEmpty()) sb.append(s).append(" ");
                } else if (val instanceof CharSequence) {
                    String s = val.toString();
                    if (!s.isEmpty()) sb.append(s).append(" ");
                }
            }
        }

        if (n.tickerText != null) {
            sb.append(n.tickerText.toString()).append(" ");
        }

        // ===== 2. 提取通知中的图片，跑 OCR =====
        List<Bitmap> bitmaps = new ArrayList<>();
        if (extras != null) {
            // 通知中的大图、小图
            Bitmap pic = extras.getParcelable(Notification.EXTRA_PICTURE);
            if (pic != null) bitmaps.add(pic);

            Bitmap largeIcon = extras.getParcelable(Notification.EXTRA_LARGE_ICON);
            if (largeIcon != null) bitmaps.add(largeIcon);
        }
        // 通知本身的 largeIcon
        if (n.largeIcon != null) bitmaps.add(n.largeIcon);

        String ocrText = "";
        if (!bitmaps.isEmpty()) {
            try {
                ocrText = runOcr(bitmaps);
                if (!ocrText.isEmpty()) sb.append(" [OCR] ").append(ocrText);
            } catch (Exception e) {
                android.util.Log.e("BillNotification", "OCR failed: " + e.getMessage());
            }
        }

        String fullText = sb.toString().trim();
        if (fullText.isEmpty()) return;

        String channel = ALIPAY_PKG.equals(pkg) ? "alipay" : "wechat";
        long timestamp = System.currentTimeMillis();
        String timeStr = new SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(new Date());
        String appName = ALIPAY_PKG.equals(pkg) ? "支付宝" : "微信";

        // 调试日志
        String logEntry = "[" + timeStr + "] " + appName + " 📩: " +
                          fullText.substring(0, Math.min(100, fullText.length()));
        if (!ocrText.isEmpty()) {
            logEntry += " (OCR:" + ocrText.length() + "字)";
        }
        synchronized (debugLog) {
            debugLog.add(logEntry);
            if (debugLog.size() > MAX_DEBUG) debugLog.remove(0);
        }

        // 入队
        synchronized (pendingList) {
            pendingList.add(new PendingNotification(fullText, channel, timestamp));
            if (pendingList.size() > MAX_PENDING) pendingList.remove(0);
        }
    }

    /** 对提取到的 Bitmap 列表运行 ML Kit OCR */
    private String runOcr(List<Bitmap> bitmaps) {
        StringBuilder result = new StringBuilder();
        TextRecognizer recognizer = getOcr();

        for (Bitmap bitmap : bitmaps) {
            if (bitmap == null) continue;
            // 限制图片大小避免 OOM
            int maxSize = 1024;
            Bitmap scaled = bitmap;
            if (bitmap.getWidth() > maxSize || bitmap.getHeight() > maxSize) {
                float ratio = Math.min((float) maxSize / bitmap.getWidth(),
                                       (float) maxSize / bitmap.getHeight());
                int w = Math.round(bitmap.getWidth() * ratio);
                int h = Math.round(bitmap.getHeight() * ratio);
                scaled = Bitmap.createScaledBitmap(bitmap, w, h, true);
            }

            InputImage image = InputImage.fromBitmap(scaled, 0);
            try {
                Text ocrResult = Tasks.await(recognizer.process(image), 10, TimeUnit.SECONDS);
                String text = ocrResult.getText();
                if (text != null && !text.trim().isEmpty()) {
                    result.append(text.trim()).append(" ");
                }
            } catch (Exception e) {
                android.util.Log.e("BillNotification", "OCR image failed: " + e.getMessage());
            }
        }
        return result.toString().trim();
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {}

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (ocr != null) {
            try { ocr.close(); } catch (Exception ignored) {}
            ocr = null;
        }
    }

    /** 供 BillAccessibilityService 调用：直接从无障碍服务写入通知文字 */
    public static void addFromAccessibility(String fullText, String channel, long timestamp) {
        synchronized (pendingList) {
            pendingList.add(new PendingNotification(fullText, channel, timestamp));
            if (pendingList.size() > MAX_PENDING) pendingList.remove(0);
        }
        // 同时记录调试日志
        String timeStr = new SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(new Date(timestamp));
        String appName = "alipay".equals(channel) ? "支付宝" : "微信";
        String logEntry = "[" + timeStr + "] " + appName + " ♿无障碍: " +
                          fullText.substring(0, Math.min(100, fullText.length()));
        synchronized (debugLog) {
            debugLog.add(logEntry);
            if (debugLog.size() > MAX_DEBUG) debugLog.remove(0);
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
