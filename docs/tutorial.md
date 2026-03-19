# OneKey QA-AGENTS 使用教程

## 快速开始

```bash
# 1. 启动测试执行面板
npx tsx src/dashboard/server.ts
# 打开 http://localhost:5050 → 选平台 → 勾选用例 → 开始执行

# 2. 或直接 CLI 执行
node src/tests/desktop/market/search.test.mjs                    # 跑全部
node src/tests/desktop/market/search.test.mjs MARKET-SEARCH-002  # 跑单个
```

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────┐
│                 Dashboard (5050)                 │
│   桌面端 (26) │ Web端 (8) │ 插件端 (5)          │
└─────────┬───────────┬──────────────┬────────────┘
          │           │              │
     CDP 9222    CDP 9223       CDP 9224
     OneKey      Chrome         Chrome+Extension
     Electron    onekeytest.com  jnmbo...hlhcj
```

**三层 Agent 架构：**
- **决策层** `/onekey-qa-director` — 唯一入口，总协调
- **智能层** `/onekey-test-designer` → `/onekey-knowledge-builder` → `/onekey-qa-manager`
- **执行层** `/onekey-runner` · `/onekey-recorder` · `/onekey-reporter`

---

## 2. 环境配置

### 2.1 必须的软件

| 软件 | 用途 | 路径/端口 |
|------|------|-----------|
| OneKey Desktop | 桌面端测试 | `/Applications/OneKey-3.localized/OneKey.app/Contents/MacOS/OneKey` |
| Google Chrome | Web/插件端 | `/Applications/Google Chrome.app/` |
| Node.js 20+ | 运行测试 | `node` |
| playwright-core | CDP 连接 | `npm install` |

### 2.2 CDP 端口分配

| 平台 | 端口 | 启动方式 |
|------|------|----------|
| 桌面端 | 9222 | 自动启动 OneKey |
| Web 端 | 9223 | 自动启动 Chrome（复制用户 profile） |
| 插件端 | 9224 | 自动启动 Chrome（复制完整 Chrome 数据目录） |
| Dashboard | 5050 | `npx tsx src/dashboard/server.ts` |

### 2.3 环境变量（可选）

```bash
CDP_URL=http://127.0.0.1:9222        # 桌面端 CDP
WEB_CDP_URL=http://127.0.0.1:9223    # Web 端 CDP
EXT_CDP_URL=http://127.0.0.1:9224    # 插件端 CDP
ONEKEY_EXT_ID=jnmbo...hlhcj          # 插件 ID（默认自动检测）
ONEKEY_EXT_PATH=/path/to/extension   # 插件路径（默认自动检测）
WALLET_PASSWORD=1234567890-=          # 钱包密码
```

---

## 3. 三种执行方式

### 方式一：Dashboard 执行面板（推荐）

```bash
npx tsx src/dashboard/server.ts
```

打开 `http://localhost:5050`：
1. 顶部切换平台：**桌面端** / **Web端** / **插件端**
2. 左侧勾选要执行的用例
3. 点击 **▶ 开始执行**
4. 右侧实时查看执行状态，失败可点击查看详情

> **注意：** 修改测试脚本后必须重启 Dashboard（ESM 模块缓存）：
> ```bash
> pkill -f "tsx src/dashboard" && npx tsx src/dashboard/server.ts
> ```

### 方式二：CLI 直接执行

```bash
# 桌面端
node src/tests/desktop/market/search.test.mjs
node src/tests/desktop/market/search.test.mjs MARKET-SEARCH-002

# Web 端
node src/tests/web/market/search.test.mjs
node src/tests/web/market/chart.test.mjs MARKET-CHART-001

# 插件端
node src/tests/extension/market/search.test.mjs EXT-MARKET-SEARCH-003
```

### 方式三：Claude 快捷指令

