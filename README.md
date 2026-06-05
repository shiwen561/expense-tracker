# 💰 个人记账助手 (Expense Tracker)

一个纯前端的个人财务记账应用，支持手动录入、AI 智能识别、批量导入三种记账方式，并配有 Android 原生自动记账能力。

## ✨ 核心功能

### 三种记账方式
- **✍️ 手动录入** — 完整表单，选择类型/金额/日期/支付渠道/分类/备注
- **🤖 AI 智能录入** — 粘贴支付通知文本，DeepSeek API 自动解析出金额、分类、备注
- **📥 批量导入** — 支持微信/支付宝导出的 CSV 和 Excel 文件，自动识别编码和格式

### 数据分析
- **摘要卡片** — 总收入 / 总支出 / 结余，支持日/周/月/年切换
- **分类饼图** — 支出分类占比一目了然
- **趋势柱状图** — 收支变化趋势可视化
- **预算进度条** — 月度预算跟踪，超支预警

### AI 能力
- **文本解析** — 从自然语言中提取账单信息（无 API 时自动降级为本地正则匹配）
- **财务洞察** — 基于当月数据生成个性化节约建议

### Android 自动记账
- **通知监听** — 自动捕获微信/支付宝支付通知
- **OCR 识别** — Google ML Kit 识别通知图片中的中文文本
- **无障碍服务** — 完全零触碰的自动记账体验

### 其他
- 🔍 关键词搜索 + 金额范围筛选
- 🌙 深色/浅色主题切换
- 📌 账单置顶功能
- 📱 响应式设计，适配移动端

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML5 + CSS3 + Vanilla JavaScript (ES6) |
| 数据库 | IndexedDB（浏览器本地存储） |
| 图表 | Chart.js |
| 表格解析 | SheetJS (xlsx) |
| AI | DeepSeek Chat API |
| Android | 原生 Java + WebView + ML Kit OCR |

## 🚀 快速开始

### Web 端
直接用浏览器打开 `index.html` 即可使用，无需安装任何依赖。

### Android 端
用 Android Studio 打开 `android-app/` 目录，构建并安装 APK。
或下载 [Nightly Build](https://github.com/shiwen561/expense-tracker/releases) 直接安装。

### AI 功能配置
在应用「设置」页面填入 DeepSeek API Key 即可启用 AI 智能录入和财务洞察功能。

## 📂 项目结构

```
expense-tracker/
├── index.html              # 主应用入口
├── css/style.css           # 样式（含深色主题）
├── js/
│   ├── db.js               # IndexedDB 数据库层 + 分类系统
│   ├── app.js              # 导航、仪表盘、统计计算
│   ├── bill.js             # 账单表单、列表渲染、CRUD
│   ├── charts.js           # Chart.js 图表逻辑
│   ├── search.js           # 搜索与筛选
│   ├── import.js           # CSV/Excel 导入解析
│   ├── ai.js               # DeepSeek API 集成
│   ├── sync.js             # Android 通知同步
│   └── lib/                # 第三方库
├── android-app/            # Android 原生壳
│   └── app/src/main/java/  # MainActivity + 通知/无障碍服务
└── .github/workflows/      # CI/CD 自动构建 APK
```

## 📝 License

MIT
