# dsh-purge-cwd-fix (WSL)

> **一句话**：修复 WSL 上 `dsh web` 启动后“页面已显示但整页冻结 40–100 秒”、
> 账号详情请求超时，以及 dsh-purge “回退失败：没有清掉之前发送的内容” 的
> 兼容性问题。保留账号登录、余额按需查询、rewind 和上游 `{{cwd}}` 修复。
>
> 本仓库是上游 **dsh-purge-cwd-fix** 的 WSL 版本与后续完善。只包含补丁脚本、
> 兼容性 patch 和文档，不重新分发 dsh、dsh-purge 或 DeepSeek Harness 源码。

**已验证版本（known-good）**

| 组件 | 版本 |
| --- | --- |
| 环境 | WSL2（Ubuntu/Debian 系）；mirrored 网络已实测，NAT 未单独验证 |
| Node | v26.10.0 |
| `@deepseek-ai/dsh` | **0.2.1-rc.2** |
| `dsh-purge` | **1.1.71** |
| 浏览器 | Windows Chrome（headless + CDP 实测），普通 Chromium 亦可 |

**修复前 vs 修复后（同环境实测）**

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 页面可用时间 | 40–100 秒 | **2–4 秒** |
| `session/create` | 43.9–94 秒 | **60–70 ms** |
| 启动账号详情请求 | 3 个，30 秒超时 | **0 个**（打开菜单才查） |
| rewind | “没有清掉之前发送的内容” | **成功，上一句回到输入框** |
| 登录/模型 provider | 正常 | **正常** |
| 手动“检测更新” | 正常 | **正常**（不再自动跑） |

---

## 目录

