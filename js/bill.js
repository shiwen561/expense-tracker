// --- 记账表单 ---
let selectedType = 'expense';
let selectedChannel = 'alipay';
let selectedCategory = '餐饮';

function initBillForm() {
  const form = document.getElementById('bill-form');

  // 收支类型切换
  form.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      form.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.dataset.type;
    });
  });

  // Chip 选择（支付渠道 / 分类标签）
  form.querySelectorAll('.chip-group').forEach(group => {
    group.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        if (group.id === 'channel-group') selectedChannel = chip.dataset.value;
        else selectedCategory = chip.dataset.value;
      });
    });
    // 默认选中第一个
    const first = group.querySelector('.chip');
    if (first) first.classList.add('active');
  });

  // 设置默认日期为今天
  document.getElementById('date').value = new Date().toISOString().split('T')[0];

  // 提交
  form.addEventListener('submit', handleBillSubmit);
  document.getElementById('btn-cancel-edit').addEventListener('click', cancelEdit);
}

function handleBillSubmit(e) {
  e.preventDefault();

  const amount = parseFloat(document.getElementById('amount').value);
  if (!amount || amount <= 0) {
    alert('请输入有效金额');
    return;
  }

  const date = document.getElementById('date').value;
  const note = document.getElementById('note').value.trim();
  const editId = document.getElementById('edit-id').value;

  const billData = {
    amount,
    type: selectedType,
    channel: selectedChannel,
    category: selectedCategory,
    note,
    date
  };

  if (editId) {
    updateBill(Number(editId), billData).then(() => {
      resetBillForm();
      refreshAll();
    });
  } else {
    addBill(billData).then(() => {
      resetBillForm();
      refreshAll();
    });
  }
}

function resetBillForm() {
  document.getElementById('bill-form').reset();
  document.getElementById('date').value = new Date().toISOString().split('T')[0];
  document.getElementById('edit-id').value = '';
  document.getElementById('btn-submit').textContent = '记一笔';
  document.getElementById('btn-cancel-edit').style.display = 'none';

  // 重置类型
  document.querySelectorAll('#bill-form .type-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('#bill-form .type-btn[data-type="expense"]').classList.add('active');
  selectedType = 'expense';

  // 重置 chips
  document.querySelectorAll('#bill-form .chip-group').forEach(group => {
    group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    const first = group.querySelector('.chip');
    if (first) first.classList.add('active');
  });
  selectedChannel = 'alipay';
  selectedCategory = '餐饮';
}

function cancelEdit() { resetBillForm(); }

function fillEditForm(bill) {
  // 切换到记账页
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.nav-btn[data-page="add"]').classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-add').classList.add('active');

  document.getElementById('amount').value = bill.amount;
  document.getElementById('date').value = bill.date.split('T')[0];
  document.getElementById('note').value = bill.note || '';
  document.getElementById('edit-id').value = bill.id;
  document.getElementById('btn-submit').textContent = '保存修改';
  document.getElementById('btn-cancel-edit').style.display = 'block';

  // 设置类型
  document.querySelectorAll('#bill-form .type-btn').forEach(b => b.classList.remove('active'));
  const typeBtn = document.querySelector(`#bill-form .type-btn[data-type="${bill.type}"]`);
  if (typeBtn) typeBtn.classList.add('active');
  selectedType = bill.type;

  // 设置渠道
  document.querySelectorAll('#channel-group .chip').forEach(c => c.classList.remove('active'));
  const channelChip = document.querySelector(`#channel-group .chip[data-value="${bill.channel}"]`);
  if (channelChip) channelChip.classList.add('active');
  selectedChannel = bill.channel;

  // 设置分类
  document.querySelectorAll('#category-group .chip').forEach(c => c.classList.remove('active'));
  const catChip = document.querySelector(`#category-group .chip[data-value="${bill.category}"]`);
  if (catChip) catChip.classList.add('active');
  selectedCategory = bill.category;

  window.scrollTo(0, 0);
}

// --- 编辑弹窗（从账单列表打开） ---

function initEditModal() {
  const overlay = document.getElementById('modal-overlay');

  // 编辑弹窗的类型切换
  document.querySelectorAll('#edit-type-group .type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#edit-type-group .type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // 编辑弹窗的 chip 组
  document.querySelectorAll('#edit-channel-group .chip, #edit-category-group .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const group = chip.parentElement;
      group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  document.getElementById('edit-form').addEventListener('submit', handleEditSubmit);
  document.getElementById('btn-modal-cancel').addEventListener('click', closeEditModal);

  // 预算弹窗
  document.getElementById('btn-set-budget').addEventListener('click', openBudgetModal);
  document.getElementById('budget-form').addEventListener('submit', handleBudgetSubmit);
  document.getElementById('btn-budget-cancel').addEventListener('click', closeBudgetModal);

  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeAllModals();
  });
}

