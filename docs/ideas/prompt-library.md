# 提示词库（DSH 插件）

> 状态：方向已确认，进入 A1 存储探针阶段
> 日期：已定稿 one-pager；实现未开始
>
> 追加（1.3.0）：已在实现之后加入「分组 + 自动归类」能力，细节见包内 `CHANGELOG.md` 与 `README.md`。
> 原 Not Doing 里的「标签 / 置顶 / 排序」仍不做；分组是独立一档。

## Problem Statement

> 如何让常用提示词从"散落在笔记、聊天记录、临时文件里"变成**两步之内进入输入框**，且不打断我打字的手？

## Recommended Direction

做一个 DSH Client 插件（bundle），在 Web GUI 左侧栏新增【提示词】面板——与现有【插件】同级、排在其下方——并在输入框内提供 `/prompt` 命令。面板负责增删改查与搜索，`/prompt` 负责从键盘快速调用，两者共用同一份数据。选中一条后，通过会话的 `inputActions.insertText()` **追加**到当前草稿光标处，保留已有内容，**不自动发送**。

技术上不引入任何新机制，全部复用已确认的公开 API：

| 能力 | API | 先例 |
|---|---|---|
| 左侧栏新栏目 | `sidebar.panellist`（`id`/`order`/`label`）+ root `main` keyed slot 面板 | 【插件】本身就是这么注册的 |
| 面板 CRUD | 面板组件持有 client store 状态 | `slots` store 席位 |
| `/prompt` 命令 | `ctx.commandUi` 注册 popupSelect，选中执行 action、不提交消息 | `/model` |
| 插入草稿 | `InputActions.captureInsertion()` + `insertText(text, span)` | `ui-conversation` 标准 props |

不引入构建工具链：bundle 模板本身是免构建的纯 ESM（React 由浏览器模块表提供），因此**不需要 pnpm workspace、不需要 install、不需要打包**。

## 已确认的决策

| 项 | 决定 |
|---|---|
| 使用者 | 只有我自己用 |
| 数据范围 | 全局一份，跨 workspace 共用 |
| 插入语义 | 追加到光标处，保留现有草稿 |
| 插入后 | 只插入，不自动发送 |
| 入口 | 左侧【提示词】面板 + 输入框内 `/prompt` |
| 命令名 | `/prompt` |
| 首版字段 | 标题 + 正文（标题可默认取正文首行） |
| 首版附加 | 面板内搜索框 |

## Key Assumptions to Validate

- [x] **A1-a — 写入落盘：已验证。**
      探针装上后写入 `hello-persist-2026`，`desktop-storage.json` 中出现
      `dsh.storage-probe.v1 => {"value":"hello-persist-2026","savedAt":"2026-10-18T14:44:20.032Z"}`。
      同时确认探针能在 `conversation.composer.dock` 渲染（否则点不到保存）。
- [ ] **A1-b — 读取在重启后恢复：待验证（需重启 DSH Desktop）。**
      兜底仍为 Host 侧 `ctx.storageDomain`（`dsh-storage-json` 后端）+ 一条 Remote 通道。
- [x] **A4-a — 自定义插件能注册进 `conversation.composer.dock`：已验证。**
      【提示词】面板用的是 `sidebar.panellist` + root `main` keyed slot，仍需在第 1 步验证。
- [ ] **A2 — "全局一份" = 本机本 profile 一份**，不需要跨设备同步。
- [ ] **A3 — `/prompt` 的 popupSelect 能在无会话选中时工作**，或可接受"无会话时命令不可用"。
      （命令目录是会话级的；`insertText` 本身需要会话。）
- [ ] **A4 — `order` 能让【提示词】稳定排在【插件】正下方**，而不是被压到列表末尾。

## MVP Scope

做：

1. ~~**第 0 步 = A1 存储探针。**~~ **已完成并通过**（见上方 A1-a / A1-b）。
2. ~~**第 1 步 = 面板 CRUD + 搜索 + 使用。**~~ **已实现并通过 DSH 运行时验收。**
3. ~~**第 2 步 = `/prompt` 命令。**~~ **已实现**（popupSelect，选中后走同一条意图通道），待运行时验收。

三条需求均已落地。命令与面板共用同一个 session 作用域中继，因此插入逻辑只有一处实现。

### 实现期发现的架构约束（重要，超出原计划）

原计划默认"面板按钮直接调用 `inputActions` 插入"。**这条走不通**，源码依据：

