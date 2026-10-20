# 提示词库（@local/dsh-prompt-library）

DSH 插件：在 Web GUI 左侧栏【插件】下方新增【提示词】面板，管理常用提示词并把它们插入当前对话草稿。

## 需求映射

| 需求 | 实现 |
|---|---|
| 左侧栏新增【提示词】栏目 | `sidebar.panellist` 注册 `id: 'prompts'`、`order: 1`（【插件】是 `order: 0`，list slot 按 order 升序） |
| 面板内增删改查 | `main` keyed slot 的面板页面；数据存 `localStorage` |
| 面板内使用提示词、插入当前对话 | 面板写"待插入"意图 → session 作用域的**插入中继**执行 `captureInsertion()` + `insertText()` |
| 输入框内 `/prompt` 快速调用 | `ctx.commandUi.register` 注册 popupSelect；选中后走**同一条**意图通道 |

## 架构：为什么是三块注册 + 一个命令

```
sidebar.panellist          →  PromptsPanelIcon      侧栏入口（只有图标）
main[key='prompts']        →  PromptsPage           面板本体：CRUD + 搜索
conversation.composer.dock →  InsertRelay           插入中继（session 作用域，渲染 null）
commandUi: /prompt         →  popupSelect           键盘流入口（不自己插入，只写意图）
```

面板与 `/prompt` **共用同一条插入通道**：两者都只写"待插入"意图，真正的落笔只由中继一处实现。
这样命令侧不会重复实现插入逻辑，也不会踩到"面板拿不到 `inputActions`"那个坑。

关键约束（都有源码依据）：

1. **`main` 是 keyed slot，用 `key` 与侧栏的 `id` 对齐**，不是 `id`。
2. **`inputActions` 只存在于 session 作用域的 props 里**。ui-conversation 通过
   `ctx.uiSession.provide({ props: ['inputActions'] })` 发布，`ctx.uiSession` 本身
   只有 `provide()`，没有对外按会话解析的入口。
3. **打开全局面板时会话界面会被卸载**。ui-layout 是
   `renderSlot("main", {}, { entryKey: activePanelId ?? "conversation" })`，
   而 `conversation.composer.dock` 声明为 `{ kind: 'list', scope: 'session' }`。
   所以"面板按钮直接插入"做不到，必须由会话挂载时才存在的中继组件落笔。

时序：点【使用】→ 面板写 pending → 切回对话（composer 挂载）→ 中继读到 pending →
`captureInsertion()` 取选区与 `draftRev` → `insertText(text, span)` → 写回执并清 pending →
面板下次打开时显示"已插入到当前草稿"。

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
| 5 | 【编辑】改正文 → 保存 | 列表更新 |
| 6 | 【删除】→【确认删除】 | 条目消失（两步确认，无阻塞弹窗） |
| 7 | 某条点【使用】 | 面板提示"已排队：切回对话后插入"；切回对话后正文出现在草稿光标处，且**原有草稿保留**（插入是一次可撤销编辑） |
| 8 | 输入框键入 `/prompt` | 菜单出现【提示词】；继续键入（如 `/pro`）可筛选 |
| 9 | 在 `/prompt` 菜单里选中一条 | 菜单关闭，正文出现在草稿光标处，**不自动发送**，且键入的 `/pro` 被干净移除 |
| 10 | 看面板底部 | 显示 `提示词库 v1.1.0`，与 package.json 一致 |
| 11 | 重启 DSH 后再打开面板 | 提示词都还在 |

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

1. 面板底部显示运行中的版本（`提示词库 v1.1.0`）——一眼就能看出装的是新版还是旧版，
   这是硬链接静默留旧副本这个问题唯一可靠的现场判据。
2. `client.js` 的 `PLUGIN_VERSION` 与 `package.json` 的 `version` 由桩测试断言一致，
   升级时漏改一处会直接测试失败。

变更历史见 [CHANGELOG.md](CHANGELOG.md)。

## 升级到本版（1.1.0）

**必须先卸载再重新安装**——profile 里的副本是旧代码，不会自己更新。
装完看面板底部：显示 `v1.1.0` 才是新版；仍显示 `v1.0.0` 说明还是旧副本。

不想点界面时也可以用内容哈希判断（**不要看 `LinkType`，它不可靠**）：

```powershell
$p = "$env:DSH_PROFILE_DIR\node_modules\@local\dsh-prompt-library\client.js"
(Get-FileHash $p).Hash -eq (Get-FileHash packages\prompt-library\client.js).Hash
```

`False` 就说明装的是旧版。详见 [../../docs/dev-notes/install-and-iteration.md](../../docs/dev-notes/install-and-iteration.md)。

## 数据存放

`localStorage` 键 `dsh.prompt-library.v1`，值形如 `{"prompts":[{"id","title","body","createdAt"}]}`。
DSH Desktop 会把它落盘到：

```
%APPDATA%\dsh-desktop\harness\profiles\web\desktop-storage.json
```

因此换机器前备份这一个键即可；也说明数据属于本机本 profile（"全局一份"不含跨设备同步）。

## 自测（不需要 DSH）

```
node packages/prompt-library/smoke-test.mjs
```

用一个极小的 React 运行时替身真正跑组件，驱动真实交互路径，覆盖 62 项：
注册契约、空态、新增、标题派生、搜索、编辑、删除二次确认、
`/prompt` 的 popupSelect 规格与选项映射、**写意图的时序契约**、版本一致性，以及
「面板或命令写意图 → 中继 `insertText`」这条跨作用域链路（含被拒回执与重复渲染不二次插入）。

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

## 迭代方式

见 [../../docs/dev-notes/install-and-iteration.md](../../docs/dev-notes/install-and-iteration.md)。

要点：用 harness 的 `edit`/`write` 改代码后，profile 里的副本仍是旧代码——必须卸载重装。
**别用 `LinkType` 判断**（它会误导性地仍报 `HardLink`），要比内容哈希。
`安装成功`不等于`跑的是新代码`。
