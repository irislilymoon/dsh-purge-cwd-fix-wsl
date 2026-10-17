# 07 · 实测证据

本文件保存修复前后的关键测量，方便维护者复核，也方便其他人判断自己的环境
是否属于同一问题。

> 所有 token、账号信息、会话内容均已移除/泛化。以下数值来自隔离
> `DSH_HOME` + 真实 profile 的浏览器复现，不影响用户正在运行的实例。

## 1. 测试环境

| 项 | 值 |
| --- | --- |
| 环境 | WSL2，mirrored 网络，Windows 11 |
| Node | v26.10.0 |
| dsh | 0.2.1-rc.2 |
| dsh-purge | 1.1.71 |
| 账号 | 已登录（本地有 grant），同时保存 API key |
| 浏览器 | Windows Chrome headless，通过 CDP 驱动 |

Windows 原生对照：dsh 0.2.1-alpha.2，普通 `dsh web`，秒开。

## 2. 修复前：无 dsh-purge

### 2.1 请求时间线

```text
  844 ms  POST /api/settings/describe                 200  (4 ms)
  844 ms  POST /api/dynamicCordisRunner/syncInspectManifest 200
  844 ms  POST /api/credentials/describe               200
  845 ms  POST /api/session/modelCatalog               200  (84 ms)
  845 ms  GET  /open-in-app/apps                       200  (275 ms)
  847 ms  GET  /plugins/events                         (SSE)
  945 ms  POST /api/credentials/describe               200
  ...
 1191 ms  POST /api/session/create                     -> 11360 ms
 1195 ms  POST /api/llm/listProviders                 200  (13 ms)
 1196 ms  POST /api/llm/listConfigurableProviders     200  (11 ms)
 1218 ms  POST /api/credentials/describe               -> 11303 ms
```

UI 在 2/4/6/8/10 s 都停在“选择一个工作区”，12 s 左右输入框出现。

### 2.2 账号请求

账号 UI 在启动时发出：

```text
GET /auth-api/v0/users/current
GET /auth-api/v0/users/current       (第二次，来自 bonus 的 currentAccountId)
GET /api/v0/users/get_user_summary
```

- 其中一次 profile 很快成功（`code: 0`）；
- `get_user_summary` 和 `get_unnotified_bonuses` 30 秒超时；
- 客户端日志：

```text
[deepseek-account] request failed {
  path: '/api/v0/users/get_user_summary',
  errorCode: 'no-response',
  aborted: true
}
[deepseek-account] request failed {
  path: '/api/v0/users/get_unnotified_bonuses',
  errorCode: 'no-response',
  aborted: true
}
```

### 2.3 卡住时的 socket

```text
ESTAB  Send-Q=407  Recv-Q=0  <local>:39842  60.204.2.x:443
ESTAB  Send-Q=638  Recv-Q=0  <local>:39860  60.204.2.x:443
ESTAB  Send-Q=0    Recv-Q=0  <local>:39852  60.204.2.x:443
```

- TCP 已建立；
- 请求数据未得到对端确认/响应；
- 不是 DNS、不是连接拒绝、不是 401。

### 2.4 独立进程对照

同一 token、同一组头、同样的“两个 profile 并发”：

```text
control P+B+N     profile 200, balance 200, bonuses 200   ~200-500 ms
dsh pattern P+P+B 两个 profile 200, balance 200           ~90-240 ms
P+P               两个 profile 200                        ~130 ms
P+B               profile 200, balance 200                ~200 ms
```

使用 `x-dsh-auth-token` 的真实账号模型列表：

```text
GET https://api.deepseek.com/models  -> 200, 2 models, 83-257 ms
```

所以：

- 平台/端点/token/请求头都正常；
- 问题只在 **dsh 进程的少数连接** 上；
- 具体为什么被静默丢弃，未拿到平台侧日志，不能 100% 定论。

## 3. 修复前：带 dsh-purge

### 3.1 purge 请求

```text
  899 ms  GET /dsh-purge/update        -> 42750 ms (client 45s cap)
  900 ms  GET /dsh-purge/override      200 (662 ms)
  900 ms  GET /dsh-purge/own-servers   200 (664 ms)
  901 ms  GET /dsh-purge/status        200 (2045 ms)
 5540 ms  GET /dsh-purge/status        -> 65059 ms (ERR_ABORTED)
 5541 ms  GET /dsh-purge/update        -> 51092 ms (ERR_ABORTED)
```

### 3.2 rewind 轮询

