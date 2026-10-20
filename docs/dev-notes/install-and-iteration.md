# 插件安装与迭代机制（实测）

本仓库开发 DSH 插件时，安装与迭代的真实行为。**全部为实测结论，不是推断**；
推断的部分已明确标注。

## 安装布局

通过侧栏【插件】→**添加插件**→ 本地绝对路径安装后：

| 位置 | 变化 |
|---|---|
| `profiles\web\package.json` | `dependencies` 增加包名；`dsh.profile.bundles` 增加包名 |
| `profiles\web\node_modules\@local\<name>` | Junction → `profiles\.generations\live\local+<name>+<version>+<hash>\node_modules\...` |
| `profiles\web\cordis.patch.yml` | **不记录**我们的行——行由 bundle 自带的 `cordis.patch.yml` 插入 |

注意 `.generations` 位于 `profiles\` 下，**不在** `profiles\web\` 下。

实测环境：`%APPDATA%\dsh-desktop\harness`，profile `web`。

## 硬链接（关键，反直觉）

generation 目录里的文件是**工作区文件的 NTFS 硬链接**——同一个 inode：

```
profiles\web\node_modules\@local\dsh-storage-probe\client.js   LinkType=HardLink
D:\Codes\github\dsh-plugins\packages\storage-probe\client.js   LinkType=(空)
两者 SHA-256 完全一致
```

用草稿文件对照实测两种写入方式：

| 写入方式 | 硬链接 | profile 里的副本 |
|---|---|---|
| harness 的 `edit` / `write` 工具（原子替换：临时文件 + 改名） | **断** | 保持旧内容 |
| PowerShell `[System.IO.File]::WriteAllText()`（就地截断写） | 保住 | **立即跟随更新** |

推论：`edit`/`write` 之后必须**先卸载再安装**；不重新安装的话，profile 里跑的一直是旧代码，
而工作区看起来"已经改好了"——这是最容易浪费时间的一种假象。

### 修正：`LinkType` 不是可靠判据（实测）

在真实的 prompt-library 插件上复核时发现：用 `edit` 改过工作区文件之后，
profile 里的副本**仍然报告 `LinkType=HardLink`**，但内容已经是旧的：

```
installed client.js  83B8DE8E…  LinkType=HardLink   不含后来加的 commandUi
workspace client.js  A8ED1F88…  内容一致: False
```

推测原因：硬链接计数不只来自工作区那一条（pnpm 的存储层可能也给同一 inode 加了链接），
所以"计数 > 1"并不代表"还连着工作区"。

**唯一可靠的判据是比内容**：

```powershell
$p = "$env:DSH_PROFILE_DIR\node_modules\@local\dsh-prompt-library\client.js"
(Get-FileHash $p).Hash -eq (Get-FileHash packages\prompt-library\client.js).Hash
```

## 迭代清单

改完代码后，按代价从低到高试：

1. 先比内容哈希，确认 profile 里的副本是不是你要的版本。不一致就**卸载重装**——
   这一步没有捷径，`edit`/`write` 之后的旧副本不会自己更新。
2. 版本一致但界面没变：刷新页面。
3. 仍无变化：重启 DSH Desktop（新的 JS 模块代）。
4. 若走了 PowerShell 就地写（硬链接保住），可跳过重装，直接从第 2 步开始试。

## 未验证的部分（不要当成结论）

- **客户端模块的重新加载时机**：官方文档说"替换已安装包需要重启才能加载新的 JS 模块代"。
  就地改内容后刷新页面是否足够，**未验证**。
- **generation 目录名里的 hash**：`local+<name>+<version>+<hash>`。就地改内容但不改 `version` 时，
  目录名里的 hash 与内容不再对应。是否会被校验/忽略，**未验证**。
- **Windows 硬链接在该文件系统上的持久性**：跨卷或非 NTFS 环境行为可能不同。

## 其它已确认的事实

- 插件管理器**不支持自动更新**：升级需先卸载再安装。
- 插件管理器的「添加插件」接受：包名（可带版本）、Git 地址、压缩包、**本地绝对路径**。
- 安装的包必须带 `cordis.patch.yml`（`dsh.bundle.patch`），否则在安装前就被拒绝。
