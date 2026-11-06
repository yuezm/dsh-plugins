# 变更记录

版本写在两处：`package.json` 的 `version` 与 `client.js` 的 `PLUGIN_VERSION`。
桩测试会断言两者一致，防止漂移。**面板底部会显示运行中的版本**。

DSH 的插件管理器没有版本选择器，也不提供升级：升级 = 卸载后重新安装。
所以"现在装的是哪一版"只能靠面板底部自报的版本号确认，或比内容哈希（见
[docs/dev-notes/install-and-iteration.md](../../docs/dev-notes/install-and-iteration.md)）。

## 1.3.1

- **修复** `cordis.patch.yml` 的插入行 `name` 多了个尾随单引号（`dsh-prompt-library'`），
  导致从 GitHub 安装后 loader 按 `dsh-prompt-library'` 解析模块失败、插件起不来。
  现在改为 `name: dsh-prompt-library`，与安装后的真实包名一致。
- **变更** `package.json` 补 `repository.url` + `repository.directory: packages/prompt-library`，
  让插件市场 / 还原逻辑能把这颗 monorepo 子包对应回 `yuezm/dsh-plugins#path:/packages/prompt-library`。
- **新增** 支持通过 GitHub 链接安装，见 README「安装」与
  [docs/dev-notes/install-and-iteration.md](../../docs/dev-notes/install-and-iteration.md)。

## 1.3.0

- **新增** 提示词分组：面板按分组分区展示（可折叠），组头显示计数并支持【重命名】【删除分组】；
  顶部新增【新建分组】；新增/编辑对话框里可用下拉框选择归属分组。删除分组只把组内提示词
  退回「未分组」，不连带删除提示词。
- **新增** 自动分组：内置本地关键词分类规则（`CATEGORY_RULES` + `classifyPrompt`），
  按关键词长度加权打分，只处理「未分组」的条目，不覆盖用户手动指定的分组。顶部【自动分组】
  按钮可随时对未分组条目归类。
- **新增** 旧数据自动迁移：旧版 `{ prompts: [...] }` 没有 `groups` 字段；新版首次加载读到这种
  数据时自动归类并落盘，之后不再重复触发。即「根据当前提示词自动生成并分配分组」。
- **数据** `localStorage` 键不变（`dsh.prompt-library.v1`），值扩展为
  `{ prompts: [...{..., groupId?}], groups: [...{ id, name, createdAt }] }`，向下兼容旧值。
- **新增** 输入框 `/prompt` 弹窗改为**按分组排序**：每个选项带 `group: { name, label }`，
  渲染成吸顶分组标题；组内最新在前、未分组垫底。原先只按创建顺序平铺。
- **测试** 桩测试 74 → 107 项：新增「手动分组（新建/归类/重命名/删除）」「自动分组按内容归类」
  「旧数据首次加载自动迁移」「迁移只触发一次」「折叠分组下搜索自动展开」「`/prompt` 选项按分组排序」等断言。

## 1.2.1

- **修复** 提示词较多、列表滚到最下面时点【编辑】，编辑器却出现在页面顶部（视口之外），
  看起来像"点了没反应"。根因：编辑器此前是内联在搜索框下方的 `<section>`，位置固定在
  页面顶部，与触发按钮的滚动位置无关。
  修法：**新增/编辑改为视口居中的模态对话框**——固定定位 + 全屏遮罩，无论列表滚到哪里
  都能立即看到；打开时自动聚焦（新增→标题，编辑→正文），Esc 取消，Tab 在弹窗内循环，
  关闭后焦点回到触发按钮。
- **测试** 桩测试 68 → 74 项：新增"role=dialog 模态层""新增/编辑对话框标题""Esc 关闭"
  "不再使用内联 `.pl-editor`""`.pl-modal` 必须是 position:fixed" 等断言。

## 1.2.0

- **修复** 从【提示词】面板或 `/prompt` 选中提示词后，正文被插到了**另一个对话**
  （用户现场：`sa_protocol_library` 下"第一个对话"），当前光标所在的输入框反而没收到。
  根因：`pending` 是模块级单例且**不带目标会话**。当前 DSH（0.2.1-rc.3）同一时刻可能挂载
  多个 composer——主会话之外，嵌入式子代理对话、侧栏 chat 标签等都会渲染
  `conversation.composer.dock`。旧实现"谁先跑 effect 谁插入"，于是第一个挂载/先跑到的会话
  抢走了意图，把文字落进了别的草稿。
  修法：意图带 `sessionId`（面板用 `sessions` 服务查当前主会话，`/prompt` 用
  `onSelect` 的 `context.sessionId`），中继**只认领属于本会话的意图**，并且认领是
  **原子**的（`claimPending`），同一意图最多落笔一次。未指定目标的旧式意图只允许主会话
  （`retainedBy.mainView > 0`）认领。
- **新增** 备用中继挂到 `conversation.input.left`：新建/空白会话（hero）下
  `conversation.composer.dock` 不渲染，旧版因此无法把提示词插进空白对话框；现在两处中继
  共用同一份原子认领，hero 里也能插入。
- **测试** 桩测试 62 → 68 项：新增"非目标会话不认领""命令路径定向""hero 备用中继"等断言。

## 1.1.0

- **新增** 输入框内 `/prompt` 命令：popupSelect 列出提示词（最新在前），选中后插入草稿。
- **修复** `/prompt` 选中后，键入的 `/pro` 会残留在草稿里。
  根因：`onSelect` 里同步写意图 → 中继抢在框架之前插入文本、推进了草稿 `rev` →
  ui-commands 删除 token 时的 span CAS guard（`guard.span.draftRev !== this.rev`）失配 →
  删除被放弃。修法：命令路径把写意图延到下一个宏任务，让消费先完成；
  中继到那时才 `captureInsertion()`，拿到的是消费后的 `rev` 与光标。
  面板路径没有 token 要消费，因此不加延迟。
- **新增** 面板底部显示运行中的插件版本（应对"profile 里的副本可能是旧版"）。
- **测试** 桩测试 54 → 62 项：新增命令规格、写意图的时序契约、版本一致性。

## 1.0.0

- 左侧栏【插件】下方新增【提示词】面板：列表、新增、编辑、删除（二次确认）、搜索。
- 面板【使用】把提示词追加到当前对话草稿光标处，**不自动发送**，原草稿保留、可撤销。
- 数据存 `localStorage`（键 `dsh.prompt-library.v1`），由 Desktop 落盘到
  profile 的 `desktop-storage.json`，跨重启存活（已实测）。
- 插入由 `conversation.composer.dock`（session 作用域）的中继执行——root 作用域的面板
  拿不到 `inputActions`，且打开面板时会话界面会被卸载。
