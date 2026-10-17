# 06 · 排障 / FAQ

## 1. `diagnose` 显示 `missing` 或 `missing-file`

**含义**：目标文件的标记与 known-good 版本不一致，或文件不存在。脚本不会写文件。

处理：

1. 确认 `dsh --version` 和 dsh-purge 版本；
2. 确认 `--dsh-root` 指向的是**正在运行的**那份 dsh；
3. 如果版本不同，按 [05-portability.md](05-portability.md) 适配；
4. 不要手工猜位置、不要 `--force`。

`desktop` 是 optional；它 `missing` 不影响 WSL 使用。

## 2. `apply` 打印 `ABORT`，没有写文件

这是**安全行为**：required 标记不匹配。把完整输出发给维护者/Agent，
按 [05-portability.md](05-portability.md) 适配。不要反复运行。

## 3. `apply` 打印 `FAILED`

脚本会尝试恢复本次已写入的文件。检查：

```bash
ls -la <file>.dsh-wsl-fix.bak
node --check <file>
```

如果恢复不完整，用 `revert.mjs`；仍不行则从 `*.dsh-wsl-fix.bak` 手工恢复。
把错误信息（不含 token）反馈。

## 4. 重启后启动仍然慢

先确认：

```bash
node scripts/diagnose.mjs
node scripts/apply.mjs --dry-run
```

- 6 项 `applied` 且 0 个待改，说明补丁在文件里；
- 是否真的重启了 dsh web（不是只刷新页面）；
- 是否用了**旧页面缓存**：新开标签/禁用缓存再测；
- 浏览器 Network 里启动阶段还有哪些慢请求？

如果仍然是 40–100 秒，把 Network 慢请求和 dsh 终端日志按
[AGENT_PROMPT.md](../AGENT_PROMPT.md) 的模板反馈。不要盲目回滚。

## 5. 账号菜单的余额/资料还是 30 秒失败

**已知取舍**，不是启动修复失败。

原因：WSL 到 `platform.deepseek.com` 的连接卡顿仍然存在；本仓库只把账号详情
从启动阻塞改成按需加载。

影响：

- 只影响账号菜单里的资料/余额/bonus；
- 不影响登录（本地凭据）、模型调用、新会话、历史、回退。

可以：

- 关掉菜单重开、稍后重试；
- 使用已保存的 API key 的 `deepseek-official` provider；
- 不要因为这一项回滚启动修复。

## 6. 账号菜单没有“退出登录”/显示未登录

先确认 `.credentials.yaml` 有 grant；不要打印内容。可能在网页打开前就在别处
退出登录，或 token 已失效。

本仓库没有修改凭据存储；如果是登录状态问题，按 dsh 正常登录流程处理。

## 7. dsh-purge 面板的更新信息为空

**预期**：页面加载时不再自动 `/dsh-purge/update`。点面板里的“检测更新”
即可手动查询。手动按钮、切换版本、应用/还原后的刷新都保留。

## 8. rewind 仍然失败

### 先看完整错误

按钮上的文字可能被截断。查看按钮的 `title` 属性或浏览器控制台：

- `没有清掉之前发送的内容`：surface/derived 检查；
- `没有可回退的上一句`：当前会话没有可回退的用户消息；
- `回合还在进行，请先点停止再回退`：模型还在运行/队列未关；
- 其他：把完整错误和 dsh 终端日志保存。

### 确认补丁已应用

```bash
grep -n "Math.min(bounds.startSeq, last.seq)" <purge>/lib/rewind.js
grep -n "surface nodes are the source of truth" <purge>/lib/rewind.js
```

### 如果还是 “没有清掉之前发送的内容”

1. 这个会话是否**之前多次失败回退**，留下空 rewind 标记？
   新建一个会话，发一条唯一内容，等回复结束后再试“回退一次”；
2. 是否在“回合进行中”点了回退？先停止，等 `turn/end`，再试；
3. 是否点的“回退上一轮”而这一轮没有可回退的主/子代理轮次？
   先试“回退一次”；
4. 把完整按钮 `title`、浏览器 Network 的 `/dsh-purge/rewind` 响应、
   dsh 终端最近 50 行（去掉 token）反馈。

### 回退一次 vs 回退上一轮

- **回退一次**：当前会话的最后一条用户消息 + 这一轮助手回复；
  如果当前是子代理，只回退这个子代理。
- **回退上一轮**：主会话 + 这一轮启动的所有子代理，一起回退，再回主会话。

两者都会把最后一条用户消息放回输入框；下一次发送不带被撤掉的回复。

## 9. dsh-purge 的 rewind 轮询会不会影响性能

1.2 秒一次 `GET /dsh-purge/rewind`，服务端只是 `getPending()`/`takeDraft()`，
正常很轻。启动修复后它不再是问题；本仓库**没有删除**它，因为命令/子代理
触发的回退需要它来发现 pending draft。

如果以后要优化，正确方式是：

- 在收到 `/rewind` 命令/rewind 工具调用事件后做**一次性查询**；
- 或只在 agent 回合进行中/回退菜单打开时轮询；
- 不要在没有信号的情况下直接关闭，否则命令/子代理的自动回填可能失效。

## 10. 我想完全回退

```bash
node scripts/revert.mjs
```

然后重启 dsh web。

说明：

- 会恢复本仓库/早期手工补丁的备份；
- 上游 `{{cwd}}`/desktop 修复如果没有本仓库备份，会保留；
- 想完全回退 dsh-purge 补丁，使用上游 dsh-purge-cwd-fix 的 rollback/卸载流程；
- 想卸载 dsh-purge，使用 dsh 的插件管理/上游脚本。

## 11. 权限/只读文件

- dsh 安装在 `npm root -g` 下，可能需要写权限；
- 如果 `apply` 报 `EACCES`，用有权限的用户运行，或修复 npm 全局目录权限；
- 不要 `chmod -R 777`；
- `DSH_HOME` 下的 dsh-purge 文件一般属于当前用户。

## 12. 我在 WSL 之外（Windows 原生）

本仓库的脚本/路径/重启方式面向 WSL/Linux。Windows 原生请用上游
**dsh-purge-cwd-fix** 的 PowerShell 脚本。`desktop.js` 的 registry 补丁是
跨平台的（PowerShell 只在 Windows 执行），但 WSL 启动/账号/flock 补丁不适用。

## 13. 我用了 Node 24/别的版本

本仓库在 Node 26.10.0 验证。Node 24 下 flock 的 `getReport` 可能不慢，
账号/purge/rewind 补丁仍可能适用，但必须：

```bash
node scripts/diagnose.mjs
```

如果标记匹配，可以 apply；如果 missing，按 05 适配。不要假设 Node 版本
一定兼容。

## 14. 会不会改我的会话/凭据/设置

不会。脚本只改 6 个白名单源码文件；不读取/写入 `.credentials.yaml`、
`sessions/`、`storages/`、`settings.yaml`、端口、代理。备份也只写在目标文件旁。

## 15. 我该保留哪些日志/信息

反馈问题时保留：

- `node scripts/diagnose.mjs --json`；
- `apply`/`revert` 的完整输出；
- 浏览器 Network 慢请求（URL、状态、耗时）；
- dsh 终端最近 50 行（**移除 token**）；
- rewind 按钮的完整 `title` 和 `/dsh-purge/rewind` 响应；
- 操作系统/WSL/Node/dsh/purge 版本。

不要上传 `.credentials.yaml`、token、cookie、会话内容。
