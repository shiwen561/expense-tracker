// ===== DeepSeek AI 模块 =====
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

// --- API Key 管理 ---
function getApiKey() {
  return localStorage.getItem("deepseek_api_key") || "";
}

function setApiKey(key) {
  localStorage.setItem("deepseek_api_key", key.trim());
}

function hasApiKey() {
  return getApiKey().length > 0;
}

// --- 从 AI 回复中鲁棒提取 JSON ---
function extractJson(content) {
  if (!content) return null;
  let cleaned = content.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  let m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (_) {}
  }
  try {
    let fixed = m ? m[0] : cleaned;
    fixed = fixed.replace(/'/g, '"');
    fixed = fixed.replace(/,\s*\}/g, "}");
    return JSON.parse(fixed);
  } catch (_) {}
  return null;
}

// --- 本地分类器 ---
function classifyFromText(text, type) {
  if (!text) return type === "income" ? "工资" : "其他";
  const lower = text.toLowerCase();
  let bestCat = null, bestLen = 0;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase()) && kw.length > bestLen) {
        bestCat = cat;
        bestLen = kw.length;
      }
    }
  }
  if (bestCat) return bestCat;
  if (/红包|转账|转给|收款/.test(text)) return "人情往来";
  if (/退款|报销|工资|奖金|补贴/.test(text)) return "工资";
  if (/缴费|水电|燃气|话费|宽带/.test(text)) return "居住";
  return type === "income" ? "工资" : "其他";
}

// --- 降级正则解析 ---
function fallbackParse(rawText) {
  const text = rawText || "";

  // 金额提取
  let amount = null;
  let m = text.match(/[¥￥]\s*(\d+\.?\d{0,2})/);
  if (!m) m = text.match(/(\d+\.?\d{0,2})\s*[元塊]/);
  if (!m) m = text.match(/(?:金额|消费|支付|扣款|付款|支出|花了)[^\d]{0,5}(\d+\.?\d{0,2})/);
  if (!m) {
    let multi = [...text.matchAll(/(\d+\.?\d{0,2})/g)];
    for (let match of multi.reverse()) {
      let val = parseFloat(match[1]);
      if (val > 0.01 && val < 1000000) { amount = val; break; }
    }
  }
  if (m && !amount) amount = parseFloat(m[1]);
  if (!amount || amount <= 0 || amount > 99999999) amount = null;

  // 收支类型判断
  let incomeScore = 0, expenseScore = 0;
  const incomeKW = ["收入","收款","入账","退款","报销","工资","到账","存入","汇入","转入","收到","领取","退税","补贴","收益","奖金","津贴","补助"];
  const expenseKW = ["支出","扣款","消费","付款","缴费","支付","扣除","购买","订单","购物","买单","结账"];
  for (let kw of incomeKW) { if (text.includes(kw)) incomeScore++; }
  for (let kw of expenseKW) { if (text.includes(kw)) expenseScore++; }
  if (/退款/.test(text)) incomeScore += 2;
  if (/红包/.test(text) && !/发送|发红包|发出/.test(text)) incomeScore += 2;
  if (/转账/.test(text)) {
    if (/转出|转给|向.*转/.test(text)) expenseScore += 2;
    else incomeScore += 1;
  }
  if (/工资卡|薪资/.test(text)) incomeScore += 3;
  let type = (incomeScore >= expenseScore) ? "income" : "expense";

  // 分类推断
  let category = classifyFromText(text, type);

  // 备注提取
  let note = "";
  let merchantM = text.match(/(?:商户|商家|收款方|付款方|来自|对方)[：:]\s*(.+?)(?:$|\s*，|\s*。|\s*$)/);
  if (merchantM) {
    note = merchantM[1].trim().substring(0, 20);
  } else {
    note = text.replace(/支付宝|微信支付|交易提醒|支付凭证|支付成功|到账通知|收款到账/g, "")
               .replace(/\s+/g, " ").trim().substring(0, 30);
  }

  return { amount, type, category, note };
}

