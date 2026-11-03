# 提示词库（@local/dsh-prompt-library）

DSH 插件：在 Web GUI 左侧栏【插件】下方新增【提示词】面板，**按分组管理**常用提示词并把它们插入当前对话草稿。

## 需求映射

| 需求 | 实现 |
|---|---|
| 左侧栏新增【提示词】栏目 | `sidebar.panellist` 注册 `id: 'prompts'`、`order: 1`（【插件】是 `order: 0`，list slot 按 order 升序） |
| 面板内增删改查 | `main` keyed slot 的面板页面；数据存 `localStorage` |
| 分组管理同类提示词 | 每条提示词带 `groupId`；面板按分组分区展示，可新建/重命名/删除分组、在编辑器里改归属 |
| 按当前提示词自动分组 | 内置本地关键词分类规则；旧数据首次加载自动归类，面板另有【自动分组】按钮 |
| 面板内使用提示词、插入当前对话 | 面板写带目标 `sessionId` 的"待插入"意图 → 目标会话的**插入中继**执行 `captureInsertion()` + `insertText()` |
| 输入框内 `/prompt` 快速调用 | `ctx.commandUi.register` 注册 popupSelect；选中后走**同一条**意图通道 |

## 架构：为什么是四块注册 + 一个命令

```
sidebar.panellist            →  PromptsPanelIcon      侧栏入口（只有图标）
main[key='prompts']          →  PromptsPage           面板本体：CRUD + 搜索 + 分组
conversation.composer.dock   →  InsertRelay           插入中继（session 作用域，渲染 null）
conversation.input.left      →  InsertRelay           备用插入中继（覆盖空白 hero 会话）
commandUi: /prompt           →  popupSelect           键盘流入口（不自己插入，只写意图）
```

面板与 `/prompt` **共用同一条插入通道**：两者都只写"待插入"意图，真正的落笔只由中继一处实现。
这样命令侧不会重复实现插入逻辑，也不会踩到"面板拿不到 `inputActions`"那个坑。

**意图必须带目标会话。** `pending` 是模块级单例；当前 DSH 同一时刻可能挂载不止一个
composer（主会话、嵌入式子代理对话、侧栏 chat 标签都会渲染 `conversation.composer.dock`）。
若意图不带 `sessionId`，"谁先跑 effect 谁插入"就会把文字落进别的对话（1.2.0 修的就是这个）。
现在中继只认领 `pending.sessionId === 自己的 sessionId` 的意图，且 `claimPending()` 原子清空，
同一意图最多落笔一次。面板通过 `ctx.inject(['sessions'])` 查 `retainedBy.mainView > 0` 的
主会话；`/prompt` 直接用 `onSelect(option, context)` 里的 `context.sessionId`。

`conversation.composer.dock` 只在 `variant === "composer"` 时渲染；新建/空白会话（hero）里
没有它，所以另有中继挂在 `conversation.input.left`（hero 与普通 composer 都会渲染）。两处
共用同一份原子认领，不会重复插入。

关键约束（都有源码依据）：

1. **`main` 是 keyed slot，用 `key` 与侧栏的 `id` 对齐**，不是 `id`。
2. **`inputActions` 只存在于 session 作用域的 props 里**。ui-conversation 通过
   `ctx.uiSession.provide({ props: ['inputActions'] })` 发布，`ctx.uiSession` 本身
   只有 `provide()`，没有对外按会话解析的入口。
3. **打开全局面板时会话界面会被卸载**。ui-layout 是
   `renderSlot("main", {}, { entryKey: activePanelId ?? "conversation" })`，
   而 `conversation.composer.dock` 声明为 `{ kind: 'list', scope: 'session' }`。
   所以"面板按钮直接插入"做不到，必须由会话挂载时才存在的中继组件落笔。