- [0. 一分钟结论](#0-一分钟结论)
- [1. 适用与不适用](#1-适用与不适用)
- [2. 现象（详细）](#2-现象详细)
- [3. 根因（详细）](#3-根因详细)
- [4. 解决办法（逐项）](#4-解决办法逐项)
- [5. 修复效果与验证数据](#5-修复效果与验证数据)
- [6. 快速开始（人）](#6-快速开始人)
- [7. 快速开始（Agent）](#7-快速开始agent)
- [8. 版本与可迁移性](#8-版本与可迁移性)
- [9. 回滚与安全边界](#9-回滚与安全边界)
- [10. FAQ](#10-faq)
- [11. 文档索引 / Credits / License](#11-文档索引--credits--license)

---

## 0. 一分钟结论

问题不是 dsh-purge 的 `{{cwd}}` 修复坏了，也不是代理或“WSL 网络不通”。
它是 **四个独立问题叠加** 的结果：

1. **rc.2 把账号 UI 开放到了普通 web 客户端**（alpha.2 只在桌面端注册）。
   web 页面启动时自动请求 `getProfile` / `getBalance` / `getUnnotifiedBonuses`；
   在 WSL 下这些 `platform.deepseek.com` 连接可能卡 30 秒，导致
   `session/create` 和整页初始化排队。
2. **dsh-purge 页面加载时自动检查更新**（客户端超时 45 秒），并在挂载 5 秒后
   自动重扫 65 个补丁（约 7 秒）。它们和账号请求叠加，把约 43 秒放大到约 100 秒。
3. **JSONL 会话持久化的文件锁**用 `process.report.getReport()` 判断 glibc/musl，
   在 Node 26/WSL 上约 **9 秒**，且正好发生在首次 `session/create` 的锁加载路径。
4. **dsh-purge rewind 的二次检查误报**：清掉 surface 节点后，又在整段 derived
   历史里搜索用户文字；同一句话出现在上一轮或助手回复里时，误判
   “没有清掉之前发送的内容”。

修复策略：**不关闭账号 UI、不降级、不改网络/代理**，而是：

- 账号详情从“启动阻塞”改为“打开账号菜单/设置时按需加载”；
- dsh-purge 不再在页面加载时自动更新/5 秒重扫；手动功能保留；
- flock 用 `/proc/self/maps` 廉价判断 libc；
- rewind 保留 surface 节点检查（真正决定模型历史），去掉整段文本误报检查，
  并兼容 rc.2 中“用户消息早于 turn/start”的事件顺序；
- 保留上游 `{{cwd}}` 修复。

---

## 1. 适用与不适用

### 适用

- WSL2 中通过 `npm i -g @deepseek-ai/dsh` 安装，`dsh web` 在浏览器里打开；
- 使用 DeepSeek 账号登录（`.credentials.yaml` 中有 grant），也可能同时存 API key；
- 安装了 `dsh-purge`，希望保留登录、余额、rewind、手动检测更新；
- 症状是“页面先加载出来，但新建会话/历史/账号菜单全部无反应，约 1 分钟后恢复”。

### 不适用 / 需要适配

- **Windows 原生 PowerShell 安装**：请使用上游 `dsh-purge-cwd-fix` 的 Windows 脚本；
  本仓库面向 WSL/Linux；
- **不是 `0.2.1-rc.2` / `dsh-purge 1.1.71`**：标记可能不匹配。脚本会**中止且不写文件**，
  见 [docs/05-portability.md](docs/05-portability.md)；
- **完全不用账号 UI、只用 API key**：仍可运行，但账号按需加载的收益较小；
- **希望“WSL 下余额查询也一定秒回”**：本仓库只保证“不阻塞启动”。
  平台连接本身的卡顿是另一个问题，见 [docs/06-troubleshooting.md](docs/06-troubleshooting.md)。

---

## 2. 现象（详细）

### 2.1 启动冻结

```bash
dsh web
```

终端很快输出：

```text
dsh web: http://127.0.0.1:3080/?token=<redacted>
dsh web: opening the default browser; pass --no-open to disable
[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)
```

浏览器页面也很显示得很快（<1 秒），但：

- “新建会话”点不开；
- 历史记录加载不出来；
- 工作区选择、账号菜单、模型选择等按钮都没有反应；
- 页面看起来“已经加载，但完全冻结”。

等待约 **40–100 秒**后，页面会“刷新一次”（通常不是 `location.reload()`，
而是挂起的初始化 Promise 终于结束、UI 重渲染），然后恢复正常。

### 2.2 终端随后出现的账号错误

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
  不是登录，也不是模型调用。

### 2.3 回退失败

在 dsh-purge 的“回退”菜单里选择“回退一次”或“回退上一轮”：

```text
回退失败: 没有清掉之前发送的内容
```

服务端 `/dsh-purge/rewind` 返回 `ok: false`，客户端把错误显示到按钮上（会截断）。
这是**独立于启动卡顿**的第二个问题。

### 2.4 Windows 上却秒开

同一账号、同样登录、同样配置，Windows 的 `dsh web` 秒开。很容易误判为
“WSL 网络/代理有问题”。

真实原因：

- 对照环境 Windows 装的是 `@deepseek-ai/dsh 0.2.1-alpha.2`；
- alpha.2 的账号 UI 在普通 web 客户端里**直接不注册**：
  ```js
  if (!("dshDesktop" in globalThis)) return;
  ```
- 所以它根本不会在页面启动时发 `getProfile` / `getBalance` /
  `getUnnotifiedBonuses`，自然不存在“等 30 秒”的问题。

**这不是“Windows 查得快”，而是“Windows 没查”。**

### 2.5 实测时间线

隔离 `DSH_HOME` + 真实 profile + 真实账号，浏览器 CDP 记录。

**无 dsh-purge：**

| 时间 | 事件 |
| --- | --- |
| 0.6 s | 页面加载完成，UI 已显示，但停在“选择一个工作区” |
| 0.9 s | 客户端发出 `getProfile` / `getBalance` / `getUnnotifiedBonuses` |
| ~1.2 s | `session/create`、`llm/listProviders` 发出 |
| ~30 s | `getBalance` / `getUnnotifiedBonuses` 连接超时 |
| **43.9 s** | 账号请求结束，`session/create` 返回，UI 进入聊天界面 |
| ~45 s | 页面可用 |

**带 dsh-purge（实际环境）：**

| 时间 | 事件 |
| --- | --- |
| 0.6 s | 页面加载完成 |
| 0.9 s | `/dsh-purge/update`、`/dsh-purge/status` 等开始 |
| 1.9 s | 3 个账号 RPC 发出；`session/create`、`llm/listProviders` 也发出 |
| 5.2 s | 第二轮 purge 请求（5 秒自动重扫） |
| 5–45 s | `/dsh-purge/update` 客户端在 45 秒超时；服务端继续跑到 ~66 秒 |
| 2–66 s | `/dsh-purge/rewind` 每 1.2 秒轮询；连接被占满时排队、abort、重试 |
| **~94–100 s** | 账号请求超时、`session/create` 返回，UI 可用 |

### 2.6 卡住时的 socket

对 dsh 进程（不是包装它的 shell）检查：

```bash
ss -tnp | grep '60\.204\.'
```

能看到类似：

```text
ESTAB 407 0 10.x.x.x:39842 60.204.2.x:443 users:(("node-MainThread",pid=...,fd=33))
ESTAB 638 0 10.x.x.x:39860 60.204.2.x:443 users:(("node-MainThread",pid=...,fd=32))
```

含义：

- TCP 已建立；
- `Send-Q` 有 407/638 字节没被对端确认；
- `Recv-Q` 为 0，说明没有收到响应；
- 不是 DNS 失败、不是连不上、也不是 401。

### 2.7 复现方式

隔离 `DSH_HOME`，不影响正在用的 3080 实例：

```bash
cp -a ~/.dsh /tmp/dsh-repro-home
DSH_HOME=/tmp/dsh-repro-home dsh web --port 3099 --no-open
```

浏览器打开打印出的 URL（带 token），DevTools → Network 观察：

- `/api/account/getProfile`
- `/api/account/getBalance`
- `/api/account/getUnnotifiedBonuses`
- `/api/session/create`
- `/api/llm/listProviders`
- `/dsh-purge/update`
- `/dsh-purge/status`
- `/dsh-purge/rewind`

也可以直接运行本仓库的诊断（只读）：

```bash
node scripts/diagnose.mjs
```

详细时间线见 [docs/01-symptoms.md](docs/01-symptoms.md)。

---

## 3. 根因（详细）

### 3.1 第一层：rc.2 把账号 UI 放进了普通 web

`@deepseek-ai/dsh-client-ui-settings-account/lib/client.js`：

**0.2.1-alpha.2**

```js
/** Register account UI only in the Desktop renderer. */
function apply(ctx) {
  if (!("dshDesktop" in globalThis)) return;
  // ...
}
```

**0.2.1-rc.2**

```js
/** Register account UI in Desktop and plain Web clients. */
function apply(ctx) {
  const desktop = "dshDesktop" in globalThis;
  // ...
}
```

Windows 对照环境是 alpha.2，浏览器里没有 `dshDesktop`，账号 UI 整个不注册；
WSL 是 rc.2，普通 web 也注册。

### 3.2 第二层：登录后才会真的发请求

rc.2 的账号 UI 有一个 `refresh()`：

```js
const refresh = () => {
  if (snapshot.view?.status !== "credential-stored") return Promise.resolve();
  // Promise.all([getProfile, getBalance])，以及 notices.refresh()
};
```

- **未登录/没有 grant**：直接返回，不发平台请求；
- **已登录（`.credentials.yaml` 有 grant）**：页面启动时拉资料、余额、bonus。

这解释了两个常见疑问：

1. **“为什么以前只装 rc.2 是正常的？”**
   如果当时还没登录/没存 grant，账号 UI 根本不会发这些请求；
2. **“为什么现在一启动就卡？”**
   登录后每次页面启动都会走这段逻辑。

本仓库保留登录（本地读取），只把**详情查询**改成打开账号菜单/设置时才执行。

### 3.3 第三层：30 秒超时 + 连接卡住

`@deepseek-ai/dsh-deepseek-account-platform`：

```js
requestTimeoutMs: Schema.number().min(1).max(12e4).default(3e4),
balanceTimeoutMs: Schema.number().min(1).max(12e4).default(3e4),
```

- profile / bonus 用 `requestTimeoutMs`（30 秒）；
- balance 用 `balanceTimeoutMs`（30 秒）；
- 超时通过 `AbortSignal.timeout(...)` 中止 fetch，日志 `no-response` / `aborted: true`。

实测：

```text
0.9 s  GET /auth-api/v0/users/current       -> 很快 200, code 0
0.9 s  GET /auth-api/v0/users/current       -> 另一条连接
0.9 s  GET /api/v0/users/get_user_summary   -> 卡住
0.9 s  GET /api/v0/users/get_unnotified_bonuses -> 卡住
```

卡住时 socket：

```text
ESTAB Send-Q=407 Recv-Q=0 -> 60.204.2.x:443
ESTAB Send-Q=638 Recv-Q=0 -> 60.204.2.x:443
```

对照：同一个 token、同一组 `x-client-*` 头、甚至“两个 profile 并发”，
在独立 Node 进程里 **100–300 ms** 返回 200 / code 0。

**所以：**

- token 有效；
- 请求格式正确；
- 端点可用；
- 失败方式是**传输层超时**，不是 401/40003/429；
- 卡在 **dsh 长期运行进程到 platform 的几条连接** 上。

具体为什么这几条连接被对端静默丢弃，没有平台侧日志/抓包无法 100% 定论；
候选包括 WAF 反爬/限速、坏 keep-alive、Node 26 + WSL 网络栈的组合。
本仓库没有尝试“修网络”，而是**不再让启动阻塞在这些查询上**。

### 3.4 第四层：为什么整页都不可用

账号 RPC 发出后，`session/create`、`llm/listProviders`、工作区初始化也在同一
时间发出。实测它们被拖到与账号请求相同的结束时间（约 43.9 s / 94 s）。

可能涉及：

- 浏览器对同一 host 的连接数限制；
- dsh 网关/客户端初始化对账号状态的依赖；
- 账号请求占住服务端处理/连接。

无论内部细节如何，实测触发点是**账号详情请求**：移除它们后
`session/create` 约 60–70 ms。修复把详情改成按需，启动不再等待。

### 3.5 dsh-purge 的放大作用

**自动更新检查**

`dsh-purge/client.js` 的 `loadAll()` 在组件挂载时无条件执行：

```js
apiJson("/dsh-purge/update")
  .then((d) => {
    if (!d) return;
    if (d.channel) setChannel(d.channel);
    setUpdateInfo(d);
    syncPicks(d);
  })
  .catch(() => {});
```

客户端对 `/dsh-purge/update` 的 GET 超时是 **45 秒**：

```js
if (path.indexOf("/dsh-purge/update") !== -1) {
  return method === "POST" ? 180000 : 45000;
}
```

服务端 `checkUpdate()` 会查询 GitHub（tags/heads/package.json），部分更新路径
还用 `execFileSync` 跑 git。WSL/国内网络下可能跑到接近 45 秒。

**5 秒后自动重扫**

```js
useEffect(() => {
  loadAll();
  const timer = setTimeout(() => { loadAll(); }, 5000);
  return () => clearTimeout(timer);
}, [loadAll]);
```

第二次 `loadAll()` 会重新 `GET /dsh-purge/status`，服务端扫描 65 个补丁
（实测约 7 秒）。这次扫描正好落在 `session/create` 的窗口里。

**rewind 轮询风暴**

```js
const timer = window.setInterval(tick, 1200);
```

每 1.2 秒 `GET /dsh-purge/rewind`。服务端 handler 本身很轻
（`getPending()` / `takeDraft()`），正常情况下没有影响。但在账号/更新请求
占满浏览器连接时：排队 → 约 11 秒后被浏览器 `ERR_ABORTED` → 立刻重试 →
一次启动堆积 **80+** 个 rewind 请求，直到账号超时结束才一起返回。

所以 rewind 不是根因，是连接/队列层面的放大器。**本仓库保留 rewind 轮询**，
没有为了启动速度删掉它。

**为什么去掉 purge 仍会卡 43 秒**

A/B 实测：把 `dsh-purge` 从 profile bundles 移除后，账号请求仍会卡 43 秒。
所以 purge 是放大器，账号 UI 才是启动阻塞的主因。

### 3.6 flock 的 9 秒同步阻塞

`@deepseek-ai/node-addon-system/lib/flock.js`：

```js
let filename = 'system.node';
if (platform === 'linux') {
  // Node's report types omit the libc field supplied by Linux reports.
  const report = process.report.getReport();
  filename = join(report.header.glibcVersionRuntime ? 'glibc' : 'musl', filename);
}
```

为了判断 glibc/musl，它生成了完整的 Node diagnostic report。Node 26/WSL 下
这一步约 **9 秒**，且是同步的。

服务端 CPU profile（25 秒采样）：

```text
57.7%  (idle)
40.0%  getReport  node:internal/process/report:58
       <- loadBinding  node-addon-system/lib/flock.js:6
       <- errno
       <- tryLockExclusive
       <- acquire  dsh-session-persistence-jsonl/lib/index.js:671
```

首次 `session/create` 需要写 JSONL 会话日志，触发 flock；flock 懒加载 addon
时调用 `getReport()`。这解释了“账号不卡之后，`session/create` 还要约 10 秒”。

### 3.7 rewind 的误报

`clearModelHistory()` 的流程：

1. `planRewind()` 找到最后一条用户消息，算出 `fromSeq`；
2. 从 `fromSeq` 起切掉 surface 节点；
3. 追加一个 `user/message` 事件，带
   `surfaceOp: { op: "replace", startSeq, endSeq }`；
4. 检查 `session.surface.nodes` 是否还包含被切的节点；
5. 再检查 `derivedStillContains(session, text)`：整段 derived 历史里是否还包含
   最后那条用户文字；
6. 任一检查失败 → `throw new Error("没有清掉之前发送的内容")`。

**实测失败点**

```text
[rewind-debug] after {
  fromSeq: 21,
  shadowed: [34],
  left: [7,8,9,10,16,36],
  nodes: [7,8,9,10,16,36],
  derived: [
    system,
    user "<user text>",
    user runtime context,
    user time context,
    assistant "<reply quoting the same text>",
  ]
}
[rewind-debug] FAIL derived "<user text>"
```

- surface 节点检查通过：被切的 34 已不在 `left`；
- 但 derived 历史里仍有同样的文字：
  - 上一轮用户消息也包含同样的文字（节点 8）；
  - 助手回复里引用了同一句话（节点 16）。
- `derivedStillContains()` 用 `includes(needle)` 扫描整段历史，因此误判。

**实际模型历史已经清掉了这一轮**；插件只是因为文字重复而拒绝报告成功。

**rc.2 的事件顺序**

`planRewind()` 原来：

```js
const fromSeq = bounds && bounds.startSeq >= 0 ? bounds.startSeq : last.seq;
```

`bounds.startSeq` 是 `turn/start` 的 seq。rc.2 下用户消息可能**早于**
`turn/start`：

```text
plan { lastSeq: 24, startSeq: 21, endSeq: 29, fromSeq: 21, text: "<user text>" }
```

从 21 开始切，会漏掉更早的用户消息。修复取
`Math.min(bounds.startSeq, last.seq)`，把用户消息包含进来。

**为什么检查要分两层**

- **surface 节点检查**：真正决定模型请求里是否还有被切节点，必须保留；
- **derived 文本检查**：本意是抓“append 没生效”的宿主，但它是**子串搜索**，
  无法区分“这一轮的文字”和“上一轮/助手引用里的同样文字”。

修复保留 surface 检查，去掉主路径上的整段文本检查。真正的清理失败仍会被
surface 检查抓到；重复文本/助手引用不再误报。

### 3.8 为什么以前正常 / 为什么 Windows 正常

- **Windows**：alpha.2 的 web 不注册账号 UI，没有这些请求；
- **以前 WSL 正常**：很可能当时还没登录/没存 grant，`refresh()` 直接返回；
  登录之后才每次启动都拉详情；
- **“只装 rc.2 正常”**：如果没登录/只用 API key，账号详情请求也不会发生。
  一旦登录，rc.2 的 web 账号 UI 就开始暴露这个问题。

### 3.9 已经排除的原因

| 假设 | 排除方式 |
| --- | --- |
| 代理/Clash | dsh 进程无代理环境变量；连接直连；独立进程同请求正常 |
| WAF IP | 两个 IP 单独请求都正常；强制 DNS 到另一个 IP 不改善 |
| token 失效 | profile 返回 code 0；登录状态正常；失败的是余额/bonus |
| 请求头差异 | 按插件实际头发送，独立进程正常；包括空 `x-client-bundle-id` |
| 两个相同 profile 并发 | 独立进程按同样模式请求，正常 |
| dsh-purge `{{cwd}}` 修复 | 完全移除 purge 后仍卡 43 秒 |
| 页面未加载 | 页面 0.6 秒完成；卡的是初始化 RPC |
| 真刷新 | `performance.now()` 未重置；是 pending 初始化结束后的重渲染 |

### 3.10 因果链

```text
rc.2 把账号 UI 开放到普通 web
        │
        ├─ 启动时自动 getProfile/getBalance/getUnnotifiedBonuses
        │        │
        │        └─ WSL 下到 platform.deepseek.com 的几条连接卡住
        │                 │  30s 后 AbortSignal 超时
        │                 └─ 账号详情标 failed；UI 继续
        │
        ├─ dsh-purge 页面加载自动 /update（45s 客户端超时）
        ├─ dsh-purge 挂载 5s 后自动重扫 /status（约 7s）
        ├─ rewind 每 1.2s 轮询；连接被占满时堆积/abort/重试
        │
        └─ 首次 session/create 触发 flock
                 └─ process.report.getReport() 约 9s（Node 26/WSL）

结果：session/create 和整页初始化被拖到 43s（无 purge）或 100s（有 purge）。

另一个独立问题：
rewind 清掉 surface 节点后，在整段 derived 历史里搜用户文字
        └─ 命中上一轮/助手回复里的同一句话 → 误报“没有清掉之前发送的内容”
```

完整分析见 [docs/02-root-cause.md](docs/02-root-cause.md)，
实测数据见 [docs/07-evidence.md](docs/07-evidence.md)。

---

## 4. 解决办法（逐项）

**总策略**：不关闭账号 UI、不降级、不改网络/代理；把“启动必须等待的详情查询”
改成“按需”；把“页面加载重活”改成“手动/首次”；把“9 秒诊断报告”改成“廉价检测”；
把“整段文本搜索”改成“surface 节点检查”。

### 4.1 上游 `{{cwd}}` 修复（cwd）

**文件**：`<DSH_HOME>/profiles/web/node_modules/dsh-purge/lib/index.js`

**问题**：新版 DSH 的 prompt 插值不再注册 `cwd`，dsh-purge 的
`Your working directory is {{cwd}}.` 会在渲染阶段抛
`unknown prompt variable "{{cwd}}"`，导致每轮“本轮运行失败”。

**修复**（来自上游 dsh-purge-cwd-fix）：

- 在 `registerPromptSections()` 开头插入 `installCwdVariable(ctx);`；
- 在 `installRewindDeriveFilter()` 前插入 helper 块
  （`promptCwdFor` / `addPromptVariable` / `installCwdVariable`）。

helper 优先读 `workingDirectory` 服务、会话 header 的 `cwd`，最后退回
`process.cwd()`；注册失败只告警，不阻断插件。

上游原始 patch 在 `patches/upstream-cwd-variable.patch`；脚本使用
`patches/cwd-variable.insert.js` 的插入块。详见
[docs/03-fixes.md](docs/03-fixes.md)。

### 4.2 上游 PowerShell registry 守卫（desktop，可选）

**文件**：`dsh-purge/lib/desktop.js`

**问题**：Windows 枚举已安装程序时，`Get-ItemProperty $_.PSPath` 遇到损坏/
无权限项会刷错误。

**修复**：

```powershell
# before
$p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
# after
try { $p = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction Stop } catch { return }
```

WSL 上这段 PowerShell 不会执行；仅当同一插件目录在 Windows/WSL 共享时有用。
可选，缺标记时跳过。

### 4.3 账号详情按需加载（account）

**文件**：
`<dsh 安装>/node_modules/@deepseek-ai/dsh-client-ui-settings-account/lib/client.js`

**问题**：rc.2 在普通 web 客户端注册账号 UI，页面启动时自动拉
`getProfile` / `getBalance` / `getUnnotifiedBonuses`；WSL 下这些请求可能卡
30 秒，拖死整页。

**修复**：

1. 启动时不再自动 `notices.begin()` / `refresh()`；
2. `refreshAccount()` 首次调用时才 `notices.begin()` + `refresh()`；
3. 账号菜单按钮打开时调用 `refreshAccount()`；
4. 设置页原有的 `settingsOpen` effect 仍会触发。

关键前后：

```js
// 启动时不再自动读 bonus
if (frame.value.status !== "credential-stored") notices.end();

// 启动时不再自动 refresh
})();
/* account details load on demand */
}
})().catch(() => {
```

```js
let accountDetailsRequested = false;
const refreshAccount = async () => {
  avatar.retry();
  if (accountDetailsRequested) notices.refresh();
  else {
    accountDetailsRequested = true;
    notices.begin();
  }
  await refresh();
};
```

```js
onClick: () => {
  if (!open) { try { refreshAccount(); } catch (_error) {} }
  setOpen((value) => !value);
},
```

**保留**

- 登录状态（本地 `.credentials.yaml`）；
- account provider / 模型调用；
- 账号菜单的资料/余额查询（按需）；
- 设置页按需加载。

**取舍**

- 启动阶段不再自动拉资料/余额；
- 打开菜单/设置时才拉；
- 如果 WSL 平台连接仍卡，菜单可能 30 秒后失败——只影响菜单，不阻塞主界面。

### 4.4 dsh-purge 启动优化（purge-startup）

**文件**：`<DSH_HOME>/profiles/web/node_modules/dsh-purge/client.js`

**问题**：页面加载自动 `/dsh-purge/update`（45 秒客户端超时），
挂载 5 秒后自动重扫 `/status`（65 个补丁，约 7 秒），与账号请求叠加。

**修复**：

1. 去掉 `loadAll()` 内的自动 `apiJson("/dsh-purge/update")`；
2. 去掉 5 秒后的第二次 `loadAll()`。

**保留**

- 面板首次 `loadAll()`；
- “检测更新”按钮（手动触发 `/dsh-purge/update`）；
- 应用/还原/导入等操作后的 `loadAll()`；
- **rewind 轮询完全不动**。

**取舍**

- 面板更新信息在手动“检测更新”前可能为空；
- 不再每 5 秒自动刷新状态；
- 启动不再被 45 秒更新检查/7 秒重扫拖住。

### 4.5 flock 快速 libc 检测（flock）

**文件**：
`<dsh 安装>/node_modules/@deepseek-ai/node-addon-system/lib/flock.js`

**问题**：用 `process.report.getReport()` 判断 glibc/musl，Node 26/WSL 下约
9 秒，阻塞首次 `session/create` 的文件锁路径。

**修复**：

```js
// before
const report = process.report.getReport();
filename = join(report.header.glibcVersionRuntime ? 'glibc' : 'musl', filename);

// after
let musl = false;
try { musl = readFileSync('/proc/self/maps', 'utf8').includes('ld-musl'); } catch {}
filename = join(musl ? 'musl' : 'glibc', filename);
```

addon 选择逻辑不变：WSL/Ubuntu 的 maps 不含 `ld-musl`，仍选 glibc；
没有 `/proc/self/maps` 时默认 glibc。

### 4.6 rewind rc.2 兼容（rewind）

**文件**：`<DSH_HOME>/profiles/web/node_modules/dsh-purge/lib/rewind.js`

**问题一：清理起点漏掉用户消息**

```js
// before
const fromSeq = bounds && bounds.startSeq >= 0 ? bounds.startSeq : last.seq;
// after
const fromSeq = bounds && bounds.startSeq >= 0 ? Math.min(bounds.startSeq, last.seq) : last.seq;
```

rc.2 中用户消息可能早于 `turn/start`；取最小值，避免漏掉用户消息。

**问题二：整段文本误报**

```js
// before
if (shadowed.some((seq) => left.has(seq))) {
  throw new Error("没有清掉之前发送的内容");
}
if (derivedStillContains(session, text)) {
  throw new Error("没有清掉之前发送的内容");
}
return true;

// after
if (shadowed.some((seq) => left.has(seq))) {
  throw new Error("没有清掉之前发送的内容");
}
/* surface nodes are the source of truth; derived text may legitimately repeat
   in earlier turns or assistant replies, so do not use it as a failure test */
return true;
```

**为什么安全**

- surface 节点检查保留：真正决定模型请求里是否还有被切节点；
- 去掉的检查是“整段 derived 历史里是否包含这段文字”的子串搜索：
  - 同一句话在上一轮出现 → 误报；
  - 助手回复引用这句话 → 误报；
  - 之前的失败回退留下空标记 → 误报；
- 实测 surface 节点已经清掉时，模型历史就是干净的；重复文字属于更早的轮次，
  不应该让本次回退失败。

**保留**

- 手动“回退一次/上一轮”；
- `/rewind once|round` 命令；
- 子代理回退；
- 1.2 秒 rewind 轮询。

### 4.7 文件白名单、备份、幂等

脚本只改 6 个文件：

| 补丁 | 文件 |
| --- | --- |
| cwd | `dsh-purge/lib/index.js` |
| desktop（可选） | `dsh-purge/lib/desktop.js` |
| account | `dsh-client-ui-settings-account/lib/client.js` |
| purge-startup | `dsh-purge/client.js` |
| flock | `node-addon-system/lib/flock.js` |
| rewind | `dsh-purge/lib/rewind.js` |

- 写入前校验所有 required 标记；不匹配 → **中止且不写文件**；
- 备份：`<file>.dsh-wsl-fix.bak`（不覆盖已有备份）；
- 原子写入 + `node --check`；
- 已应用幂等跳过；
- 不杀进程、不改 session/凭据/settings。

逐项前后代码和手工步骤见 [docs/03-fixes.md](docs/03-fixes.md)。

---

## 5. 修复效果与验证数据

### 5.1 启动时间

隔离实例 + 真实 profile：

| 场景 | 输入框出现 | `session/create` |
| --- | --- | --- |
| 无 dsh-purge | **~2 s** | 860 → 930 ms（约 70 ms） |
| 带 dsh-purge | **~4 s** | 2219 → 2281 ms（约 62 ms） |

带 purge 时 2 个初始 status 请求约 1.5 秒；之后不再有 5 秒重扫。

### 5.2 启动阶段没有账号详情请求

页面启动到输入框出现之前，Network 中没有：

- `/api/account/getProfile`
- `/api/account/getBalance`
- `/api/account/getUnnotifiedBonuses`

只有打开账号菜单/设置后才出现。

### 5.3 账号菜单按需加载

打开菜单后：

```text
/api/account/getUnnotifiedBonuses
/api/account/getProfile
/api/account/getBalance
```

菜单显示“退出登录”，登录状态正常。

### 5.4 rewind 成功

修复后：

```text
POST /dsh-purge/rewind 200
{
  "ok": true,
  "sessionId": "session-...",
  "parentId": "session-...",
  "text": "<user text>",
  "at": <timestamp>
}
```

按钮显示“回退”，上一句回到输入框。

### 5.5 staging 应用/回滚

用真实原始备份搭建 staging：

```text
[ready] cwd / desktop / account / purge-startup / flock / rewind
apply -> 6 个文件 patched
diagnose -> 6 个 applied
apply --dry-run -> 0 file(s) would be patched
revert -> 6 个文件 restored
cmp 原始备份 -> 6 个全部一致
```

说明脚本的路径发现、标记应用、语法检查、备份、回滚都可迁移。

---

## 6. 快速开始（人）

### 6.1 前置

```bash
node -v
dsh --version
test -f ~/.dsh/profiles/web/node_modules/dsh-purge/package.json && echo purge-ok
```

期望 Node 26.x、dsh 0.2.1-rc.2、dsh-purge 1.1.71。

### 6.2 只读诊断

```bash
cd dsh-purge-cwd-fix-wsl
node scripts/diagnose.mjs
```

输出：

- WSL/Node；
- dsh 路径/版本；
- `DSH_HOME`/profile；
- dsh-purge 路径/版本；
- 6 个补丁状态；
- 3080 是否在运行；
- 可用备份。

- 全部 `applied`：直接重启/验收；
- 有 `ready`：可以 apply；
- 有 `missing`：**不要 apply**，先看
  [docs/05-portability.md](docs/05-portability.md)；
- desktop 可选补丁 `missing` 不影响 WSL。

### 6.3 预览并应用

```bash
node scripts/apply.mjs --dry-run
node scripts/apply.mjs
```

脚本会校验、备份、写入、语法检查、幂等跳过；不杀进程。

### 6.4 重启

在运行 `dsh web` 的终端按 `Ctrl+C`，然后：

```bash
dsh web
```

> **必须重启**：flock/rewind 是服务端文件；客户端补丁也需要新页面/新进程。
> 脚本不会替你杀进程。

### 6.5 验收

最短版本：

- 页面 2–4 秒内出现输入框，不再长时间“选择一个工作区”；
- 打开账号菜单：能看到“退出登录”，按需加载资料/余额；
- 启动时 Network 没有 `/api/account/*` 详情请求；
- 在一个有用户消息的会话点“回退一次”，上一句回到输入框，按钮不报错；
- dsh-purge 面板“检测更新”仍可用。

完整清单见 [docs/04-verification.md](docs/04-verification.md)。

---

## 7. 快速开始（Agent）

把 [`AGENT_PROMPT.md`](AGENT_PROMPT.md) 整段交给执行 Agent。它被要求：

1. 先读 README、`docs/02-root-cause.md`、`docs/03-fixes.md`、`docs/04-verification.md`；
2. 只读执行 `scripts/diagnose.mjs`；
3. 版本不符或 required 标记 `missing` 时**停止并报告**，不强行改；
4. `--dry-run` 后 apply；
5. **不自动重启**、不杀进程、不碰 session/凭据/GitHub；
6. 输出重启命令，用户重启后按验收文档检查；
7. 失败时用 `scripts/revert.mjs` 回滚。

Agent 的完整操作契约见 `AGENT_PROMPT.md`。

---

## 8. 版本与可迁移性

脚本不写死用户名，按以下顺序找路径：

1. `--dsh-root` / `--dsh-home` / `--profile`；
2. `$DSH_HOME`；
3. `npm root -g` + `@deepseek-ai/dsh`；
4. 当前 Node 的 `lib/node_modules`、`~/.nvm/versions/node/<version>/...`、
   系统全局路径。

所以其他人 clone 后直接运行即可。若 Node/npm 布局不同：

```bash
node scripts/diagnose.mjs --dsh-root /path/to/@deepseek-ai/dsh --dsh-home ~/.dsh
```

补丁是**标记驱动**的，不是按行号。版本不同时标记找不到，会安全中止。
适配新版本见 [docs/05-portability.md](docs/05-portability.md)。

---

## 9. 回滚与安全边界

### 回滚

```bash
node scripts/revert.mjs
```

然后重启 `dsh web`。

- 优先恢复 `.dsh-wsl-fix.bak`；
- 没有时识别兼容备份：
  `.account-lazy.bak`、`.flock-libc.bak`、`.purge-lazy.bak`、
  `.rewind-seq.bak` 等；
- 上游 `{{cwd}}`/desktop 修复若没有本仓库备份，会保留；
  如要完全回退插件，使用上游 dsh-purge-cwd-fix 的 rollback/卸载流程。

### 保证

- 不改 `sessions/`、`.credentials.yaml`、`settings.yaml`、`storages/`、
  端口、代理；
- 只修改 6 个白名单文件；
- 备份在目标文件旁；
- 脚本不联网（`npm root -g` 仅本地命令）。

### 不保证

- WSL 到 platform 的连接卡顿本身被修复。账号菜单的余额/资料仍可能 30 秒超时；
  它只是不再阻塞启动。
- 官方升级后补丁仍自动有效；升级会覆盖文件，需要重跑 `apply.mjs`。
- 所有历史会话的 rewind 都能成功。若旧失败回退留下异常标记，建议新建会话验证。

---

## 10. FAQ

### Q1：这是不是网络/代理问题？

不是一般网络问题：

- dsh 进程没有代理环境变量；
- 连接是直连；
- 同一个 token、同一组头、同样并发在独立 Node 进程里 100–300 ms 返回。

问题是 dsh 进程到 platform 的少数连接卡住；本仓库不修网络，只让启动不等待。

### Q2：为什么 Windows 秒开？

对照环境 Windows 装的是 alpha.2；alpha.2 的 web 不注册账号 UI，
根本不发这三类请求。不是网络更快，而是没查。

### Q3：为什么以前 WSL 正常？

很可能当时没登录/没存 grant，`refresh()` 直接返回；登录之后才每次启动都拉详情。

### Q4：为什么还保留账号 UI，不直接关掉？

关掉会丢失登录/余额界面。本仓库改成按需加载：登录仍在本地读取，
打开菜单/设置时才查详情。

### Q5：余额查询为什么还可能超时？

WSL 到 platform 的连接卡顿仍在。按需加载只保证它不阻塞启动；
打开菜单后的余额/资料仍可能 30 秒后失败，但主界面/新会话/回退不受影响。

### Q6：回退一次和回退上一轮有什么区别？

- **回退一次**：当前会话的最后一条用户消息 + 这一轮助手回复；
  如果当前是子代理，只回退这个子代理；
- **回退上一轮**：主会话 + 这一轮启动的所有子代理，一起回退，再回主会话。

两者都会把最后一条用户消息放回输入框；下一次发送不带被撤掉的回复。

### Q7：为什么 rewind 轮询不删掉？

它是命令/子代理触发回退后自动切会话、回填输入框的发现机制。
删掉会让 `/rewind` 命令/子代理回退的自动回填失效。
本仓库保留 1.2 秒轮询；启动修复后它不再是问题。

### Q8：升级 dsh/dsh-purge 后怎么办？

重新运行：

```bash
node scripts/diagnose.mjs
node scripts/apply.mjs
```

如果 `diagnose` 显示 required 标记 `missing`，说明版本变化，按
[docs/05-portability.md](docs/05-portability.md) 适配；不要强行 apply。

### Q9：为什么不直接降到 alpha.2？

降级会失去 rc.2 的 web 账号 UI/当前功能；本仓库保留 rc.2，同时解决启动和回退。
如果你更看重“和 Windows 完全一致”，降级也是可选方案，但不是本仓库的目标。

### Q10：会不会改我的会话/凭据/设置？

不会。脚本只改 6 个源码文件；不读取/写入 `.credentials.yaml`、`sessions/`、
`storages/`、`settings.yaml`、端口、代理。

---

## 11. 文档索引 / Credits / License

### 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/01-symptoms.md](docs/01-symptoms.md) | 现象、终端日志、时间线、复现方式 |
| [docs/02-root-cause.md](docs/02-root-cause.md) | 版本差异、账号 UI、purge、flock、rewind 的完整根因 |
| [docs/03-fixes.md](docs/03-fixes.md) | 每个补丁的文件、锚点、前后代码、安全性、手工步骤 |
| [docs/04-verification.md](docs/04-verification.md) | 重启、验收清单、预期日志、失败处理 |
| [docs/05-portability.md](docs/05-portability.md) | 路径/版本/Node/profile 适配，如何生成新补丁 |
| [docs/06-troubleshooting.md](docs/06-troubleshooting.md) | FAQ、常见误判、账号余额、rewind 边界 |
| [docs/07-evidence.md](docs/07-evidence.md) | 实测 CPU profile、请求时间线、surface 节点、错误链 |
| [patches/README.md](patches/README.md) | 上游补丁、插入块、WSL 标记表 |
| [AGENT_PROMPT.md](AGENT_PROMPT.md) | 可直接复制给 Agent 的执行提示词 |
| [HANDOFF.md](HANDOFF.md) | 交接说明、上传 GitHub 前检查清单 |
| [CHANGELOG.md](CHANGELOG.md) | 变更记录与验证版本 |
| [NOTICE.md](NOTICE.md) | 上游署名、非官方声明、许可说明 |

### Credits

- 上游插件：[dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)（MIT）；
- 上游修复与 `{{cwd}}`/registry 补丁：[dsh-purge-cwd-fix contributors](https://github.com/irislilymoon/dsh-purge-cwd-fix)（MIT）；
- 本仓库：WSL/rc.2 启动与 rewind 兼容补丁、脚本、文档，MIT。

本仓库是**非官方兼容性修复**，与 DeepSeek 无关；不重新分发 dsh、
dsh-purge 或 DeepSeek Harness 源文件。详见 [NOTICE.md](NOTICE.md) 与
[LICENSE](LICENSE)。