// --- System Prompt ---
const PARSE_SYSTEM_PROMPT =
  "你是专业的记账数据解析器。从支付通知文本中提取记账信息。\n\n" +
  "## 分类（只能选一个）\n" +
  "餐饮、交通、购物、工资、娱乐、居住、数字服务、医疗、人情往来、其他\n\n" +
  "## 规则\n" +
  "- amount: 提取实际交易金额数字，退款取绝对值\n" +
  "- type: expense(支出) 或 income(收入)。退款、报销、收款、到账、红包收入、工资、转账收入→income\n" +
  "- category: 结合商户名和交易性质选最匹配的分类\n" +
  "- note: 提取商户名或交易摘要，不超过15字\n" +
  "- 只返回纯JSON，不要markdown代码块，不要任何额外文字\n\n" +
  "## 示例\n" +
  "输入: 支付宝-交易提醒 您尾号1234的银行卡支出29.90元 商户:美团外卖\n" +
  "输出: {\"amount\":29.90,\"type\":\"expense\",\"category\":\"餐饮\",\"note\":\"美团外卖\"}\n\n" +
  "输入: 微信支付 收款到账 收到¥100.00 来自:张三\n" +
  "输出: {\"amount\":100.00,\"type\":\"income\",\"category\":\"人情往来\",\"note\":\"张三转账\"}\n\n" +
  "输入: 支付宝 支付成功 88.00元 商户:肯德基W餐厅\n" +
  "输出: {\"amount\":88.00,\"type\":\"expense\",\"category\":\"餐饮\",\"note\":\"肯德基\"}\n\n" +
  "输入: 微信支付 已支付¥15.50 商户:星巴克\n" +
  "输出: {\"amount\":15.50,\"type\":\"expense\",\"category\":\"餐饮\",\"note\":\"星巴克\"}\n\n" +
  "输入: 支付宝 到账通知 收到转账1000.00元 付款方:李四\n" +
  "输出: {\"amount\":1000.00,\"type\":\"income\",\"category\":\"人情往来\",\"note\":\"李四转账\"}\n\n" +
  "输入: 支付宝 交易退款 退款金额39.90元 原商户:淘宝\n" +
  "输出: {\"amount\":39.90,\"type\":\"income\",\"category\":\"购物\",\"note\":\"淘宝退款\"}\n\n" +
  "输入: 微信支付 支付凭证 支付金额¥200.00 商品:中石化加油\n" +
  "输出: {\"amount\":200.00,\"type\":\"expense\",\"category\":\"交通\",\"note\":\"中石化加油\"}\n\n" +
  "输入: 支付宝 工资到账 收入8500.00元 付款方:XX公司\n" +
  "输出: {\"amount\":8500.00,\"type\":\"income\",\"category\":\"工资\",\"note\":\"工资\"}\n\n" +
  "输入: 微信支付 已支付¥108.00 商户:滴滴出行\n" +
  "输出: {\"amount\":108.00,\"type\":\"expense\",\"category\":\"交通\",\"note\":\"滴滴出行\"}\n\n" +
  "输入: 支付宝 生活缴费 电费156.00元\n" +
  "输出: {\"amount\":156.00,\"type\":\"expense\",\"category\":\"居住\",\"note\":\"电费\"}";

// --- DeepSeek 解析 ---
async function parseBillText(rawText) {
  const apiKey = getApiKey();
  if (!apiKey || !rawText.trim()) {
    return fallbackParse(rawText);
  }
  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: PARSE_SYSTEM_PROMPT },
          { role: "user", content: "从以下文本提取记账信息：\n\n" + rawText }
        ],
        temperature: 0.0,
        max_tokens: 200
      })
    });
    if (!res.ok) {
      if (res.status === 401) {
        showToast("API Key 无效，请在设置中更新");
      }
      throw new Error("API HTTP " + res.status);
    }
    const data = await res.json();
    const content = data.choices[0].message.content;
    const parsed = extractJson(content);
    if (!parsed) throw new Error("JSON提取失败");
    if (!parsed.amount || isNaN(parseFloat(parsed.amount))) throw new Error("Missing amount");
    if (!CATEGORIES.includes(parsed.category)) {
      parsed.category = classifyFromText(rawText, parsed.type || "expense");
    }
    return {
      amount: parseFloat(parsed.amount),
      type: parsed.type === "income" ? "income" : "expense",
      category: parsed.category || "其他",
      note: (parsed.note || "").substring(0, 50)
    };
  } catch (e) {
    console.warn("[AI解析失败，使用本地解析]", e.message);
    return fallbackParse(rawText);
  }
}