时序：点【使用】→ 面板查当前主会话并写 `pending = { text, sessionId }` → 切回对话（composer 挂载）→
**只有 sessionId 匹配的中继**原子认领 → `captureInsertion()` 取选区与 `draftRev` →
`insertText(text, span)` → 写回执 → 面板下次打开时显示"已插入到当前草稿"。
若意图指向的会话当前没挂载（比如还没切回去），意图会保留，等该会话的 composer 出现时再插入；
其它会话不会误领。

## 分组与自动归类

**数据模型**：`prompts[]` 每条多一个可选 `groupId`；另有 `groups[]`（`{ id, name, createdAt }`）。
`groupId` 缺失 / 指向已删除的分组时显示在「未分组」区。删分组只把组内提示词退回未分组，不删提示词。

**面板交互**：列表按分组分区显示（可折叠），组头有计数与【重命名】【删除分组】；顶部有
【自动分组】【新建分组】【新增】；新增/编辑对话框里用下拉框选择归属分组。
`/prompt` 命令弹窗也按分组排序：每个选项带 `group: { name, label }`，framework 会渲染成
吸顶分组标题，组内最新在前、未分组垫底。

**自动分组**是纯本地启发式（`CATEGORY_RULES` + `classifyPrompt`），不依赖模型、不联网：
每个分类按命中关键词的**长度之和**打分，取得分最高且大于 0 的分类；ASCII 关键词按**整词**匹配
（`review` 不会命中 `preview`、`test` 不会命中 `latest`），同一分类内长词已命中时不再重复计被包含的短词；
对不上任何分类的保持未分组。它只处理「未分组」的条目，用户手动指定的分组不会被覆盖。

**旧数据迁移**：旧版（≤1.2.x）的存储是 `{ prompts: [...] }`、没有 `groups` 字段。新版第一次加载
读到这种数据时，会自动跑一次 `autoAssign()`，把已有提示词按内容归类并落盘；迁移后数据里就有了
`groups` 字段，之后清空分组也不会被重新自动分类。所以「根据当前提示词自动生成并分配分组」对
历史数据是即时生效的，不需要手动点按钮。

## 安装

1. 侧栏【插件】→ **添加插件**
2. 输入本地绝对路径：

   ```
   D:\Codes\github\dsh-plugins\packages\prompt-library
   ```

3. 确认安装并启用 `@local/dsh-prompt-library`
4. 左侧栏【插件】正下方应出现【提示词】

首次安装后如果侧栏没出现，重启一次 DSH Desktop（新的 JS 模块代需要重启加载）。

## 验收

| # | 操作 | 预期 |
|---|---|---|
| 1 | 看左侧栏 | 【提示词】在【插件】正下方，图标是三条横线 |
| 2 | 点【提示词】→【新增】→ 填标题与正文 → 保存 | 条目出现在列表顶部 |
| 3 | 标题留空保存 | 标题自动取正文首行前 40 字 |
| 4 | 搜索框输入正文里的词 | 列表实时筛选；无命中显示空态 |
| 5 | 【编辑】改正文 → 保存 | 编辑框以**视口居中的模态对话框**出现（列表滚到哪里都看得到），列表更新 |
| 6 | 【删除】→【确认删除】 | 条目消失（两步确认，无阻塞弹窗） |
| 7 | 某条点【使用】 | 面板提示"已排队：切回对话后插入"；切回**原来那个对话**后正文出现在草稿光标处，且**原有草稿保留**（插入是一次可撤销编辑）；其它对话不会收到这段文字 |
| 8 | 输入框键入 `/prompt` | 菜单出现【提示词】；继续键入（如 `/pro`）可筛选 |
| 9 | 在 `/prompt` 菜单里选中一条 | 菜单关闭，正文出现在**该输入框**光标处，**不自动发送**，且键入的 `/pro` 被干净移除 |
| 10 | 新建一个空白对话，再点某条【使用】 | 正文出现在这个空白对话的输入框里（hero 会话也能插入） |
| 11 | 升级后首次打开面板（旧数据没有分组） | 已有提示词被自动归类，列表按分组分区显示 |
| 12 | 顶部点【自动分组】 | 未分组的条目按内容归入「测试与质量 / 图像与设计 / …」；对不上的保持未分组 |
| 13 | 【新建分组】→ 填名称 → 保存 | 新分组出现在列表（可折叠），编辑器分组下拉里可选 |
| 14 | 编辑某条 → 改分组下拉 → 保存 | 条目移动到目标分组 |
| 15 | 组头【重命名】/【删除分组】 | 重命名立即生效；删除分组需二次确认，组内提示词回到「未分组」且不删除 |
| 16 | 看面板底部 | 显示 `提示词库 v1.3.0`，与 package.json 一致 |
| 17 | 重启 DSH 后再打开面板 | 提示词与分组都还在 |

