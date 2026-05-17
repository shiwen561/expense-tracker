const DB_NAME = 'ExpenseTrackerDB';
const DB_VERSION = 2;
let db = null;

// ===== 分类注册表（唯一数据源） =====
const CATEGORY_META = [
  { value: '餐饮',   icon: '🍽️', color: '#5BAA8E' },
  { value: '交通',   icon: '🚗', color: '#A8D8CA' },
  { value: '购物',   icon: '🛒', color: '#C5E4F0' },
  { value: '工资',   icon: '💰', color: '#F0A04B' },
  { value: '娱乐',   icon: '🎮', color: '#E06C6C' },
  { value: '居住',   icon: '🏠', color: '#7FB5B5' },
  { value: '数字服务', icon: '💻', color: '#9B59B6' },
  { value: '医疗',   icon: '💊', color: '#C4A882' },
  { value: '人情往来', icon: '🎁', color: '#E67E22' },
  { value: '其他',   icon: '📌', color: '#B0BEC5' },
];

const CAT_ICONS = Object.fromEntries(CATEGORY_META.map(c => [c.value, c.icon]));
const CAT_COLORS = Object.fromEntries(CATEGORY_META.map(c => [c.value, c.color]));
const CATEGORIES = CATEGORY_META.map(c => c.value);

// ===== 关键词 → 分类映射表 =====
const CATEGORY_KEYWORDS = {
  '餐饮': [
    '餐厅', '饭店', '外卖', '美团', '饿了么', '快餐', '火锅', '烧烤', '小吃',
    '食堂', '食品', '咖啡', '奶茶', '饮料', '面包', '蛋糕', '早餐', '午餐',
    '晚餐', '自助', '肯德基', '麦当劳', '星巴克', '海底捞', '必胜客', '盒马',
    '买菜', '水果', '零食', '糕点', '卤味', '熟食', '便当', '料理', '日料',
    '韩式', '炸鸡', '披萨', '面条', '米粉', '饺子', '馄饨', '包子', '馒头',
    '蜜雪冰城', '茶百道', '喜茶', '奈雪', '瑞幸', '库迪', 'coco', '一点点',
    '汉堡', '寿司', '刺身', '鳗鱼', '咖喱', '拉面', '牛肉面', '凉皮', '肉夹馍',
  ],
  '交通': [
    '滴滴', '出租车', '的士', '公交', '地铁', '高铁', '火车', '飞机', '航班',
    '加油', '加油站', '中石化', '中石油', '停车', '高速', 'etc', 'ETC',
    '共享单车', '单车', '哈啰', '摩拜', '曹操出行', 'T3出行', '如祺出行',
    '神州专车', '首汽', '花小猪', '顺风车', '骑行', '打车', '叫车',
    '12306', '机票', '火车票', '汽车票', '导航', '充电', '充电桩',
  ],
  '购物': [
    '淘宝', '天猫', '京东', '拼多多', '唯品会', '抖音商城', '得物', '当当',
    '超市', '百货', '商场', '优衣库', '耐克', '阿迪', '便利店', '日用品',
    '服装', '电器', '数码', '电子产品', '小米', '华为商城', '苏宁', '国美',
    '山姆', 'costco', '开市客', '屈臣氏', '名创', '无印良品', '宜家',
    '沃尔玛', '家乐福', '永辉', '大润发', '物美', '联华', '华润万家',
  ],
  '娱乐': [
    '电影', 'ktv', '游戏', '腾讯游戏', '爱奇艺', '优酷', 'bilibili', 'b站',
    '视频会员', '音乐', '网易云', 'qq音乐', '旅游', '景区', '门票', '演出',
    '演唱会', '剧本杀', '密室', '桌游', '网吧', '游乐场', '迪士尼', '环球',
    '露营', '民宿', '酒店', '游泳', '健身', 'keep', '运动', 'spa', '按摩',
  ],
  '居住': [
    '房租', '物业', '水电', '燃气', '燃气费', '水费', '电费', '宽带',
    '移动', '联通', '电信', '话费', '供暖', '暖气', '维修', '装修',
    '家具', '房产', '链家', '自如', '贝壳', '按揭', '还贷',
    '公积金', '有线电视', '网费', '固话',
  ],
  '医疗': [
    '医院', '挂号', '药', '诊所', '体检', '牙科', '眼科', '疫苗',
    '医保', '药店', '大药房', '住院', '门诊', '手术', '检查', '化验',
    '中药', '西药', '处方',
  ],
  '工资': [
    '工资', '薪资', '薪酬', '奖金', '报销', '提成', '劳务', '稿费',
    '理财', '分红', '利息', '收益', '入账', '退税', '退款', '补贴',
    '津贴', '补助', '兼职',
  ],
  '数字服务': [
    '服务器', '阿里云', '腾讯云', '华为云', 'aws', 'azure', '域名',
    'api', 'cdn', '数据库', '订阅', '会员', 'github', 'gitlab',
    'notion', 'office365', 'microsoft', 'apple', 'google', 'icloud',
    '云服务', '域名注册', 'vpn', '软件', '许可证', 'license', 'vps',
    '主机', '开发工具', 'cursor', 'jetbrains', 'figma',
    'canva', 'adobe', 'photoshop', 'illustrator', 'midjourney',
    'chatgpt', 'openai', 'claude', 'copilot', 'poe', 'kimi',
    'ssl', 'ssl证书', '域名续费', '云存储', '对象存储', 'cdn加速',
    'saas', 'paas', 'iaas',
  ],
  '人情往来': [
    '红包', '转账', '人情', '礼金', '份子', '结婚', '满月', '乔迁',
    '压岁钱', '孝敬', '赡养', '亲友转账', '转给', 'aa收款', '聚餐aa',
    '代付', '请客', '借款', '还款', '借出', '家人转账', '零钱通转出',
    '转账给妈妈', '转账给爸爸', '转账给父母', '转账给朋友', '生日红包',
    '过节红包', '节日红包', '压岁', '份子钱', '贺礼', '白事', '慰问',
  ],
};

