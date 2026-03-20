# OneKey QA-AGENTS 使用教程

## 完整工作流程

```
从用例文档到自动化回归，只需要 3 步：

1. 录制：@用例文件 开始录制 → 在 App 上操作 → 确认步骤
2. 生成：自动生成测试脚本 → 自动验证通过
3. 回归：qatest 开始执行 → 勾选用例 → 一键执行
```

---

## 1. 录制用例（从用例文档到测试脚本）

### 1.1 启动录制

在 Claude Code 对话中输入：

```
@docs/qa/testcases/cases/market/xxx.md 开始录制，录制桌面端
```

**AI 会自动完成：**
- 读取用例文件，分析测试场景
- 启动 OneKey CDP 连接（自动检测，断开自动重启）
- 启动录制器（监控页面 `http://localhost:3210`）
- 根据用例编排录制计划，列出要录制的场景清单
- 引导你操作第一个场景

### 1.2 录制操作

按 AI 的引导在 OneKey App 上操作。录制器会自动捕获每次点击和输入。

**录制监控页面**（`http://localhost:3210`）实时显示：
- **CDP 状态**：绿点 = 连接正常，红点 = 断开
- **录制器状态**：Recording / Disconnected
- **操作列表**：每一步的元素、选择器、坐标
- **Reconnect 按钮**：断开时一键重连

### 1.3 确认步骤

操作完一个场景后，回复 AI：**"录完了"**

AI 会列出录制到的所有操作步骤：

```
录制步骤确认（场景①：观察列表收藏）：

| # | 操作 | 说明 |
|---|------|------|
| 1 | 点击「市场」侧栏 | data-testid="Desktop-AppSideBar-..." |
| 2 | 点击星标 ⭐ | 收藏第一个 Token |
| 3 | 点击「自选」tab | 验证收藏列表 |
| ... | | |

请确认顺序和完整性是否正确？
```

### 1.4 你可以做的事

- **确认**：回复"对"、"正确"、"确认"→ 继续下一个场景
- **纠正**：说明哪一步不对，AI 会修正
- **补充断言**：说明需要额外验证什么（如"这里需要验证网络没有变"）
- **补充条件**：说明变量条件（如"如果已连接就跳过连接步骤"）
- **补充 DApp 侧操作**：录制器捕获不到 DApp 网页内的操作，口述补充

### 1.5 全部录制完毕

所有场景确认后，AI 自动：

1. **生成测试脚本** → `src/tests/<平台>/<模块>/<功能>.test.mjs`
2. **运行验证** → 确保脚本能通过
3. **注册到 Dashboard** → 重启 Dashboard 后面板自动发现新用例

> **注意：** 操作涉及第三方网页内的交互（如 DApp 内点击 Connect Wallet）时，AI 会提前说明该部分无法自动化，避免录制后才发现不可行。

---

## 2. 执行用例（回归测试）

### 2.1 打开执行面板

在 Claude Code 对话中输入：

```
qatest 开始执行
```

AI 会自动：
- 检查/启动 OneKey CDP
- 启动 Dashboard（`http://localhost:5050`）

### 2.2 在面板中执行

打开 `http://localhost:5050`：

1. **切换平台**：顶部 tab —— 桌面端 / Web端 / 插件端
2. **勾选用例**：左侧树形列表，可勾选单个用例或整个分类
3. **开始执行**：点击 **▶ 开始执行**
4. **查看结果**：右侧实时显示每个用例的执行状态，失败可点击查看详情

### 2.3 CLI 直接执行

```bash
# 跑单个用例
node src/tests/desktop/market/search.test.mjs MARKET-SEARCH-002

# 跑整个模块
node src/tests/desktop/market/search.test.mjs

# Web 端
node src/tests/web/market/chart.test.mjs MARKET-CHART-001

# 插件端
node src/tests/extension/market/search.test.mjs
```

---

## 3. 快捷指令速查

直接在 Claude Code 对话中输入，支持中文自然语言：

### 录制相关

| 输入 | 效果 |
|------|------|
| `@用例文件.md 开始录制` | 读取用例 → 启动 CDP + 录制器 → 展示录制计划 → 引导逐场景录制 |
| `开始录制` | 启动录制器，手动操作 App |
| `录完了` | 展示录制步骤细节，等待确认 |
| `录制测试` | 完整流程：录制 → 确认 → 生成脚本 → 验证 |

### 执行相关

| 输入 | 效果 |
|------|------|
| `qatest 开始执行` | 启动 CDP + Dashboard → 打开执行面板 |
| `打开执行面板` | 同上 |
| `跑测试` | 总调度：执行 → 汇总结果 → 失败时诊断 |
| `执行测试 MARKET-SEARCH-002` | CLI 执行指定用例 |

### 诊断相关

| 输入 | 效果 |
|------|------|
| `诊断失败` | 分析最近的失败用例，给出根因和修复建议 |
| `为什么失败 MARKET-FAV-003` | 分析指定用例的失败原因 |
| `更新选择器` | 修复失效的 DOM 选择器 |
| `生成报告` | 生成测试质量报告 |

### 设计相关

| 输入 | 效果 |
|------|------|
| `设计用例` | 从 PRD 分析需求，设计测试场景 |
| `写用例` | 同上 |
| `新增测试` | 同上 |

---

## 4. 环境配置

### 4.1 必须的软件

