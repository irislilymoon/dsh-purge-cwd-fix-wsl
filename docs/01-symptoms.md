# 01 · 现象

## 1. 用户看到什么

### 1.1 启动卡顿

在 WSL 里执行：

```bash
dsh web
```

终端很快打印：

```text
dsh web: http://127.0.0.1:3080/?token=<redacted>
dsh web: opening the default browser; pass --no-open to disable
[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)
```

浏览器页面也很快（<1 秒）显示出来。但：

- “新建会话”点不开；
- 历史记录加载不出来；
- 工作区选择、账号菜单、模型选择等按钮都没有反应；
- 页面看起来是“已经加载但完全冻结”。

等待约 **40–100 秒**后，页面会“刷新一次”（实际通常不是 `location.reload()`，
而是挂起的初始化请求终于结束、UI 重新渲染），然后恢复正常。

### 1.2 终端随后出现的账号错误

恢复前后，终端会打印类似：

```text
[deepseek-account] request failed {
  path: '/auth-api/v0/users/current',
  errorCode: 'no-response',
  aborted: true
}
[deepseek-account] request failed {
  path: '/auth-api/v0/users/current',
  errorCode: 'no-response',
  aborted: true
}
[deepseek-account] request failed {
  path: '/api/v0/users/get_user_summary',
  errorCode: 'no-response',
  aborted: true
}
```

特征：

- `errorCode: 'no-response'`：不是 401/403/429，也不是账号失效；
- `aborted: true`：30 秒的 `AbortSignal.timeout(30000)` 到点了；
- 失败的是 `getProfile` / `getBalance` / `getUnnotifiedBonuses` 这些**账号详情**，
  不是登录本身，也不是模型调用。

### 1.3 回退失败

在 dsh-purge 的“回退”菜单里选择“回退一次”或“回退上一轮”，按钮显示：

```text
回退失败: 没有清掉之前发送的内容
```

服务端 `/dsh-purge/rewind` 返回 `ok: false`（客户端只显示截断后的文字）。
这个问题和启动卡顿是**两个独立问题**，但经常一起出现。

### 1.4 Windows 上却秒开

同一账号、同样登录、同样配置，在 Windows 的 `dsh web` 上页面秒开。
很容易误判为“WSL 网络/代理有问题”。

真正原因：

- Windows 装的是 `@deepseek-ai/dsh 0.2.1-alpha.2`；
- alpha.2 的账号 UI 在普通 web 客户端里**直接不注册**：
  ```js
  if (!("dshDesktop" in globalThis)) return;
  ```
- 所以它根本不会在页面启动时发 `getProfile` / `getBalance` /
  `getUnnotifiedBonuses`，自然不存在“等 30 秒”的问题。

这不是“Windows 查得快”，而是“Windows 没查”。

## 2. 实测时间线（修复前）

隔离 `DSH_HOME` + 真实 profile + 真实账号，浏览器用 CDP 记录：

### 2.1 无 dsh-purge

| 时间 | 事件 |
| --- | --- |
| 0.6 s | 页面加载完成，UI 已显示，但停在“选择一个工作区” |
| 0.9 s | 客户端发出 `getProfile` / `getBalance` / `getUnnotifiedBonuses` |
| ~1.2 s | `session/create`、`llm/listProviders` 发出 |
| ~30 s | `getBalance` / `getUnnotifiedBonuses` 连接超时 |
| **43.9 s** | 账号请求结束，`session/create` 返回，UI 进入聊天界面 |
| ~45 s | 页面可用 |

### 2.2 带 dsh-purge（用户实际环境）

| 时间 | 事件 |
| --- | --- |
| 0.6 s | 页面加载完成 |
| 0.9 s | `/dsh-purge/update`、`/dsh-purge/status` 等开始 |
| 1.9 s | 3 个账号 RPC 发出；`session/create`、`llm/listProviders` 也发出 |
| 5.2 s | 第二轮 purge 请求（5 秒自动重扫） |
| 5–45 s | `/dsh-purge/update` 客户端在 45 秒超时；服务端继续跑到 ~66 秒 |
| 2–66 s | `/dsh-purge/rewind` 每 1.2 秒轮询；连接被占满时排队、abort、重试 |
| **~94–100 s** | 账号请求超时、`session/create` 返回，UI 可用 |

### 2.3 卡住时的 socket

对 dsh 进程（不是包装它的 shell）检查：

```bash
ss -tnp | grep '60\.204\.'
```

能看到类似：

```text
ESTAB 407 0 10.x.x.x:39842 60.204.2.4:443 users:(("node-MainThread",pid=...,fd=33))
ESTAB 638 0 10.x.x.x:39860 60.204.2.4:443 users:(("node-MainThread",pid=...,fd=32))
```

含义：

- TCP 已建立；
- `Send-Q` 有 407/638 字节没被对端确认；
- `Recv-Q` 为 0，说明没有收到响应；
- 不是 DNS 失败、不是连不上、也不是 401。

## 3. 复现方式

在隔离 `DSH_HOME` 中复现（不会动用户正在用的 3080 实例）：

```bash
cp -a ~/.dsh /tmp/dsh-repro-home
DSH_HOME=/tmp/dsh-repro-home dsh web --port 3099 --no-open
```

然后用浏览器打开打印出来的 URL（带 token），在 DevTools 的 Network 面板观察：

- `/api/account/getProfile`
- `/api/account/getBalance`
- `/api/account/getUnnotifiedBonuses`
- `/api/session/create`
- `/dsh-purge/update`
- `/dsh-purge/status`
- `/dsh-purge/rewind`

也可以直接运行本仓库的诊断：

```bash
node scripts/diagnose.mjs
```

它只读，不会改任何文件。

## 4. 如何排除其他问题

| 看起来像 | 实际不是 |
| --- | --- |
| 代理/Clash 问题 | dsh 进程没有代理环境变量；连接是直连；独立进程同请求 100–300 ms |
| WAF IP 问题 | 两个 WAF IP 单独请求都正常；强制 DNS 到另一个 IP 不改善 |
| token 失效 | profile 返回 `code: 0`；登录状态正常；失败的是余额/bonus |
| 账号被风控 | 同一个 token、同一组请求头、同样并发，独立 Node 进程正常 |
| dsh-purge `{{cwd}}` 修复失败 | 完全移除 dsh-purge 后仍会卡约 43 秒；cwd 修复只影响提示词 |
| 页面没加载 | 页面 0.6 秒就加载完；卡的是初始化 RPC |
| 真的刷新了页面 | `performance.now()` 没有重置；通常是 pending 初始化结束后的重渲染 |

更深入的证据见 [07-evidence.md](07-evidence.md)。