| 指令 | 说明 |
|------|------|
| `/qatest` | 一键启动 CDP + Dashboard，引导执行 |
| `/onekey-test-designer` | 从 PRD 设计测试用例 |
| `/onekey-recorder` | 启动录制器 |
| `/onekey-record-from-file` | 读取用例文件，引导录制 |
| `/onekey-qa-director` | 总调度：执行 → 诊断 → 修复 |
| `/onekey-qa-manager` | 失败诊断分析 |
| `/onekey-reporter` | 生成测试报告 |

---

## 4. 录制与生成脚本

### 4.1 标准流程

```
录制操作 → 确认步骤清单 → 生成测试脚本
```

#### Step 1: 启动录制

```bash
# 桌面端录制（连接 OneKey，监控 UI 在 3210）
node src/recorder/listen.mjs

# Web 端录制（连接 Chrome，监控 UI 在 3211）
node src/recorder/listen-web.mjs
```

#### Step 2: 在应用上操作

在 OneKey 桌面端 / Web 页面上正常操作，录制器自动捕获点击、输入等事件。

#### Step 3: 确认操作清单

告诉 Claude "录制完了"，会列出所有捕获的操作：

```
录制步骤确认：
1. 点击 [Market 侧栏] — selector: [data-testid="tab-modal-..."]
2. 点击 [搜索框] — selector: input[data-testid="nav-header-search"]
3. 输入 [BTC] — selector: input
4. 点击 [BTC 结果行] — selector: div.row
...
请确认以上步骤顺序和完整性。
```

**必须确认后才能继续。**

#### Step 4: 生成测试脚本

确认后自动生成：
- 测试脚本 → `src/tests/<platform>/<module>/<feature>.test.mjs`
- 更新 UI Map → `shared/ui-map.json`
- 更新用例定义 → `shared/test_cases.json`

### 4.2 录制监控 UI

- 桌面端：`http://localhost:3210`
- Web 端：`http://localhost:3211`

实时查看录制的每一步，支持删除误操作的步骤。

---

## 5. 测试脚本编写规范

### 5.1 文件结构

```javascript
import { connectCDP, sleep, screenshot, RESULTS_DIR } from '../../helpers/index.mjs';

export const testCases = [
  {
    id: 'FEATURE-001',
    name: '功能描述',
    fn: async (page) => {
      // 测试逻辑，只接收 page 参数
    },
  },
];

export async function setup(page) {
  // 前置条件（只执行一次，缓存结果）
}
```

### 5.2 关键规则

| 规则 | 正确 | 错误 |
|------|------|------|
| 输入方式 | `locator.pressSequentially('BTC', {delay:40})` | `nativeInputValueSetter` / `keyboard.type()` |
| 清空输入 | `input.select()` + `Backspace` | `Meta+a`（触发 Electron 快捷键） |
| 弹窗操作 | 先检查 `isSearchModalOpen`，只在未打开时点击触发元素 | 每次都点击触发元素（反复开关弹窗） |
| 等待结果 | 轮询重试 10 次 × 500ms | 固定 `sleep(900)` |
| 截图 | 仅在失败时 | 每步都截图（严重拖慢） |
| 用例粒度 | 一个连贯操作流 = 一个用例 | 把搜索、切 tab、验证拆成多个用例 |

### 5.3 弹窗交互模式（重要）

OneKey 的搜索等功能是弹窗模式：点击触发元素 → 打开 `APP-Modal-Screen` → 内部有独立的输入框和按钮。

```javascript
// ✅ 正确：分离打开和操作
async function openSearchModal(page, triggerFn) {
  if (await isSearchModalOpen(page)) return;  // 已打开就不重复
  await triggerFn(page);                       // 只在需要时触发
  await sleep(800);
}

// ✅ 正确：定位弹窗内部元素
const modalInput = page.locator('[data-testid="APP-Modal-Screen"] input').first();
await modalInput.pressSequentially('BTC', { delay: 40 });

// ❌ 错误：反复点击触发元素
await page.click('[data-testid="nav-header-search"]');  // 每次搜索都重新打开
```

### 5.4 跨平台复用

搜索等通用功能的核心逻辑在 `helpers/market-search.mjs`，三端复用：

