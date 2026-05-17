let currentPeriod = 'month';

// --- 初始化 ---

async function init() {
  await openDB();

  // 底部导航
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.page));
  });

  // 时间维度切换
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      refreshDashboard();
    });
  });

  // 初始化各模块
  initCharts();
  initBillForm();
  initEditModal();
  initSearch();
  initImport();

  // 首次刷新
  refreshAll();
}

// --- 页面切换 ---

function switchTab(pageName) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  const pageMap = {
    dashboard: 'page-dashboard',
    add: 'page-add',
    bills: 'page-bills',
    search: 'page-search'
  };

  const pageId = pageMap[pageName];
  document.getElementById(pageId).classList.add('active');

  const navBtn = document.querySelector(`.nav-btn[data-page="${pageName}"]`);
  if (navBtn) navBtn.classList.add('active');

  // 切到账单页时刷新列表
  if (pageName === 'bills') refreshBillList();
  if (pageName === 'dashboard') refreshDashboard();
}

// --- 全局刷新 ---

function refreshAll() {
  refreshDashboard();
  refreshBillList();
}

function refreshDashboard() {
  getAllBills().then(bills => {
    updateSummary(bills);
    updateBudgetBar(bills);
    updateCharts(bills, currentPeriod);
  });
}

function refreshBillList() {
  getAllBills().then(bills => {
    const countEl = document.getElementById('bills-count');
    countEl.textContent = `共 ${bills.length} 条`;
    renderBillList(bills, 'bills-list', true);
  });
}

// --- 汇总计算 ---

function updateSummary(bills) {
  const now = new Date();
  const filtered = bills.filter(b => isInPeriod(b.date, currentPeriod, now));

  let totalIncome = 0, totalExpense = 0;
  filtered.forEach(b => {
    if (b.type === 'income') totalIncome += b.amount;
    else totalExpense += b.amount;
  });

  document.getElementById('total-income').textContent = '¥' + totalIncome.toFixed(2);
  document.getElementById('total-expense').textContent = '¥' + totalExpense.toFixed(2);
  const balance = totalIncome - totalExpense;
  const balanceEl = document.getElementById('total-balance');
  balanceEl.textContent = (balance >= 0 ? '¥' : '-¥') + Math.abs(balance).toFixed(2);
  balanceEl.style.color = balance >= 0 ? 'var(--income)' : 'var(--expense)';
}

// --- 预算进度条 ---

function updateBudgetBar(bills) {
  const month = getCurrentMonth();
  const now = new Date();

  getBudget(month).then(budget => {
    const textEl = document.getElementById('budget-text');
    const progressEl = document.getElementById('budget-progress');

    // 计算当月总支出
    const monthExpense = bills
      .filter(b => b.type === 'expense' && isInPeriod(b.date, 'month', now))
      .reduce((sum, b) => sum + b.amount, 0);

    if (!budget || budget.limit <= 0) {
      textEl.textContent = '未设置';
      progressEl.style.width = '0%';
      progressEl.classList.remove('warning', 'danger');
      return;
    }

    const pct = Math.min((monthExpense / budget.limit) * 100, 100);
    progressEl.style.width = pct + '%';
    progressEl.classList.remove('warning', 'danger');

    if (pct >= 100) {
      progressEl.classList.add('danger');
      textEl.textContent = `¥${monthExpense.toFixed(2)} / ¥${budget.limit.toFixed(2)} ⚠️ 已超出`;
    } else if (pct >= 80) {
      progressEl.classList.add('warning');
      textEl.textContent = `¥${monthExpense.toFixed(2)} / ¥${budget.limit.toFixed(2)}`;
    } else {
      textEl.textContent = `¥${monthExpense.toFixed(2)} / ¥${budget.limit.toFixed(2)}`;
    }
  });
}

// --- 工具函数 ---

function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// --- 启动 ---
document.addEventListener('DOMContentLoaded', init);
