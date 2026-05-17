function initSearch() {
  document.getElementById('btn-search').addEventListener('click', performSearch);
  document.getElementById('btn-reset-search').addEventListener('click', resetSearch);

  // 回车触发搜索
  document.getElementById('search-keyword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
  });
}

function performSearch() {
  const keyword = document.getElementById('search-keyword').value.trim().toLowerCase();
  const minStr = document.getElementById('search-min').value.trim();
  const maxStr = document.getElementById('search-max').value.trim();
  const min = minStr ? parseFloat(minStr) : null;
  const max = maxStr ? parseFloat(maxStr) : null;

  getAllBills().then(bills => {
    let results = bills;

    if (keyword) {
      results = results.filter(b =>
        b.category.toLowerCase().includes(keyword) ||
        (b.note && b.note.toLowerCase().includes(keyword)) ||
        channelName(b.channel).includes(keyword)
      );
    }

    if (min !== null && !isNaN(min)) {
      results = results.filter(b => b.amount >= min);
    }
    if (max !== null && !isNaN(max)) {
      results = results.filter(b => b.amount <= max);
    }

    const container = document.getElementById('search-results');
    if (results.length === 0) {
      container.innerHTML = '<div class="empty-state">没有找到匹配的账单</div>';
    } else {
      renderBillList(results, 'search-results', true);
      container.querySelector('.bills-header')?.remove();
      const countEl = document.createElement('div');
      countEl.className = 'bills-header';
      countEl.innerHTML = `<span style="font-size:14px;color:var(--text-light)">找到 ${results.length} 条账单</span>`;
      container.prepend(countEl);
    }
  });
}

function resetSearch() {
  document.getElementById('search-keyword').value = '';
  document.getElementById('search-min').value = '';
  document.getElementById('search-max').value = '';
  document.getElementById('search-results').innerHTML = '<div class="empty-state">输入关键词或金额区间开始搜索</div>';
}

function channelName(ch) {
  const map = { alipay: '支付宝', wechat: '微信', unionpay: '云闪付', other: '其他' };
  return map[ch] || ch;
}