第 7、9 步是核心：插入**不自动发送**，只落到草稿。Ctrl+Z 应能撤销这一次插入。

`/prompt` 的搜索匹配**标题 + 正文前 120 字**（菜单行的 detail 就是这段预览，框架只拿
`label` 与 `detail` 做子串匹配）；面板内的搜索匹配**完整正文**。这个差异是刻意的：
菜单行放得下的是预览，不是全文。

### `/prompt` 的时序约束（1.1.0 修的坑，改动时别踩回去）

ui-commands 在 `onSelect` **之后**才删掉你键入的 `/pro`，用的是带 `draftRev` 的 CAS guard：

```js
// conversation 的 consumeToken
if (guard.kind === "span") {
  if (guard.span.draftRev !== this.rev || span.start === span.end) return false;
  return this.draftEditor.replaceText(guard.span, "");
}
```

所以 `onSelect` **不能同步写意图**：中继会抢先插入、推进 `rev`，guard 随即失配，
`/pro` 就永远留在草稿里（1.0.0 的实际现象）。现在命令路径用 `setTimeout(…, 0)`
把写意图推到下一个宏任务，消费已在微任务链里完成；中继到那时才 `captureInsertion()`，
拿到的是消费后的 `rev` 与光标。桩测试里有一条断言专门锁这个契约。

## 版本管理

**平台侧只有这么多**（都有源码/文档依据）：

| 能力 | 现状 |
|---|---|
| 版本号在哪 | `package.json` 的 `version`；安装后的 generation 目录名是 `local+<包名>+<版本>+<hash>` |
| 插件卡片显示版本 | 会显示（组合包详情页的版本标签） |
| 按版本切换 / 回滚 | **没有**。插件管理器明确"没有版本选择器"，也不提供升级 |
| 自动更新 | **没有**。官方说明"插件安装后暂不支持自动更新" |
| 升级方式 | 卸载 → 重新安装 |
| 装的是哪一版 | 只能靠本插件**面板底部自报的版本号**，或比内容哈希 |

所以本插件自己做两件事来兜住这个缺口：

1. 面板底部显示运行中的版本（`提示词库 v1.3.0`）——一眼就能看出装的是新版还是旧版，
   这是硬链接静默留旧副本这个问题唯一可靠的现场判据。
2. `client.js` 的 `PLUGIN_VERSION` 与 `package.json` 的 `version` 由桩测试断言一致，
   升级时漏改一处会直接测试失败。

变更历史见 [CHANGELOG.md](CHANGELOG.md)。

## 升级到本版（1.3.0）

**必须先卸载再重新安装**——profile 里的副本是旧代码，不会自己更新。
装完看面板底部：显示 `v1.3.0` 才是新版；仍显示旧版本号说明还是旧副本。

不想点界面时也可以用内容哈希判断（**不要看 `LinkType`，它不可靠**）：

```powershell
$p = "$env:DSH_PROFILE_DIR\node_modules\@local\dsh-prompt-library\client.js"
(Get-FileHash $p).Hash -eq (Get-FileHash packages\prompt-library\client.js).Hash
```