```javascript
// 共享逻辑
import { openSearchModal, setSearchValueStrict, ... } from '../../helpers/market-search.mjs';

// 平台特有：触发搜索的方式
// 桌面端：点击头部 input
// Web 端：点击搜索图标按钮（SVG magnifying glass）
// 插件端：先尝试 input，fallback 到图标
async function openSearchTrigger(page) { /* 平台特有实现 */ }

// 绑定后使用
const _set = (page, v) => setSearchValueStrict(page, v, openSearchTrigger);
```

---

## 6. 目录结构速查

```
src/tests/
├── helpers/
│   ├── index.mjs              # CDP 连接、截图、通用工具
│   ├── market-search.mjs      # 搜索功能共享逻辑（16 个函数）
│   ├── extension-cdp.mjs      # 插件端 CDP 连接
│   ├── navigation.mjs         # 页面导航
│   ├── accounts.mjs           # 账户/解锁
│   ├── network.mjs            # 网络切换
│   ├── transfer.mjs           # 转账
│   └── preconditions.mjs      # 前置条件框架
├── desktop/                   # 桌面端用例
│   ├── market/search.test.mjs
│   ├── perps/{favorites,token-search}.test.mjs
│   ├── settings/{lang,theme}.test.mjs
│   ├── transfer/cosmos.test.mjs
│   ├── wallet/create-mnemonic.test.mjs
│   └── referral/bind-invite-code.test.mjs
├── web/                       # Web 端用例
│   └── market/{search,chart}.test.mjs
└── extension/                 # 插件端用例
    └── market/search.test.mjs

src/recorder/
├── listen.mjs                 # 桌面端录制器 (端口 3210)
└── listen-web.mjs             # Web 端录制器 (端口 3211)

src/dashboard/
├── server.ts                  # Dashboard 服务 (端口 5050)
├── index.html                 # 执行面板 UI
├── test-registry.ts           # 用例自动发现
└── test-executor.ts           # 用例执行引擎

shared/
├── results/<ID>.json          # 执行结果
├── ui-map.json                # 选择器映射
├── test_cases.json            # 用例定义
└── knowledge.json             # 知识库
```

---

## 7. 常见问题

### CDP 连不上

```bash
# 桌面端：重启 OneKey
pkill -f "OneKey" && sleep 2
/Applications/OneKey-3.localized/OneKey.app/Contents/MacOS/OneKey --remote-debugging-port=9222 &

# Web/插件端：先关 Chrome 再启动
killall "Google Chrome" && sleep 2
# 脚本会自动启动
```

### Dashboard 执行的是旧代码

```bash
# 重启 Dashboard
pkill -f "tsx src/dashboard" && npx tsx src/dashboard/server.ts
```

### 搜索输入无效

确认使用 `locator.pressSequentially()`，不是 `nativeInputValueSetter` 或 `keyboard.type()`。

### 插件加载失败

插件端需要完整的 Chrome 数据目录（包含登录态和扩展验证）。脚本会自动复制 `~/Library/Application Support/Google/Chrome/` 到 `/tmp/chrome-ext-cdp-profile`。如果失败：

```bash
rm -rf /tmp/chrome-ext-cdp-profile  # 清理旧数据
# 重新运行会自动复制
```

### 测试 ID 规范

格式：`<FEATURE>-<NNN>`（如 `MARKET-SEARCH-001`、`COSMOS-003`）

Web 端加 `WEB-` 前缀，插件端加 `EXT-` 前缀。

---

## 8. 新增测试用例流程

1. **录制操作** → `/onekey-recorder` 或 `node src/recorder/listen.mjs`
2. **确认步骤** → 列出操作清单，用户确认
3. **生成脚本** → 放到 `src/tests/<platform>/<module>/<feature>.test.mjs`
4. **CLI 验证** → `node src/tests/.../<feature>.test.mjs`
5. **重启 Dashboard** → 面板自动发现新用例
6. **面板执行** → 选择用例，点击执行
