# HANDOFF — 本次修复交接说明

> 这个文件夹是给用户复制/上传 GitHub 的**交接仓库**。
> 本文件说明它从哪来、当前环境状态、如何上传、如何在新机器复现。
> 仓库本身不包含任何 token、凭据、会话内容或安装目录备份。

## 1. 这个仓库是什么

`dsh-purge-cwd-fix-wsl`：上游 **dsh-purge-cwd-fix** 的 WSL 版本与后续修复。

包含：

1. 上游 `{{cwd}}` 提示词变量修复（patch + cwd helper 插入块）；
2. 上游 PowerShell registry 扫描守卫（可选 patch）；
3. 账号 UI 详情按需加载；
4. dsh-purge 页面加载不再自动更新/5 秒重扫；
5. flock 快速 libc 检测（去掉 9 秒 `process.report.getReport()`）；
6. rewind rc.2 兼容（重复文字误报 + 用户消息早于 turn/start）。

详细说明从 `README.md` 开始。

## 2. 来源环境与已验证版本

- 环境：WSL2，Windows 11；
- Node：v26.10.0；
- `@deepseek-ai/dsh`：0.2.1-rc.2；
- `dsh-purge`：1.1.71；
- 账号：已登录（本地 grant），同时有 API key；
- dsh-purge 的 `{{cwd}}` 修复此前已由上游仓库应用。

验证结果：

- 修复前：启动 40–100 秒不可用；
- 修复后：无 purge 约 2 秒、带 purge 约 4 秒出现输入框；
- 启动阶段无 `/api/account/*` 详情请求；
- 账号菜单按需加载，登录状态保留；
- “回退一次”成功，上一句回到输入框；
- staging apply/revert 后 6 个文件与原始备份逐字节一致。

## 3. 当前机器上的状态

- 修复文件已应用到 WSL 安装；
- 备份在目标文件旁：
  - `.dsh-wsl-fix.bak`（本仓库新应用时创建）
  - 以及早期的 `.account-lazy.bak` / `.flock-libc.bak` /
    `.purge-lazy.bak` / `.rewind-seq.bak` 等兼容备份；
- `scripts/diagnose.mjs` 应显示 6 项 `applied`；
- 重启 `dsh web` 后生效；脚本不会杀进程。

如果要在当前机器再次确认：

```bash
cd dsh-purge-cwd-fix-wsl
node scripts/diagnose.mjs
node scripts/apply.mjs --dry-run
```

期望：`applied`、`0 file(s) would be patched`。

## 4. 上传 GitHub 前的检查清单（用户操作）

仓库当前**已经有 `.git`**（由你初始化/上传过）；本工具没有执行任何
`git add` / commit / remote / push 操作。以下命令适用于已有仓库；
如果是全新的空目录，才需要先 `git init`。

上传前：

- [ ] 不要在仓库里放 `node_modules/`、`*.bak`、`*.log`、`sessions/`、
      `storages/`、`.credentials.yaml`；
- [ ] 运行一次 secret/绝对路径扫描（见下）；
- [ ] 确认 `LICENSE`、`LICENSE.upstream`、`NOTICE.md` 保留；
- [ ] 在 README 的 Credits 里补上你实际使用的上游仓库 URL（如适用）；
- [ ] 确认 `README.md` 的 known-good 版本与你测试的一致；
- [ ] 不要上传 `C:\Users\<user>\...` 或 `/home/<user>/...` 这类本机路径
      （仓库文档使用 `<DSH_HOME>`/`~/.dsh` 占位）。

建议的扫描命令：

```bash
grep -RIn --exclude-dir=.git -E 'dsh-auth-|x-dsh-auth-token|token=|Bearer [A-Za-z0-9]' .
grep -RIn --exclude-dir=.git -E '/home/[^/]+/|C:\\\\Users\\\\' .
```

发现真实 token/凭据/用户名绝对路径时，删掉再上传。

GitHub 操作示例（由你执行，本工具未执行）：

```bash
# 已有 .git：不需要 git init
git add .
git commit -m "dsh-purge-cwd-fix (WSL): fast startup + rewind compatibility"
git branch -M main
git remote add origin <your-repo-url>   # 已配过 remote 则跳过
git push -u origin main
```

> 当前 `git status` 显示 `README.md` 已修改、许多文件仍为 untracked；
> `git add .` 会把 `docs/`、`scripts/`、`patches/` 等一起加入。
> `.gitignore` 已排除 `*.bak`、日志、`sessions/`、`storages/`、凭据。

## 5. 其他人 clone 后怎么用

1. `cd dsh-purge-cwd-fix-wsl`
2. `node scripts/diagnose.mjs`
3. 全部 `ready` 或部分 `applied` 后：
   `node scripts/apply.mjs --dry-run`
4. `node scripts/apply.mjs`
5. 重启 `dsh web`
6. 按 `docs/04-verification.md` 验收
7. 失败：`node scripts/revert.mjs`

把 `AGENT_PROMPT.md` 整段交给 Agent，即可按同一契约执行；它被要求不自动重启、
不杀进程、不碰凭据/session、版本不匹配就停止。

## 6. 可迁移性要点

- 不写死用户名：`npm root -g`、`$DSH_HOME`、`~/.dsh`、`--dsh-root`、
  `--dsh-home`、`--profile`；
- 补丁按唯一标记，不按行号；
- version marker 不匹配时 apply **中止且不写文件**；
- 支持 staging 树测试（`--dsh-root`/`--dsh-home` 指向副本）；
- 更新 dsh/dsh-purge 后重新运行 `apply.mjs`；版本不同按
  `docs/05-portability.md` 适配。

## 7. 已知限制

- WSL 到 `platform.deepseek.com` 的连接卡顿没有从根上修复；
  账号菜单的余额/资料仍可能 30 秒超时，但不再阻塞启动。
- 旧失败回退可能留下空 rewind 标记；建议在新会话验证回退。
- 上游 `{{cwd}}` 修复面向 1.1.71；升级插件后需要重新检查锚点。
- 本仓库不包含第三方源码，只是兼容性补丁/脚本/文档。

## 8. 维护者备注

- 脚本白名单与标记：`scripts/lib.mjs` 的 `patchDefs()`；
- 上游 cwd 插入块：`patches/cwd-variable.insert.js`；
- 手工步骤与前后代码：`docs/03-fixes.md`；
- 实测证据：`docs/07-evidence.md`；
- staging 全链路测试步骤：`docs/05-portability.md` 第 5 节。

任何对补丁锚点的修改，都应在 staging 树跑一遍
“全新 → apply → applied → revert → 哈希一致”。
