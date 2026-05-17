// --- 导入模块 ---
let parsedBills = [];

function initImport() {
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', handleFileSelect);
  document.getElementById('btn-import-confirm').addEventListener('click', confirmImport);
  document.getElementById('btn-import-cancel').addEventListener('click', closeImportModal);

  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) {
      if (document.getElementById('import-modal').style.display === 'block') {
        closeImportModal();
      }
    }
  });
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const ext = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();
  reader.onload = function(evt) {
    if (ext === 'xlsx') {
      parseExcel(evt.target.result, file.name);
    } else {
      parseCSV(evt.target.result, file.name);
    }
  };
  reader.onerror = function() {
    showImportError('文件读取失败，请重试。');
  };
  reader.readAsArrayBuffer(file);
}

// ===================== CSV 文本解析（多编码尝试） =====================

function parseCSV(buffer, fileName) {
  const bytes = new Uint8Array(buffer);

  // 依次尝试各编码，找到第一个包含中文关键词的
  const encodings = ['utf-8', 'gbk', 'gb2312', 'utf-16le', 'utf-16be'];
  let text = '';
  let usedEncoding = '';

  for (const enc of encodings) {
    try {
      const t = new TextDecoder(enc).decode(bytes);
      if (t.includes('交易') || t.includes('金额') || t.includes('收/支') || t.includes('收支')) {
        text = t;
        usedEncoding = enc;
        break;
      }
      // 如果都没匹配，保留最后一个解码结果
      if (!text) text = t;
    } catch (_) { /* skip unsupported encoding */ }
  }
  if (!usedEncoding) usedEncoding = encodings[0];

  // 统一换行符，去除 BOM
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  if (lines.length < 2) {
    showImportError(
      '文件中数据不足。<br>编码: ' + usedEncoding +
      '<br>文件预览: ' + escapeHtml(text.substring(0, 200))
    );
    return;
  }

  // 找表头行：包含"交易时间"或"金额"或"收/支"
  let headerLine = '';
  for (const line of lines) {
    if (line.includes(',') && (line.includes('交易时间') || line.includes('金额') || line.includes('收/支') || line.includes('收支'))) {
      headerLine = line;
      break;
    }
  }

  if (!headerLine) {
    showImportError(
      '文件中未找到包含"交易时间""金额""收/支"的表头行。<br>编码: ' + usedEncoding +
      '<br>文件前200字: ' + escapeHtml(text.substring(0, 200))
    );
    return;
  }

  const headers = splitCSVLine(headerLine);
  // 找表头在 lines 中的位置，数据从下一行开始
  let headerIdx = lines.indexOf(headerLine);
  if (headerIdx < 0) headerIdx = lines.findIndex(l => l === headerLine);

  // 解析数据行
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (cols.every(c => !c)) continue; // 跳过全空行
    if (cols.length < 2) continue;
    const row = {};
    headers.forEach((h, j) => { row[h] = (cols[j] || '').trim(); });
    rows.push(row);
  }

  if (rows.length === 0) {
    showImportError(
      '未解析到任何数据行。<br>编码: ' + usedEncoding +
      '<br>表头: ' + headers.join(', ').substring(0, 200) +
      '<br>总行数: ' + lines.length
    );
    return;
  }

  processRows(headers, rows, fileName);
}

function splitCSVLine(line) {
  const result = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

// ===================== Excel 解析（SheetJS） =====================

function parseExcel(buffer, fileName) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', codepage: 936 });
  } catch (_) {
    showImportError('Excel 文件解析失败。');
    return;
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rawRows.length < 2) {
    showImportError('文件中没有足够的数据。');
    return;
  }

  // 智能查找表头
  let headerIdx = -1;
  let headers = [];
  for (let i = 0; i < rawRows.length; i++) {
    const joined = rawRows[i].map(c => String(c || '')).join(',');
    if (joined.includes(',') && (joined.includes('交易时间') || joined.includes('金额') || joined.includes('收/支'))) {
      headers = rawRows[i].map(h => String(h || '').trim());
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    showImportError('Excel 中未找到表头行。');
    return;
  }

  const rows = [];
  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (row.every(c => String(c || '').trim() === '')) continue;
    const obj = {};
    headers.forEach((h, j) => { obj[h] = (row[j] !== undefined ? String(row[j]).trim() : ''); });
    rows.push(obj);
  }

  processRows(headers, rows, fileName);
}

// ===================== 通用处理 =====================

