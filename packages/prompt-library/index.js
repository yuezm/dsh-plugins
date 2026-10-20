/**
 * 提示词库的 Host 半侧。
 *
 * 提示词库完全活在浏览器侧：数据存客户端 `localStorage`（由 Desktop 落盘到 profile 的
 * `desktop-storage.json`），插入走会话的 `inputActions`。因此 Host 侧不需要任何行为——
 * 它存在的意义只是让这个包成为一个合法的 bundle。
 */
export function apply() {}