function classifyBill(counterparty, description, type) {
  const text = (counterparty + ' ' + description).toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        return cat;
      }
    }
  }
  return type === 'income' ? '工资' : '其他';
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('bills')) {
        const billStore = database.createObjectStore('bills', { keyPath: 'id', autoIncrement: true });
        billStore.createIndex('date', 'date', { unique: false });
        billStore.createIndex('type', 'type', { unique: false });
        billStore.createIndex('category', 'category', { unique: false });
        billStore.createIndex('pinned', 'pinned', { unique: false });
      }
      if (!database.objectStoreNames.contains('budget')) {
        database.createObjectStore('budget', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

// --- 账单 CRUD ---

function addBill(bill) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bills', 'readwrite');
    const store = tx.objectStore('bills');
    const record = {
      ...bill,
      pinned: bill.pinned || false,
      createdAt: Date.now()
    };
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllBills() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bills', 'readonly');
    const store = tx.objectStore('bills');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getBillById(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bills', 'readonly');
    const store = tx.objectStore('bills');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function updateBill(id, data) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bills', 'readwrite');
    const store = tx.objectStore('bills');
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const bill = getReq.result;
      if (!bill) return reject(new Error('账单不存在'));
      Object.assign(bill, data);
      const putReq = store.put(bill);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

function deleteBill(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('bills', 'readwrite');
    const store = tx.objectStore('bills');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function togglePin(id, pinned) {
  return updateBill(id, { pinned });
}

// --- 预算 ---

function getBudget(month) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('budget', 'readonly');
    const store = tx.objectStore('budget');
    const req = store.getAll();
    req.onsuccess = () => {
      const budgets = req.result;
      const found = budgets.find(b => b.month === month);
      resolve(found || null);
    };
    req.onerror = () => reject(req.error);
  });
}

function setBudget(month, limit) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('budget', 'readwrite');
    const store = tx.objectStore('budget');
    const req = store.getAll();
    req.onsuccess = () => {
      const budgets = req.result;
      const existing = budgets.find(b => b.month === month);
      if (existing) {
        existing.limit = limit;
        store.put(existing).onsuccess = () => resolve();
      } else {
        store.add({ month, limit, createdAt: Date.now() }).onsuccess = () => resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}