function processRows(headers, rows, fileName) {
  const format = detectFormat(headers);
  if (!format) {
    showImportError(
      '无法识别账单格式。<br><br>检测到的列名：<br>' +
      headers.map(h => h || '(空)').join('，')
    );
    return;
  }

  parsedBills = [];
  for (const row of rows) {
    const bill = mapToBill(row, headers);
    if (bill) parsedBills.push(bill);
  }

  if (parsedBills.length === 0) {
    showImportError('未能解析到有效账单。文件有 ' + rows.length + ' 行，列名: ' + headers.map(h => h || '(空)').join('，'));
    return;
  }

  const autoChannel = detectChannelFromFileName(fileName);
  showImportPreview(autoChannel);
}

function detectFormat(headers) {
  const h = headers.map(s => s.toLowerCase().trim());
  const joined = h.join(',');

  if (joined.includes('交易订单号') || joined.includes('商户单号') || joined.includes('商品说明')) return 'alipay';
  if (joined.includes('交易单号') || joined.includes('当前状态') || joined.includes('交易类型')) return 'wechat';
  if ((joined.includes('交易时间') || joined.includes('时间')) && joined.includes('金额') && (joined.includes('收/支') || joined.includes('收支'))) return 'generic';

  // 精确 key 匹配
  const m = {};
  headers.forEach(s => { m[s] = true; });
  if ((m['收/支'] || m['收支']) && (m['金额'] || m['金额(元)'] || m['金额（元）'])) return 'generic';

  return null;
}

function mapToBill(row) {
  const amountStr = findVal(row, ['金额(元)', '金额（元）', '金额', '交易金额']);
  let amount = parseFloat(String(amountStr).replace(/[¥￥,+\s]/g, ''));
  if (isNaN(amount) || amount <= 0) return null;

  const typeStr = findVal(row, ['收/支', '收支', '交易类型']);
  let type = 'expense';
  if (typeStr) {
    if (typeStr.includes('收入') || typeStr.includes('转入')) type = 'income';
    if (typeStr.includes('不计') || typeStr.includes('不收不付')) return null;
  }

  let date = '';
  const dateStr = findVal(row, ['交易时间', '时间', '交易日期', '日期']);
  if (dateStr) {
    const ds = String(dateStr).trim();
    let d = new Date(ds);
    // 直接 new Date 无效时尝试其他格式
    if (isNaN(d.getTime())) {
      // Excel 日期序列号（如 45678）
      const num = parseFloat(ds);
      if (!isNaN(num) && num > 30000 && num < 80000) {
        d = new Date((num - 25569) * 86400000);
      }
      // 中文日期：2026年5月12日
      if (isNaN(d.getTime())) {
        const m = ds.match(/(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})/);
        if (m) d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
      }
      // yyyyMMdd 纯数字：20260512
      if (isNaN(d.getTime())) {
        const m2 = ds.match(/^(\d{4})(\d{2})(\d{2})/);
        if (m2) d = new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]));
      }
    }
    if (!isNaN(d.getTime())) {
      date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
  }

  const statusStr = findVal(row, ['交易状态', '当前状态', '状态']);
  if (statusStr) {
    const s = String(statusStr).toLowerCase();
    if (/退款|失败|未完成|关闭|处理中|等待/.test(s)) return null;
  }

  // 提取交易对方和商品说明，用于关键词自动分类
  const counterparty = findVal(row, ['交易对方', '商户名称']) || '';
  const description  = findVal(row, ['商品说明', '商品']) || '';

  const noteParts = [];
  ['商品说明', '商品', '交易对方', '商户名称', '备注'].forEach(k => {
    const v = row[k];
    if (v && String(v).trim()) noteParts.push(String(v).trim());
  });
  const note = noteParts.join(' | ').substring(0, 100);

  // 根据关键词匹配分类
  const category = classifyBill(counterparty, description, type);

  const channelStr = findVal(row, ['收/付款方式', '支付方式', '交易方式']);
  let channel = 'other';
  if (channelStr) {
    const cl = String(channelStr).toLowerCase();
    if (/余额|花呗|支付宝/.test(cl)) channel = 'alipay';
    else if (/微信|零钱/.test(cl)) channel = 'wechat';
    else if (/云闪付/.test(cl)) channel = 'unionpay';
  }

  return { amount, type, channel, category, note, date, pinned: false };
}

function findVal(row, keys) {
  let fallback = '';
  for (const k of keys) {
    if (row[k] !== undefined) {
      const v = String(row[k]).trim();
      if (v) return v;
      if (!fallback) fallback = v;
    }
  }
  for (const rk of Object.keys(row)) {
    for (const k of keys) {
      if (rk.includes(k) || k.includes(rk)) {
        const v = String(row[rk]).trim();
        if (v) return v;
        if (!fallback) fallback = v;
      }
    }
  }
  return fallback;
}

