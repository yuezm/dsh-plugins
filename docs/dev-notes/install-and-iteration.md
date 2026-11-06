# 插件安装与迭代机制（实测）

本仓库开发 DSH 插件时，安装与迭代的真实行为。**全部为实测结论，不是推断**；
推断的部分已明确标注。

## 安装布局

通过侧栏【插件】→**添加插件**→ 本地绝对路径安装后：

| 位置 | 变化 |
|---|---|
| `profiles\web\package.json` | `dependencies` 增加包名；`dsh.profile.bundles` 增加包名 |
| `profiles\web\node_modules\<包名>` | Junction → `profiles\.generations\live\local+<name>+<version>+<hash>\node_modules\...`（包名带 scope 时路径才会有 `@scope\` 这一层；本包现已改名为 `dsh-prompt-library`，不再用 `@local/`） |
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

## 通过 GitHub 链接安装（monorepo 子包，已实测）

本仓库是 monorepo，插件在 `packages/prompt-library`，**仓库根目录没有 `package.json`**。
所以不能直接装 `github:yuezm/dsh-plugins`（根不是包），必须用 pnpm 的 `#path:` 子目录语法：

```
github:yuezm/dsh-plugins#path:/packages/prompt-library
```

- 已用 pnpm 11.4.0 实测通过：解析到 `dsh-prompt-library 1.3.0`，安装后的目录里
  `package.json`、`cordis.patch.yml`、`index.js`、`client.js` 都在。
- 需要版本/分支：`github:yuezm/dsh-plugins#v1.3.1&path:/packages/prompt-library`
  （`#` 后是 tag/分支/commit，`&path:/子目录` 还是同一个包）。
- **不要**把网页地址 `https://github.com/yuezm/dsh-plugins/tree/master/packages/prompt-library`
  直接喂给 pnpm——它不是合法的 pnpm target，会卡住去拉 tarball。插件市场（dshmarket）
  的目录项支持 `/tree/` 解析成 `github:repo#path:/sub`，但内置「添加插件」输入框走的是
  pnpm spec，用上面那条 `github:...#path:/...`。

### 子包能被 GitHub 安装的前提（改造点）

1. 子目录 `package.json` 里 `dsh.bundle.patch` 指向随包发布的 `cordis.patch.yml`（已有）。
2. `cordis.patch.yml` 的插入行 `name` 必须是**安装后的真实包名**。Git 安装不套 `@local/`
   前缀，包名就是 `dsh-prompt-library`，所以 patch 里写 `name: dsh-prompt-library`
   （历史 bug：曾误写成 `dsh-prompt-library'`，多一个单引号，装完 loader 解析不到模块）。
3. 包目录要随 git tarball 一起被 pack 进去：没有 `files` 白名单时默认整目录打包，
   `cordis.patch.yml`/`index.js`/`client.js` 都会带上；若以后加了 `files`，记得把它们列全。
4. 补 `repository.url` + `repository.directory`，插件市场 / 本地还原逻辑才能把子包认回
   `yuezm/dsh-plugins#path:/packages/prompt-library`。

> 安装来源不同，profile 里的依赖名不同：本地绝对路径安装用声明名（现在是
> `dsh-prompt-library`，不是旧的 `@local/...`）；Git 安装同样是 `dsh-prompt-library`。
> 两者的 `cordis.patch.yml` 必须对齐同一个名字。