- `inputActions` 只通过 session 作用域的 props 暴露（ui-conversation 的
  `ctx.uiSession.provide({ props: ['inputActions'] })`）；`ctx.uiSession` 只有 `provide()`，
  没有对外按会话解析的入口。
- ui-layout 是 `renderSlot("main", {}, { entryKey: activePanelId ?? "conversation" })`：
  打开全局面板时**会话界面连同 composer 一起被卸载**。

因此插入拆成两半：面板（root 作用域）只写"待插入"意图；`conversation.composer.dock`
（`{ kind: 'list', scope: 'session' }`）里的**插入中继**在会话挂载时执行真正的
`captureInsertion()` + `insertText()`。

### `/prompt` 的消费时序（1.1.0 修）

ui-commands 在 `await onSelect(...)` **之后**才删掉用户键入的 token，用的是带 `draftRev` 的
CAS guard（`guard.span.draftRev !== this.rev → return false`）。所以 `onSelect` 里
**不能同步写插入意图**：中继会抢在消费之前插入、推进 `rev`，guard 失配，`/pro` 残留在草稿里。
命令路径必须把写意图延到下一个宏任务。面板路径没有 token 要消费，不需要延迟。
桩测试里有一条断言锁这个契约（"选中当刻不写意图"）。

### 实现期的取舍

- **持久化用 `localStorage` 而非官方 store 席位**：`defineStore` 需要跨模块 `require`，而
  `dsh.client.external` 的声明形状无证据。`attachPersistence` 本身就是写 `localStorage`，且已实测。
- **文案硬编码中文**，未走 Client locale 服务（字典格式无证据；插件单语言）。
- **不自动重试被拒的插入**，只记录失败让用户重试（规范要求保留结果等待用户操作）。

约束：

- 数据键 `dsh.prompt-library.v1`，只持久化 `prompts`（意图与回执不落盘，避免下次启动误插入）。
- 样式只用官方编译产物中出现过的 token 真名（19 个，已逐个核对）。
- 不导入任何 `@deepseek-ai/*` Harness Client 包（规范硬要求）；图标自己画内联 SVG。
- 面板为全局页面，不属于任何 Session。

## Not Doing (and Why)

| 不做 | 原因 |
|---|---|
| 标签 / 置顶 / 排序 | 用户未选。条目少时是纯界面噪音，等真的挤了再加。 |
| `{{变量}}` 占位符 | 用户未选方向 B。每次插入多一步交互，在用顺之前是纯摩擦。 |
| 批量导入 | 第一版先用起来；导入格式取决于实际数据长什么样，现在设计是猜。 |
| `@` 引用 source | 会污染引用菜单语义（那里是"资源"，不是"我的收藏"）；`/` 已覆盖高频路径。 |
| 行内 chip / 变量高亮 | `insertText` 只保证纯文本；chip 要走引用体系的 owner codec，超出范围。 |
| 云同步 / 多人共享 | 用户选了个人自用。 |
| agent 工具（模型自己读提示词库） | 不在需求里，且会扩大模型可见面。 |
| 自动排序 / 智能推荐 | 数据量不够，收益未验证。 |
| 复用右侧 sidebar tab 而非左侧面板 | 需求把【提示词】放在左侧，跟【插件】并列。 |
| 插入后自动发送 | 用户明确选择只插入不发送。 |
| 插入被拒时静默重试 | 行为不可预期；改为回执提示 + 用户手动重试。 |

## Open Questions

1. 现有提示词大概多少条、平均多长？（决定列表要不要虚拟化、搜索要不要吃全文）
2. 现有提示词现在存在哪？（决定"批量导入"什么时候该被拿回来）
3. `/prompt` 选中后是插到**光标处**（当前设计），还是追加到**草稿末尾**？两者在"草稿中间"场景下手感不同。

## 交付与验证限制

- 本会话没有 `plugin_manager` / `cordis_inspect_query` 工具：可写出可安装的 bundle 并做静态检查，但**装进 profile 与运行时验证必须由用户操作**（插件管理器 UI）。
- 不手工写 profile 的 `package.json` / `cordis.patch.yml`，不在 profile 目录跑 pnpm——那是 `install_bundle` 的职责。
- 参考文档（从 `app.asar` 抽取）暂存于 `.tmp-dsh-ref/`，属临时产物，实现收尾时清理或加入 gitignore。