`False` 就说明装的是旧版。详见 [../../docs/dev-notes/install-and-iteration.md](../../docs/dev-notes/install-and-iteration.md)。

## 数据存放

`localStorage` 键 `dsh.prompt-library.v1`，值形如
`{"prompts":[{"id","title","body","createdAt","groupId"}],"groups":[{"id","name","createdAt"}]}`。
旧版只有 `{"prompts":[...]}`（无 `groups` 字段），新版首次加载会就地补全 `groups` 与各条的
`groupId`。DSH Desktop 会把它落盘到：

```
%APPDATA%\dsh-desktop\harness\profiles\web\desktop-storage.json
```

因此换机器前备份这一个键即可；也说明数据属于本机本 profile（"全局一份"不含跨设备同步）。

## 自测（不需要 DSH）

```
node packages/prompt-library/smoke-test.mjs
```

用一个极小的 React 运行时替身真正跑组件，驱动真实交互路径，覆盖 107 项：
注册契约、空态、新增、标题派生、搜索、编辑、删除二次确认、**编辑/新增的模态弹层**、
**分组的新建/归类/重命名/删除、自动分组、旧数据自动迁移**、
`/prompt` 的 popupSelect 规格与选项映射、**写意图的时序契约**、**按会话定向与原子认领**、
版本一致性，以及「面板或命令写意图 → 目标会话中继 `insertText`」这条跨作用域链路
（含被拒回执、非目标会话不认领、hero 备用中继、重复渲染不二次插入）。

**它不能证明 DSH 会渲染它、也不能证明真实 Lexical 草稿插入成功**——那只能由 DSH 自己证明。

## 已知限制与刻意取舍

- **不自动重试插入**：`insertText` 在草稿处于 `adjudicating`/`submitting` 或 `draftRev` 已变时返回
  `false`。此时按规范"保留结果等待用户操作"——我们只记录失败让面板提示，由你再点一次。
  静默重试会让行为不可预期。走 `/prompt` 时失败**不会弹提示**（那条路径没有可见回执面），
  只会"什么都没插入"；下次打开面板能看到失败记录。
- **`/prompt` 命令名有极小概率与宿主命令冲突**：客户端自有命令与宿主命令同名会明确抛错。
  已核对宿主只有 `compact`/`feedback`/`goal`，没有 `prompt`。若将来撞名，改 `COMMAND_NAME` 即可。
- **文案硬编码中文，未走 Client locale 服务**：本插件单语言；且我没有 locale 字典格式的证据，
  不想猜。要变成可分发包时再补。
- **不使用官方 store 席位**：`@deepseek-ai/dsh-client-store` 的 `defineStore` 需要跨模块
  `require`，而它在 `dsh.client.external` 里的声明形状没有证据。持久化因此直接用 `localStorage`
  ——这正是 `attachPersistence` 的实现，且已由 A1 探针实测落盘并跨重启存活。
- **`label` 用纯字符串**：panellist 的 `label` 明确支持"字符串或 locale-aware"，字符串是文档允许的形式。
- **没有标签/置顶/变量占位符/批量导入**：见 `docs/ideas/prompt-library.md` 的 Not Doing 清单。
- **自动分组是本地关键词启发式**（`CATEGORY_RULES`），只覆盖常见类别（测试、代码审查、图像、写作、
  翻译、数据分析、产品、架构、运维、教学、提示词工程）；对不上任何分类的保持「未分组」，
  可手动改。它不调用模型、不联网，因此不会越用越聪明——类别不够时改 `CATEGORY_RULES` 即可。

## 迭代方式

见 [../../docs/dev-notes/install-and-iteration.md](../../docs/dev-notes/install-and-iteration.md)。

要点：用 harness 的 `edit`/`write` 改代码后，profile 里的副本仍是旧代码——必须卸载重装。
**别用 `LinkType` 判断**（它会误导性地仍报 `HardLink`），要比内容哈希。
`安装成功`不等于`跑的是新代码`。
