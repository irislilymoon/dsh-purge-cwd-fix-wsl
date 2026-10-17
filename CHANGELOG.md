# Changelog

## 1.0.0 — 2026-10-17

首个 WSL 交接受理版本。

### 包含

- 上游 `dsh-purge-cwd-fix` 的 `{{cwd}}` 修复与 PowerShell registry 守卫
  （patch 文件 + cwd 插入块）；
- 账号 UI 详情按需加载（保留登录/余额查询逻辑）；
- dsh-purge 页面加载不再自动 `/dsh-purge/update`、不再 5 秒后重扫 `/status`；
- flock 用 `/proc/self/maps` 判断 glibc/musl，替代 9 秒的
  `process.report.getReport()`；
- rewind rc.2 兼容：`fromSeq` 取 `min(turnStart, lastUserPrompt)`；
  去掉整段 derived 文本的误报检查，保留 surface 节点检查；
- `scripts/diagnose.mjs` / `apply.mjs` / `revert.mjs`，路径自动发现、
  版本标记门禁、备份、语法检查、幂等、staging 验证；
- 详细文档：现象、根因、修复、验收、迁移、排障、证据。

### 已验证

- WSL2，Node 26.10.0，dsh 0.2.1-rc.2，dsh-purge 1.1.71；
- 无 purge 启动约 2 秒，带 purge 约 4 秒（修复前 40–100 秒）；
- 启动阶段无账号详情请求；账号菜单按需加载；登录状态保留；
- “回退一次”成功，上一句回到输入框；
- staging apply/revert 后 6 个文件与原始备份逐字节一致。

### 已知限制

- WSL 到 platform.deepseek.com 的连接卡顿本身未修复；账号菜单的余额/资料
  仍可能 30 秒超时，但不再阻塞启动。
- 补丁针对上述版本；升级 dsh/dsh-purge 后标记可能变化，需重新运行
  `apply.mjs` 或按 `docs/05-portability.md` 适配。
- 旧失败回退可能留下空 rewind 标记；建议在新会话验证。
