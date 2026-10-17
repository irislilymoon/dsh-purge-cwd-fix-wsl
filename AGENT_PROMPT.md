# Agent 执行契约：WSL dsh 快速启动 + rewind 修复

> 把本文件整段贴给执行修复的 Agent。你是修复执行者，不是代码作者。
> 目标：在用户的 WSL 环境里安全地应用本仓库的补丁，并完成验收。
> 如果任何前提不满足，**停止并报告**，不要猜、不要强行改。

## 0. 先读

按顺序阅读：

1. `README.md`
2. `docs/02-root-cause.md`
3. `docs/03-fixes.md`
4. `docs/04-verification.md`
5. `docs/05-portability.md`（路径/版本不确定时）
6. `docs/06-troubleshooting.md`（失败时）

## 1. 硬约束（必须遵守）

- **只修改** `scripts/apply.mjs` 会修改的 6 个文件；禁止改 session、凭据、settings、
  storages、端口、代理、AGENTS.md、profile 的 package.json。
- **不要**自动重启、kill 或 pkill `dsh web`。重启由用户执行。
- **不要**运行 `scripts/revert.mjs`，除非 apply 失败或用户明确要求回滚。
- **不要**访问 GitHub、上传、提交或推送。用户自己上传。
- **不要**使用 `--force` 或手工替换标记；版本不匹配就停止。
- 不要读取/打印 `.credentials.yaml`、token、会话内容。
- 不要删除任何日志、备份、会话。
- 所有命令都在仓库根目录执行。

## 2. 环境检查（只读）

```bash
node -v
dsh --version
test -f ~/.dsh/profiles/web/node_modules/dsh-purge/package.json && echo purge-present
```

期望：

- WSL2；
- Node 26.x（已知 26.10.0）；
- dsh `0.2.1-rc.2`；
- dsh-purge `1.1.71`。

如果 dsh 路径不是全局 npm 位置，记录真实路径；后续用 `--dsh-root`。
如果 `dsh`/`dsh-purge` 版本不同，**不要继续 apply**，跳到第 6 节报告。

## 3. 只读诊断

```bash
node scripts/diagnose.mjs
```

必须检查输出：

- `dsh`、`DSH_HOME`、`dsh-purge` 路径正确；
- 6 个补丁状态：
  - `applied`：已修复；
  - `ready`：可以应用；
  - `missing` / `missing-file`：标记不匹配或文件缺失；
  - 可选 `desktop` 补丁 `missing` 不影响 WSL。
- 3080 是否在运行（只提示，不杀）。

如果任何一个**非 optional** 补丁是 `missing`/`missing-file`：

```text
STOP。版本/文件不匹配，未写任何文件。
把完整 diagnose 输出报告给用户，并建议按 docs/05-portability.md 适配。
```

如果全部是 `applied`：跳到第 5 节（只需重启/验收）。
如果存在 `ready`：继续第 4 节。

路径发现失败时：

```bash
node scripts/diagnose.mjs --dsh-root /path/to/@deepseek-ai/dsh --dsh-home /path/to/.dsh
```

## 4. 预览并应用

```bash
node scripts/apply.mjs --dry-run
```

确认输出 `Dry run: N file(s) would be patched`，且没有 `ABORT`。

```bash
node scripts/apply.mjs
```

期望：

- 每个补丁打印 `patched <id>: <file>`；
- 结束时 `Done. Restart dsh web...`；
- 退出码 0。

如果输出 `ABORT`：没有任何文件被写；停止并报告。
如果输出 `FAILED`：脚本会尝试恢复本次写入；检查文件/备份，报告给用户，不要反复重试。

**不要在 apply 后自行重启。** 输出给用户：

```text
修复文件已应用。请到正在运行 dsh web 的终端按 Ctrl+C，然后重新执行：
  dsh web
重启后再让我验收。
```

## 5. 验收（用户重启后）

严格按 `docs/04-verification.md` 执行。至少检查：

1. `node scripts/apply.mjs --dry-run` 显示 `0 file(s) would be patched`；
2. 页面在 **2–4 秒**内出现输入框（带 dsh-purge 约 4 秒），不再长时间停在
   “选择一个工作区”；
3. 浏览器 Network 面板中，页面启动阶段**没有** `/api/account/getProfile`、
   `/api/account/getBalance`、`/api/account/getUnnotifiedBonuses`；
4. 打开账号菜单：能看到“退出登录”，按需加载资料/余额；
5. 在一个有用户消息的会话点“回退一次”：上一句回到输入框，按钮不报错；
6. dsh-purge 面板的“检测更新”按钮仍可用；
7. 终端启动日志没有大量 `no-response` 账号失败（打开账号菜单后的失败另计）。

如果 1–6 通过：报告成功。第 7 项若只有账号菜单打开后的余额失败，说明已知的
WSL 平台连接问题仍在，但启动修复成功；不要因此回滚，说明取舍即可。

## 6. 失败/中止时的报告模板

```text
结论：<成功 / 中止 / 需要人工>
环境：WSL <distro>, Node <version>, dsh <version>, dsh-purge <version>
路径：dsh=<...>, DSH_HOME=<...>
diagnose 摘要：
  <粘贴 6 行状态>
apply 输出：
  <粘贴关键输出，不要贴 token/凭据>
失败点：
  - <补丁 id/文件/错误>
已写文件/备份：
  - <file> -> <backup>
建议：
  - <按 docs/05 或 docs/06 的具体章节>
```

## 7. 回滚（仅在需要时）

只有以下情况才建议回滚：

- apply 失败且脚本未能恢复；
- 用户明确要求；
- 验收出现启动/回退回归，且确认由本仓库补丁导致。

```bash
node scripts/revert.mjs
```

然后让用户重启 `dsh web`。回滚会优先使用 `.dsh-wsl-fix.bak`，其次识别
`.account-lazy.bak`、`.flock-libc.bak`、`.purge-lazy.bak`、`.rewind-seq.bak`
等兼容备份。上游 `{{cwd}}` 修复若没有本仓库备份，会保留。

## 8. 绝对不要做

- 不要 `rm -rf ~/.dsh`、不要删除 sessions/storages/credentials；
- 不要改端口/代理/网络配置；
- 不要为了“快速恢复”直接关闭账号 UI 或 rewind 轮询；
- 不要把 token、cookie、会话内容贴到输出/报告；
- 不要上传 GitHub；
- 不要在没有备份的情况下手工编辑这些文件。