| 软件 | 用途 |
|------|------|
| OneKey Desktop | 桌面端测试（自动启动） |
| Google Chrome | Web/插件端测试（自动启动） |
| Node.js 20+ | 运行测试和 Dashboard |
| playwright-core | CDP 连接（`npm install`） |

### 4.2 CDP 端口分配

| 平台 | 端口 | 说明 |
|------|------|------|
| 桌面端 | 9222 | 连接 OneKey Electron |
| Web 端 | 9223 | 连接 Chrome（自动复制用户 profile） |
| 插件端 | 9224 | 连接 Chrome（复制完整数据目录，保留扩展） |
| Dashboard | 5050 | 测试执行面板 |
| 录制器 | 3210 | 桌面端录制监控 |
| 录制器 | 3211 | Web 端录制监控 |

### 4.3 环境变量（可选）

```bash
CDP_URL=http://127.0.0.1:9222        # 桌面端 CDP
WEB_CDP_URL=http://127.0.0.1:9223    # Web 端 CDP
EXT_CDP_URL=http://127.0.0.1:9224    # 插件端 CDP
ONEKEY_EXT_ID=jnmbo...hlhcj          # 插件 ID（默认自动检测）
ONEKEY_EXT_PATH=/path/to/extension   # 插件路径（默认自动检测）
WALLET_PASSWORD=1234567890-=          # 钱包密码
```

---

## 5. 目录结构

```
src/tests/
├── helpers/                   # 共享工具
│   ├── index.mjs              # CDP 连接、截图、通用工具
│   ├── market-search.mjs      # 搜索功能共享逻辑（三端复用）
│   └── extension-cdp.mjs      # 插件端 CDP 连接
├── desktop/                   # 桌面端用例 (CDP 9222)
│   ├── market/
│   │   ├── search.test.mjs    # 搜索 MARKET-SEARCH-001~005
│   │   └── favorite.test.mjs  # 收藏 MARKET-FAV-001~006
│   ├── perps/                 # 合约
│   ├── settings/              # 设置
│   ├── transfer/              # 转账
│   ├── wallet/                # 钱包
│   └── referral/              # 返佣
├── web/                       # Web 端用例 (CDP 9223)
│   └── market/
│       ├── search.test.mjs    # WEB-MARKET-SEARCH-001~005
│       └── chart.test.mjs     # MARKET-CHART-001~003
└── extension/                 # 插件端用例 (CDP 9224)
    └── market/
        └── search.test.mjs    # EXT-MARKET-SEARCH-001~005

src/recorder/
├── listen.mjs                 # 桌面端录制器 (3210)
└── listen-web.mjs             # Web 端录制器 (3211)

src/dashboard/
├── server.ts                  # Dashboard (5050)
├── index.html                 # 执行面板（桌面端/Web端/插件端 tab 切换）
├── test-registry.ts           # 自动发现用例
└── test-executor.ts           # 执行引擎
```

---

## 6. 脚本编写规范（给 AI 和开发者）

### 核心规则

| 规则 | 正确做法 | 错误做法 |
|------|---------|---------|
| 输入方式 | `locator.pressSequentially('BTC', {delay:40})` | `nativeInputValueSetter` / `keyboard.type()` |
| 清空输入 | `input.select()` + `Backspace` | `Meta+a`（触发 Electron 快捷键） |
| 弹窗操作 | 先检查是否已打开，未打开才点触发元素 | 每次都点触发元素（反复开关） |
| 等待结果 | 轮询重试 10 次 × 500ms | 固定 `sleep(900)` |
| 截图 | 仅在失败时 | 每步都截图 |
| 用例粒度 | 一个连贯操作流 = 一个用例 | 拆成多个孤立用例 |
| 条件操作 | 先读当前状态，已在目标则跳过 | 不检查直接操作 |

### 跨平台复用

搜索等通用功能提取到 `helpers/market-search.mjs`，三端共享核心逻辑，只有触发方式不同：
- 桌面端：点击头部 input
- Web 端：点击搜索图标按钮
- 插件端：先尝试 input，fallback 到图标

### 不适合自动化的场景

以下场景 AI 会**提前说明**，不会录制后才发现不可行：
- DApp 网页内的操作（Connect Wallet 按钮等）— OneKey CDP 无法访问内置浏览器 webview
- 需要硬件钱包物理交互的操作
- 需要短信/邮件验证的操作

---

## 7. 常见问题

### CDP 连不上

```bash
# 桌面端
pkill -f "OneKey" && sleep 2
/Applications/OneKey-3.localized/OneKey.app/Contents/MacOS/OneKey --remote-debugging-port=9222 &

# Web/插件端
killall "Google Chrome" && sleep 2
# 脚本会自动启动
```

### Dashboard 执行的是旧代码

修改测试脚本后必须重启 Dashboard：
```bash
pkill -f "tsx src/dashboard" && npx tsx src/dashboard/server.ts
```

### 插件加载失败

```bash
rm -rf /tmp/chrome-ext-cdp-profile  # 清理旧数据，重新运行会自动复制
```

### 录制器断开

录制监控页面（`http://localhost:3210`）会实时显示 CDP 和录制器状态。断开时点击 **Reconnect** 按钮一键重连。录制器不会超时退出。

### 测试 ID 规范

- 桌面端：`MARKET-SEARCH-001`、`MARKET-FAV-003`
- Web 端：`WEB-MARKET-SEARCH-001`
- 插件端：`EXT-MARKET-SEARCH-001`
