# 变更记录

版本写在两处：`package.json` 的 `version` 与 `client.js` 的 `PLUGIN_VERSION`。
桩测试会断言两者一致，防止漂移。**面板底部会显示运行中的版本**。

DSH 的插件管理器没有版本选择器，也不提供升级：升级 = 卸载后重新安装。
所以"现在装的是哪一版"只能靠面板底部自报的版本号确认，或比内容哈希（见
[docs/dev-notes/install-and-iteration.md](../../docs/dev-notes/install-and-iteration.md)）。

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
