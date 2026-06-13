// ===== 通知自动同步模块 =====
// 支持两种模式：
//   模式1 (Android APP): 通过 AndroidBridge 获取原生通知 → AI解析
//   模式2 (浏览器): 轮询 localhost:8888 HTTP 服务获取预解析账单

var NOTIFY_SERVER = "http://localhost:8888";
var _syncedTimestamps = {};
var _syncTimer = null;
var _syncRunning = false;
var _lastSyncTime = null;
var _syncEnabled = false;
var _syncStatus = "idle"; // idle | checking | syncing | error
var SYNC_INTERVAL = 5000;

// --- 模式判断 ---
function isInApp() {
  try {
    return typeof AndroidBridge !== "undefined" && AndroidBridge.ping() === "ok";
  } catch (_) { return false; }
}

// --- 检查桥接是否在线 ---
async function checkBridge() {
  if (isInApp()) return true;
  try {
    var ctrl = new AbortController();
    setTimeout(function () { ctrl.abort(); }, 2000);
    var res = await fetch(NOTIFY_SERVER + "/hello", { signal: ctrl.signal });
    return res.ok;
  } catch (_) { return false; }
}

// --- 获取桥接状态描述 ---
function getBridgeType() {
  if (isInApp()) return "android";
  return "http";
}

function getAndroidPermissionStatus() {
  if (!isInApp()) {
    return {
      inApp: false,
      notificationEnabled: true,
      accessibilityEnabled: true
    };
  }

  var notificationEnabled = false;
  var accessibilityEnabled = false;
  try { notificationEnabled = !!AndroidBridge.isNotificationEnabled(); } catch (_) {}
  try { accessibilityEnabled = !!AndroidBridge.isAccessibilityEnabled(); } catch (_) {}

  return {
    inApp: true,
    notificationEnabled: notificationEnabled,
    accessibilityEnabled: accessibilityEnabled
  };
}

// --- 拉取待处理数据 ---
async function fetchPending() {
  if (isInApp()) {
    try {
      var json = AndroidBridge.getPendingNotifications();
      var all = JSON.parse(json);
      var pending = [];
      for (var i = 0; i < all.length; i++) {
        if (!_syncedTimestamps[all[i].createdAt]) {
          pending.push(all[i]);
        }
      }
      return pending;
    } catch (_) { return []; }
  } else {
    try {
      var ctrl = new AbortController();
      setTimeout(function () { ctrl.abort(); }, 3000);
      var res = await fetch(NOTIFY_SERVER + "/pending", { signal: ctrl.signal });
      if (!res.ok) return [];
      var all = await res.json();
      var pending = [];
      for (var i = 0; i < all.length; i++) {
        if (!_syncedTimestamps[all[i].createdAt]) {
          pending.push(all[i]);
        }
      }
      return pending;
    } catch (_) { return []; }
  }
}

// --- 确认已导入 ---
async function confirmImported(ids) {
  for (var i = 0; i < ids.length; i++) {
    _syncedTimestamps[ids[i]] = true;
  }
  if (isInApp()) {
    try { AndroidBridge.confirmImported(JSON.stringify(ids)); } catch (_) {}
  } else {
    try {
      await fetch(NOTIFY_SERVER + "/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids)
      });
    } catch (_) {}
  }
}

// --- 本地分类修正 ---
function classifyBillForSync(rawText, type) {
  if (!rawText) return type === "income" ? "工资" : "其他";
  var lower = rawText.toLowerCase();
  var bestCat = null, bestLen = 0;
  for (var cat in CATEGORY_KEYWORDS) {
    var keywords = CATEGORY_KEYWORDS[cat];
    for (var i = 0; i < keywords.length; i++) {
      var kw = keywords[i];
      if (lower.indexOf(kw.toLowerCase()) !== -1 && kw.length > bestLen) {
        bestCat = cat;
        bestLen = kw.length;
      }
    }
  }
  if (bestCat) return bestCat;
  if (/红包|转账|转给|收款/.test(rawText)) return "人情往来";
  if (/退款|报销|工资|奖金|补贴/.test(rawText)) return "工资";
  if (/缴费|水电|燃气|话费|宽带/.test(rawText)) return "居住";
  return type === "income" ? "工资" : "其他";
}