function openEditModal(bill) {
  document.getElementById('edit-bill-id').value = bill.id;
  document.getElementById('edit-amount').value = bill.amount;
  document.getElementById('edit-date').value = bill.date.split('T')[0];
  document.getElementById('edit-note').value = bill.note || '';

  // 类型
  document.querySelectorAll('#edit-type-group .type-btn').forEach(b => b.classList.remove('active'));
  const typeBtn = document.querySelector(`#edit-type-group .type-btn[data-type="${bill.type}"]`);
  if (typeBtn) typeBtn.classList.add('active');

  // 渠道
  document.querySelectorAll('#edit-channel-group .chip').forEach(c => c.classList.remove('active'));
  const chChip = document.querySelector(`#edit-channel-group .chip[data-value="${bill.channel}"]`);
  if (chChip) chChip.classList.add('active');

  // 分类
  document.querySelectorAll('#edit-category-group .chip').forEach(c => c.classList.remove('active'));
  const catChip = document.querySelector(`#edit-category-group .chip[data-value="${bill.category}"]`);
  if (catChip) catChip.classList.add('active');

  document.getElementById('modal-overlay').classList.add('show');
  document.getElementById('budget-modal').style.display = 'none';
  document.getElementById('edit-modal').style.display = 'block';
}

function closeEditModal() {
  document.getElementById('modal-overlay').classList.remove('show');
}

function handleEditSubmit(e) {
  e.preventDefault();
  const id = Number(document.getElementById('edit-bill-id').value);
  const amount = parseFloat(document.getElementById('edit-amount').value);
  if (!amount || amount <= 0) { alert('请输入有效金额'); return; }

  const typeBtn = document.querySelector('#edit-type-group .type-btn.active');
  const channelBtn = document.querySelector('#edit-channel-group .chip.active');
  const catBtn = document.querySelector('#edit-category-group .chip.active');

  const data = {
    amount,
    type: typeBtn ? typeBtn.dataset.type : 'expense',
    channel: channelBtn ? channelBtn.dataset.value : 'alipay',
    category: catBtn ? catBtn.dataset.value : '其他',
    note: document.getElementById('edit-note').value.trim(),
    date: document.getElementById('edit-date').value
  };

  updateBill(id, data).then(() => {
    closeAllModals();
    refreshAll();
  });
}

// --- 预算弹窗 ---

function openBudgetModal() {
  const month = getCurrentMonth();
  getBudget(month).then(b => {
    if (b) document.getElementById('budget-limit').value = b.limit;
    document.getElementById('modal-overlay').classList.add('show');
    document.getElementById('edit-modal').style.display = 'none';
    document.getElementById('budget-modal').style.display = 'block';
  });
}

function closeBudgetModal() { closeAllModals(); }

function handleBudgetSubmit(e) {
  e.preventDefault();
  const limit = parseFloat(document.getElementById('budget-limit').value);
  if (isNaN(limit) || limit < 0) { alert('请输入有效预算金额'); return; }
  const month = getCurrentMonth();
  setBudget(month, limit).then(() => {
    closeAllModals();
    refreshAll();
  });
}

function closeAllModals() {
  document.getElementById('modal-overlay').classList.remove('show');
}

// --- 账单列表渲染 ---

function renderBillList(bills, containerId, showActions = true) {
  const container = document.getElementById(containerId);
  if (!bills || bills.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无账单</div>';
    return;
  }

  // 排序：置顶优先，然后按日期降序
  const sorted = [...bills].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return new Date(b.date) - new Date(a.date);
  });

  const channelNames = { alipay: '支付宝', wechat: '微信', unionpay: '云闪付', other: '其他' };
  // catIcons replaced by global CAT_ICONS from db.js

  container.innerHTML = sorted.map(b => {
    const dateStr = new Date(b.date).toLocaleDateString('zh-CN');
    const sign = b.type === 'income' ? '+' : '-';
    const typeClass = b.type;
    const actionsHtml = showActions ? `
      <div class="bill-actions">
        <button class="bill-action-btn" data-action="pin" data-id="${b.id}" title="置顶">📌</button>
        <button class="bill-action-btn" data-action="edit" data-id="${b.id}" title="编辑">✏️</button>
        <button class="bill-action-btn" data-action="delete" data-id="${b.id}" title="删除">🗑️</button>
      </div>` : '';

    return `
      <div class="bill-card ${b.pinned ? 'pinned' : ''}" data-id="${b.id}">
        ${b.pinned ? '<span class="bill-pin-badge">📌 已置顶</span>' : ''}
        <div class="bill-icon ${typeClass}">${CAT_ICONS[b.category] || '📌'}</div>
        <div class="bill-info">
          <div class="bill-category">${b.category}</div>
          <div class="bill-meta">
            <span>${channelNames[b.channel]}</span>
            <span>${dateStr}</span>
          </div>
          ${b.note ? `<div class="bill-note">${b.note}</div>` : ''}
        </div>
        <div class="bill-amount ${typeClass}">${sign}¥${b.amount.toFixed(2)}</div>
        ${actionsHtml}
      </div>`;
  }).join('');

  // 事件委托
  if (showActions) {
    container.querySelectorAll('.bill-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.id);
        const action = btn.dataset.action;
        if (action === 'pin') handlePin(id);
        else if (action === 'edit') handleEditFromList(id);
        else if (action === 'delete') handleDelete(id);
      });
    });
  }
}

function handlePin(id) {
  getBillById(id).then(bill => {
    togglePin(id, !bill.pinned).then(() => refreshAll());
  });
}

function handleEditFromList(id) {
  getBillById(id).then(bill => openEditModal(bill));
}

function handleDelete(id) {
  // 简单确认
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay show';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <p>确定要删除这条账单吗？<br>删除后无法恢复。</p>
      <div class="confirm-actions">
        <button class="confirm-no">取消</button>
        <button class="confirm-yes">删除</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('.confirm-no').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.confirm-yes').addEventListener('click', () => {
    overlay.remove();
    deleteBill(id).then(() => refreshAll());
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}