```text
3028 ms  GET /dsh-purge/rewind -> 21367 ms ERR_ABORTED
4120 ms  GET /dsh-purge/rewind -> 22463 ms ERR_ABORTED
...
44379 ms GET /dsh-purge/rewind -> 66521 ms 200
45554 ms GET /dsh-purge/rewind -> 66523 ms 200
...
```

一次启动累计 **80+** 个 rewind 请求；在 66 秒左右一起返回。
服务端 handler 本身只是读 pending/draft，轻量；风暴来自连接被占满后的排队/重试。

### 3.3 账号/会话

账号 3 个 RPC 和 `session/create` 都在 ~1.9 s 发出，但到 ~94–100 s 才结束；
期间 `session/create`、`llm/listProviders` 也被拖住。

## 4. 修复后

### 4.1 启动时间

隔离实例 + 真实 profile：

| 场景 | 输入框出现 | session/create |
| --- | --- | --- |
| 无 dsh-purge | **~2 s** | 860 → 930 ms（约 70 ms） |
| 带 dsh-purge | **~4 s** | 2219 → 2281 ms（约 62 ms） |

purge 的 2 个初始 status 请求约 1.5 s；之后不再有 5 秒重扫。
启动阶段没有 `/api/account/*` 请求。

### 4.2 账号菜单按需加载

打开账号菜单后：

```text
/api/account/getUnnotifiedBonuses
/api/account/getProfile
/api/account/getBalance
```

菜单显示“退出登录”，登录状态正常。
（这些请求仍可能因 WSL 平台连接 30s 超时；只影响菜单，不阻塞主界面。）

### 4.3 rewind 修复前后

修复前：

```text
[rewind-debug] plan {
  lastSeq: 24, startSeq: 21, endSeq: 29, fromSeq: 21, text: "<user text>"
}
[rewind-debug] cut {
  fromSeq: 21, nodesBefore: [7,8,9,10,16,34], shadowed: [34]
}
[rewind-debug] after {
  left: [7,8,9,10,16,36],
  nodes: [7,8,9,10,16,36],
  derived: [
    system,
    user "<user text>",
    user runtime-context,
    user time-context,
    assistant "<reply quoting the same text>",
  ]
}
[rewind-debug] FAIL derived "<user text>"
```

- surface 检查通过（34 已移除）；
- derived 的整段文本搜索命中上一轮/助手回复，误报。

修复后：

```text
/ dsh-purge/rewind  POST 200
{
  "ok": true,
  "sessionId": "session-...",
  "parentId": "session-...",
  "text": "<user text>",
  "at": <timestamp>
}
```

按钮显示“回退”，上一句回到输入框。

### 4.4 CPU profile：flock 的 9 秒

修复前服务端 CPU profile（25 秒采样）：

```text
57.7%  (idle)
40.0%  getReport  node:internal/process/report:58
       <- loadBinding  node-addon-system/lib/flock.js:6
       <- errno
       <- tryLockExclusive
       <- acquire  dsh-session-persistence-jsonl/lib/index.js:671
```

`getReport` 约 9.3 秒，对应首次 session 创建的阻塞。
换成 `/proc/self/maps` 后该热点消失。

## 5. staging 应用/回滚验证

用真实原始备份搭建 staging 树：

```text
[ready] cwd / desktop / account / purge-startup / flock / rewind
apply -> 6 个文件 patched
diagnose -> 6 个 applied
apply --dry-run -> 0 file(s) would be patched
revert -> 6 个文件 restored
cmp 原始备份 -> 6 个全部一致
```

说明脚本的路径发现、标记应用、语法检查、备份、回滚都可迁移。

## 6. 证据复现命令（安全）

只读：

```bash
node scripts/diagnose.mjs
```

查看当前 dsh 进程到 platform 的连接（不打印 token）：

```bash
ss -tnp | grep '60\.204\.' | head
```

浏览器 Network 里观察：

- `/api/account/getProfile`
- `/api/account/getBalance`
- `/api/account/getUnnotifiedBonuses`
- `/api/session/create`
- `/dsh-purge/update`
- `/dsh-purge/status`
- `/dsh-purge/rewind`

不要在公开 issue 中贴 token、cookie、会话内容。

## 7. 仍未证明的部分

- WAF/网络层为什么只丢弃 dsh 进程的少数 platform 连接；
- 是否与 Node 26、WSL mirrored 网络、keep-alive/ALPN 的具体组合有关；
- 平台侧是否有反爬/限速策略介入。

这些问题需要平台侧日志或抓包才能定论。本仓库的修复不依赖该根因：
它让启动不再等待这些详情查询，因此无论连接层为什么卡，UI 都能先可用。