// --- AI 财务洞察 ---
async function generateInsights(bills) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: "no_key", message: "请先在设置中配置 DeepSeek API Key" };
  }
  if (!bills || bills.length < 3) {
    return { error: "insufficient_data", message: "账单数据不足（至少需要3条），先记几笔吧" };
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthBills = bills.filter(b => new Date(b.date) >= monthStart);

  let totalExpense = 0, totalIncome = 0;
  const catExpense = {};
  monthBills.forEach(b => {
    if (b.type === "expense") {
      totalExpense += b.amount;
      catExpense[b.category] = (catExpense[b.category] || 0) + b.amount;
    } else {
      totalIncome += b.amount;
    }
  });

  const catSummary = Object.entries(catExpense)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => cat + ": ¥" + amt.toFixed(0))
    .join(", ");

  const prompt = "用户本月财务数据：\n" +
    "总收入: ¥" + totalIncome.toFixed(0) + "\n" +
    "总支出: ¥" + totalExpense.toFixed(0) + "\n" +
    "支出分类: " + catSummary + "\n\n" +
    "请作为财务助手，用中文给出3条简短建议（每条不超过40字），帮助用户优化消费。语气友好、具体、可操作。直接输出建议，每条一行，格式如\"1. xxx\"。";

  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: "你是一个友好的个人财务助手。给出简短、实用、非评判性的消费建议。" },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 300
      })
    });
    if (!res.ok) throw new Error("API HTTP " + res.status);
    const data = await res.json();
    return { insights: data.choices[0].message.content };
  } catch (e) {
    return { error: "api_fail", message: "分析失败: " + e.message };
  }
}

// --- Toast 提示 ---
function showToast(msg, duration) {
  duration = duration || 2500;
  const t = document.createElement("div");
  t.textContent = msg;
  t.className = "toast-msg";
  document.body.appendChild(t);
  setTimeout(function () {
    t.style.opacity = "0";
    setTimeout(function () { t.remove(); }, 300);
  }, duration);
}

// --- 主题管理 ---
function initTheme() {
  var savedTheme = localStorage.getItem("theme");
  if (savedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  }
  var toggleBtn = document.getElementById("theme-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", toggleTheme);
  }
}

function toggleTheme() {
  var html = document.documentElement;
  var current = html.getAttribute("data-theme");
  var next = current === "dark" ? "" : "dark";
  html.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
}

// --- 设置页初始化 ---
function initSettings() {
  var input = document.getElementById("api-key-input");
  if (input) {
    var savedKey = getApiKey();
    if (savedKey) input.value = savedKey;
  }

  var saveBtn = document.getElementById("btn-save-api-key");
  if (saveBtn) {
    saveBtn.addEventListener("click", function () {
      var key = document.getElementById("api-key-input").value.trim();
      setApiKey(key);
      showToast(key ? "API Key 已保存" : "API Key 已清除");
    });
  }

  var themeBtn = document.getElementById("btn-toggle-theme");
  if (themeBtn) {
    themeBtn.addEventListener("click", toggleTheme);
  }
}

// --- AI 财务洞察 UI ---
function initAIInsights() {
  var btn = document.getElementById("btn-insights-refresh");
  var content = document.getElementById("insights-content");
  if (!btn || !content) return;

  btn.addEventListener("click", async function () {
    if (!hasApiKey()) {
      content.innerHTML = '<p class="insights-placeholder">请先在设置中配置 DeepSeek API Key</p>';
      return;
    }
    btn.disabled = true;
    btn.textContent = "分析中...";
    content.innerHTML = '<div style="display:flex;justify-content:center;padding:16px"><div class="ai-spinner" style="border:2px solid var(--border);border-top-color:var(--primary)"></div></div>';

    try {
      var bills = await getAllBills();
      var result = await generateInsights(bills);

      if (result.error) {
        content.innerHTML = '<p class="insights-placeholder">' + result.message + '</p>';
      } else {
        var lines = result.insights.split("\n").filter(function (l) { return l.trim(); });
        content.innerHTML = lines.map(function (l) {
          return '<div class="insight-item">' + l.replace(/^\d+\.\s*/, "") + '</div>';
        }).join("");
      }
    } catch (e) {
      content.innerHTML = '<p class="insights-placeholder">分析出错: ' + e.message + '</p>';
    }

    btn.disabled = false;
    btn.textContent = "刷新分析";
  });
}
