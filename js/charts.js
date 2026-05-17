let pieChart = null;
let trendChart = null;

function initCharts() {
  const pieCtx = document.getElementById('pieChart').getContext('2d');
  const trendCtx = document.getElementById('trendChart').getContext('2d');

  pieChart = new Chart(pieCtx, {
    type: 'doughnut',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { padding: 16, usePointStyle: true, pointStyleWidth: 8, font: { size: 12 } }
        }
      }
    }
  });

  trendChart = new Chart(trendCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: '收入',
          backgroundColor: '#4CAF84',
          borderRadius: 4,
          data: []
        },
        {
          label: '支出',
          backgroundColor: '#E06C6C',
          borderRadius: 4,
          data: []
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, pointStyleWidth: 8, font: { size: 12 }, padding: 16 }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { font: { size: 11 }, callback: v => '¥' + v } }
      }
    }
  });
}

function updateCharts(bills, period) {
  const now = new Date();
  const filtered = bills.filter(b => isInPeriod(b.date, period, now));

  // --- 饼图：支出分类占比 ---
  const expenses = filtered.filter(b => b.type === 'expense');
  const catMap = {};
  expenses.forEach(b => {
    catMap[b.category] = (catMap[b.category] || 0) + b.amount;
  });
  const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  pieChart.data.labels = catEntries.map(e => e[0]);
  pieChart.data.datasets[0].data = catEntries.map(e => e[1]);
  pieChart.data.datasets[0].backgroundColor = catEntries.map(e => CAT_COLORS[e[0]] || '#B0BEC5');
  pieChart.update();

  // --- 趋势图：按时间分组 ---
  const groups = groupBillsByPeriod(filtered, period, now);
  trendChart.data.labels = groups.labels;
  trendChart.data.datasets[0].data = groups.income;
  trendChart.data.datasets[1].data = groups.expense;
  trendChart.update();
}

function isInPeriod(dateStr, period, now) {
  const d = new Date(dateStr);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  switch (period) {
    case 'day':
      start.setDate(now.getDate());
      return d >= start;
    case 'week': {
      const dayOfWeek = now.getDay() || 7;
      start.setDate(now.getDate() - dayOfWeek + 1);
      return d >= start && d <= now;
    }
    case 'month':
      start.setDate(1);
      start.setMonth(now.getMonth());
      return d >= start;
    case 'year':
      start.setMonth(0, 1);
      return d >= start;
    default:
      return true;
  }
}

function groupBillsByPeriod(bills, period, now) {
  const labels = [];
  const income = [];
  const expense = [];

  if (period === 'day') {
    const hours = ['00:00','02:00','04:00','06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00','22:00'];
    hours.forEach((h, i) => {
      labels.push(h);
      const hourStart = i * 2;
      const hourEnd = hourStart + 2;
      let inc = 0, exp = 0;
      bills.forEach(b => {
        const d = new Date(b.date);
        if (d.toDateString() === now.toDateString() && d.getHours() >= hourStart && d.getHours() < hourEnd) {
          if (b.type === 'income') inc += b.amount;
          else exp += b.amount;
        }
      });
      income.push(inc);
      expense.push(exp);
    });
  } else if (period === 'week') {
    const dayNames = ['周一','周二','周三','周四','周五','周六','周日'];
    const dow = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - dow + 1);
    monday.setHours(0,0,0,0);

    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      labels.push(dayNames[i]);
      let inc = 0, exp = 0;
      bills.forEach(b => {
        if (new Date(b.date).toDateString() === day.toDateString()) {
          if (b.type === 'income') inc += b.amount;
          else exp += b.amount;
        }
      });
      income.push(inc);
      expense.push(exp);
    }
  } else if (period === 'month') {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const step = Math.ceil(daysInMonth / 15);
    for (let d = 1; d <= daysInMonth; d += step) {
      labels.push(d + '日');
      const dayStart = new Date(now.getFullYear(), now.getMonth(), d);
      const dayEnd = new Date(now.getFullYear(), now.getMonth(), d + step);
      let inc = 0, exp = 0;
      bills.forEach(b => {
        const bd = new Date(b.date);
        if (bd >= dayStart && bd < dayEnd) {
          if (b.type === 'income') inc += b.amount;
          else exp += b.amount;
        }
      });
      income.push(inc);
      expense.push(exp);
    }
  } else if (period === 'year') {
    const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    months.forEach((m, i) => {
      labels.push(m);
      let inc = 0, exp = 0;
      bills.forEach(b => {
        const d = new Date(b.date);
        if (d.getFullYear() === now.getFullYear() && d.getMonth() === i) {
          if (b.type === 'income') inc += b.amount;
          else exp += b.amount;
        }
      });
      income.push(inc);
      expense.push(exp);
    });
  }

  return { labels, income, expense };
}