// --- 主同步循环 ---
async function autoSync() {
  if (!_syncEnabled || _syncRunning) return;
  _syncRunning = true;
  _syncStatus = "checking";

  try {
    var permission = getAndroidPermissionStatus();
    if (permission.inApp && !permission.notificationEnabled) {
      _syncStatus = "error";
      _syncRunning = false;
      return;
    }

    var ok = await checkBridge();
    if (!ok) { _syncStatus = "error"; _syncRunning = false; return; }

    var pending = await fetchPending();
    if (pending.length === 0) { _syncStatus = "idle"; _syncRunning = false; return; }

    _syncStatus = "syncing";
    var imported = 0;
    var importedIds = [];

    for (var i = 0; i < pending.length; i++) {
      var item = pending[i];
      try {
        var bill;
        if (item.rawText !== undefined) {
          // 模式1 (Android): 原始文本 → AI解析
          var result = await parseBillText(item.rawText);
          if (!result.amount) continue;
          bill = {
            amount: result.amount,
            type: result.type,
            channel: item.channel || "alipay",
            category: result.category,
            note: "[通知] " + (result.note || "").substring(0, 30),
            date: new Date().toISOString().split("T")[0],
            pinned: false
          };
        } else {
          // 模式2 (HTTP): 已预解析
          if (!item.amount || item.amount <= 0) continue;
          bill = {
            amount: item.amount,
            type: item.type || "expense",
            channel: item.channel || "alipay",
            category: item.category || "其他",
            note: "[通知] " + (item.note || "").substring(0, 30),
            date: item.date || new Date().toISOString().split("T")[0],
            pinned: false
          };
        }

        // 二次分类修正
        if (!bill.category || bill.category === "其他" || CATEGORIES.indexOf(bill.category) === -1) {
          var localCat = classifyBillForSync(item.rawText || (item.note || ""), bill.type);
          if (localCat && localCat !== "其他") {
            bill.category = localCat;
          } else if (CATEGORIES.indexOf(bill.category) === -1) {
            bill.category = bill.type === "income" ? "工资" : "其他";
          }
        }

        await addBill(bill);
        importedIds.push(item.createdAt);
        imported++;
      } catch (e) {
        console.warn("[Sync] 单条解析失败:", e.message);
      }
    }

    if (imported > 0) {
      await confirmImported(importedIds);
      _lastSyncTime = new Date();
      showToast("已自动记账 " + imported + " 笔");
      if (typeof refreshAll === "function") refreshAll();
    }
    _syncStatus = "idle";
  } catch (e) {
    console.warn("[Sync] 同步出错:", e.message);
    _syncStatus = "error";
  }
  _syncRunning = false;
}

// --- 启停控制 ---
function startAutoSync() {
  var permission = getAndroidPermissionStatus();
  if (permission.inApp && !permission.notificationEnabled) {
    _syncEnabled = false;
    _syncStatus = "error";
    showToast("请先开启通知使用权");
    return false;
  }

  _syncEnabled = true;
  _syncStatus = "idle";
  if (_syncTimer) return true;
  autoSync();
  _syncTimer = setInterval(autoSync, SYNC_INTERVAL);
  return true;
}

function stopAutoSync() {
  _syncEnabled = false;
  if (_syncTimer) {
    clearInterval(_syncTimer);
    _syncTimer = null;
  }
  _syncStatus = "idle";
}

function toggleAutoSync() {
  if (_syncEnabled) {
    stopAutoSync();
  } else {
    return startAutoSync();
  }
  return _syncEnabled;
}