function detectChannelFromFileName(name) {
  const l = name.toLowerCase();
  if (/alipay|支付宝|zhifubao/.test(l)) return 'alipay';
  if (/wechat|微信|weixin/.test(l)) return 'wechat';
  if (/unionpay|云闪付|yunshanfu/.test(l)) return 'unionpay';
  return null;
}

// ===================== UI =====================

function showImportPreview(autoChannel) {
  if (autoChannel) parsedBills.forEach(b => { b.channel = autoChannel; });

  document.getElementById('import-info').innerHTML =
    `识别到 <b>${parsedBills.length}</b> 条账单` +
    (autoChannel ? `，渠道: <b>${channelLabel(autoChannel)}</b>` : '');

  document.querySelector('#import-table thead').innerHTML = `
    <tr><th class="col-check">✓</th><th>类型</th><th class="col-amount">金额</th><th class="col-date">日期</th><th class="col-channel">渠道</th><th>分类</th><th class="col-note">备注</th></tr>`;

  document.querySelector('#import-table tbody').innerHTML = parsedBills.map((b, i) => `
    <tr data-index="${i}">
      <td class="col-check"><input type="checkbox" class="import-check" checked data-index="${i}"></td>
      <td><span class="import-badge ${b.type}">${b.type === 'income' ? '收入' : '支出'}</span></td>
      <td class="col-amount" style="color:${b.type === 'income' ? 'var(--income)' : 'var(--expense)'}">¥${b.amount.toFixed(2)}</td>
      <td class="col-date">${b.date || '—'}</td>
      <td class="col-channel">${channelLabel(b.channel)}</td>
      <td>${CAT_ICONS[b.category] || '📌'} ${b.category}</td>
      <td class="col-note" title="${escapeHtml(b.note || '')}">${b.note || '—'}</td>
    </tr>`).join('');

  document.querySelectorAll('#import-table .import-check').forEach(cb => {
    cb.addEventListener('change', function() { this.closest('tr').classList.toggle('excluded', !this.checked); });
  });

  document.getElementById('modal-overlay').classList.add('show');
  document.getElementById('edit-modal').style.display = 'none';
  document.getElementById('budget-modal').style.display = 'none';
  document.getElementById('import-modal').style.display = 'block';
  document.getElementById('btn-import-confirm').textContent = `确认导入 (${parsedBills.length} 条)`;
  document.getElementById('btn-import-confirm').disabled = false;
}

function confirmImport() {
  if (parsedBills.length === 0) { alert('没有可导入的账单。'); return; }

  const cbs = document.querySelectorAll('#import-table .import-check');
  let toImport = [...parsedBills];
  if (cbs.length > 0) {
    const checked = [];
    cbs.forEach(cb => { if (cb.checked) { const b = parsedBills[Number(cb.dataset.index)]; if (b) checked.push(b); } });
    if (checked.length > 0) toImport = checked;
  }

  const btn = document.getElementById('btn-import-confirm');
  btn.disabled = true;
  btn.textContent = '导入中...';

  let done = 0;
  (function next() {
    if (done >= toImport.length) {
      closeImportModal();
      btn.disabled = false;
      btn.textContent = '确认导入';
      alert(`成功导入 ${toImport.length} 条账单！`);
      refreshAll();
      return;
    }
    addBill(toImport[done]).then(() => { done++; next(); });
  })();
}

function closeImportModal() {
  document.getElementById('modal-overlay').classList.remove('show');
  parsedBills = [];
}

function showImportError(msg) {
  document.getElementById('import-info').innerHTML = '';
  document.querySelector('#import-table thead').innerHTML = '';
  document.querySelector('#import-table tbody').innerHTML = `<tr><td colspan="7" class="import-error">${msg}</td></tr>`;
  document.getElementById('modal-overlay').classList.add('show');
  document.getElementById('edit-modal').style.display = 'none';
  document.getElementById('budget-modal').style.display = 'none';
  document.getElementById('import-modal').style.display = 'block';
  document.getElementById('btn-import-confirm').textContent = '确认导入 (0 条)';
  document.getElementById('btn-import-confirm').disabled = true;
}

function channelLabel(ch) {
  const m = { alipay: '支付宝', wechat: '微信', unionpay: '云闪付', other: '其他' };
  return m[ch] || '其他';
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