function getSyncInfo() {
  return {
    enabled: _syncEnabled,
    status: _syncStatus,
    bridgeType: isInApp() ? "android" : "http",
    lastSyncTime: _lastSyncTime ? _lastSyncTime.toLocaleTimeString("zh-CN") : null,
    syncedCount: Object.keys(_syncedTimestamps).length
  };
}

// --- 设置页同步 UI ---
function initSyncUI() {
  var toggleBtn = document.getElementById("btn-toggle-sync");
  var dot = document.getElementById("sync-dot");
  var text = document.getElementById("sync-status-text");
  var nativeActions = document.getElementById("sync-native-actions");
  var notificationBtn = document.getElementById("btn-open-notification-settings");
  var accessibilityBtn = document.getElementById("btn-open-accessibility-settings");
  var simulateBtn = document.getElementById("btn-simulate-notification");

  if (!toggleBtn || !dot || !text) return;

  function updateUI() {
    var permission = getAndroidPermissionStatus();

    if (nativeActions) {
      nativeActions.style.display = permission.inApp ? "flex" : "none";
    }

    if (notificationBtn && permission.inApp) {
      notificationBtn.textContent = permission.notificationEnabled ? "通知已开" : "通知权限";
    }
    if (accessibilityBtn && permission.inApp) {
      accessibilityBtn.textContent = permission.accessibilityEnabled ? "无障碍已开" : "无障碍";
    }

    if (_syncEnabled) {
      toggleBtn.textContent = "关闭通知同步";
      if (permission.inApp && !permission.notificationEnabled) {
        dot.className = "sync-dot error";
        text.textContent = "请先开启通知使用权";
      } else if (_syncStatus === "syncing") {
        dot.className = "sync-dot syncing";
        text.textContent = "同步中...";
      } else if (_syncStatus === "checking") {
        dot.className = "sync-dot syncing";
        text.textContent = "检测桥接...";
      } else if (_syncStatus === "error") {
        dot.className = "sync-dot error";
        text.textContent = permission.inApp ? "同步异常，请检查权限" : "未连接通知服务";
      } else {
        dot.className = "sync-dot online";
        text.textContent = _lastSyncTime ? "已启动 (上次: " + _lastSyncTime.toLocaleTimeString("zh-CN") + ")" :
          (permission.inApp && !permission.accessibilityEnabled ? "已启动，建议开启无障碍辅助识别" : "已启动，等待通知...");
      }
    } else {
      toggleBtn.textContent = "开启通知同步";
      if (_syncStatus === "error" && permission.inApp && !permission.notificationEnabled) {
        dot.className = "sync-dot error";
        text.textContent = "请先开启通知使用权";
      } else {
        dot.className = "sync-dot offline";
        text.textContent = "未启动";
      }
    }
  }

  toggleBtn.addEventListener("click", function () {
    toggleAutoSync();
    updateUI();
  });

  if (notificationBtn) {
    notificationBtn.addEventListener("click", function () {
      if (isInApp()) {
        try { AndroidBridge.openNotificationSettings(); } catch (_) {}
      } else {
        showToast("浏览器版无法打开手机通知权限");
      }
    });
  }

  if (accessibilityBtn) {
    accessibilityBtn.addEventListener("click", function () {
      if (isInApp()) {
        try { AndroidBridge.openAccessibilitySettings(); } catch (_) {}
      } else {
        showToast("浏览器版无法打开手机无障碍设置");
      }
    });
  }

  if (simulateBtn) {
    simulateBtn.addEventListener("click", function () {
      if (!isInApp()) {
        showToast("测试通知仅 Android 版可用");
        return;
      }

      try {
        AndroidBridge.simulateNotification();
        var wasEnabled = _syncEnabled;
        _syncEnabled = true;
        autoSync().then(function () {
          if (!wasEnabled && !_syncTimer) _syncEnabled = false;
          updateUI();
        });
        showToast("测试通知已生成，正在导入...");
      } catch (_) {
        showToast("生成测试通知失败");
      }
    });
  }

  updateUI();

  // 定时刷新 UI
  setInterval(updateUI, 3000);
}
