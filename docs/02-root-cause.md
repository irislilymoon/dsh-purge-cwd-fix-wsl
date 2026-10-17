# 02 · 根因分析

本文解释“为什么卡 40–100 秒”和“为什么回退失败”的完整因果链。结论都来自实测，
不是猜测；能证明的部分给出日志/代码，不能完全证明的部分会明确标注。

## 0. 因果链总览

```text
rc.2 把账号 UI 开放到普通 web
        │
        ├─ 页面启动时自动 getProfile/getBalance/getUnnotifiedBonuses
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

---

## 1. 账号 UI：rc.2 的行为变化

### 1.1 alpha.2 与 rc.2 的入口差异

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

Windows 上用户跑的是 **alpha.2** 的 `dsh web`，浏览器里没有 `dshDesktop`，
所以整个账号 UI 不注册、不发请求；WSL 上是 **rc.2**，web 端也会注册。

> 这是“Windows 秒开、WSL 卡”的第一层原因，也是最容易被误判成网络原因的地方。

### 1.2 什么时候会真的发请求

rc.2 的账号 UI 有一个 `refresh()`：

```js
const refresh = () => {
  if (snapshot.view?.status !== "credential-stored") return Promise.resolve();
  // Promise.all([getProfile, getBalance])，以及 notices.refresh()
};
```

- **未登录/没有 grant**：`view.status !== "credential-stored"`，直接返回，不发请求；
- **已登录（`.credentials.yaml` 有 grant）**：启动时拉资料、余额、bonus。

这解释了两个常见疑问：

1. “为什么以前只装 rc.2 是正常的？”——如果当时还没登录/没存 grant，
   账号 UI 根本不会发这些请求；
2. “为什么现在一启动就卡？”——登录后每次页面启动都会走这段逻辑。

本仓库的修复保留登录状态（本地读取），只把**详情查询**改成打开账号菜单/设置时
才执行。

### 1.3 为什么是 30 秒

`@deepseek-ai/dsh-deepseek-account-platform`：

```js
requestTimeoutMs: Schema.number().min(1).max(12e4).default(3e4),
balanceTimeoutMs: Schema.number().min(1).max(12e4).default(3e4),
```

- profile / bonus 用 `requestTimeoutMs`（30s）；
- balance 用 `balanceTimeoutMs`（30s）；
- 超时通过 `AbortSignal.timeout(...)` 中止 fetch，日志 `no-response` /
  `aborted: true`。

### 1.4 为什么 profile 能成功、balance/bonus 失败

实测请求：

```text
0.9 s  GET /auth-api/v0/users/current      -> 很快 200，code 0
0.9 s  GET /auth-api/v0/users/current      -> 另一条连接
0.9 s  GET /api/v0/users/get_user_summary  -> 卡住
0.9 s  GET /api/v0/users/get_unnotified_bonuses -> 卡住
```

卡住时 socket：

```text
ESTAB Send-Q=407 Recv-Q=0 -> 60.204.2.x:443
ESTAB Send-Q=638 Recv-Q=0 -> 60.204.2.x:443
```

而同一个 token、同一组 `x-client-*` 头、甚至同样的“两个 profile 并发”
在独立 Node 进程里 **100–300 ms** 返回。

**结论**

- token 有效；
- 请求格式正确；
- 端点可用；
- 失败方式是**传输层超时**，不是 401/40003/429；
- 卡在 **dsh 这个长期运行的进程到 platform 的几条连接**上。

具体为什么这几条连接被对端静默丢弃，没有平台侧日志/抓包无法 100% 定论。
候选包括 WAF 反爬/限速、坏 keep-alive、Node 26 + WSL 网络栈的组合。
本仓库没有尝试“修网络”，而是**不再让启动阻塞在这些查询上**。

### 1.5 为什么整页都不可用

账号 RPC 发出后，`session/create`、`llm/listProviders`、工作区初始化也在同一时间
发出。实测它们被拖到与账号请求相同的结束时间（约 43.9s / 94s）。

可能涉及：

- 浏览器对同一 host 的连接数限制；
- dsh 网关/客户端初始化对账号状态的依赖；
- 账号请求占住服务端处理/连接。

无论内部细节如何，实测触发点是**账号详情请求**：移除它们后
`session/create` 约 60–70ms。修复把详情改成按需，启动不再等待。

---

## 2. dsh-purge 的放大作用

### 2.1 页面加载自动检查更新

`dsh-purge/client.js` 的 `loadAll()` 在组件挂载时无条件执行：

```js
apiJson("/dsh-purge/update")
  .then(...)
  .catch(() => {});
```

客户端对 `/dsh-purge/update` 的 GET 超时是 **45 秒**：

```js
if (path.indexOf("/dsh-purge/update") !== -1) {
  return method === "POST" ? 180000 : 45000;
}
```

服务端 `checkUpdate()` 会查询 GitHub（tags/heads/package.json），部分更新路径
还用 `execFileSync` 跑 git。WSL/国内网络下可能跑到接近 45 秒。它和账号请求在
同一个 dsh 进程、同一个启动窗口里。

### 2.2 5 秒后自动重扫

面板挂载：

```js
useEffect(() => {
  loadAll();
  const timer = setTimeout(() => { loadAll(); }, 5000);
  return () => clearTimeout(timer);
}, [loadAll]);
```

第二次 `loadAll()` 会重新 `GET /dsh-purge/status`，服务端扫描 65 个补丁
（实测约 7 秒）。这次扫描正好落在 `session/create` 的窗口里，进一步拖慢 UI。

### 2.3 rewind 轮询风暴

`installRewindWatch()`：

```js
const timer = window.setInterval(tick, 1200);
```

每 1.2 秒 `GET /dsh-purge/rewind`。服务端 handler 本身很轻（`getPending()` /
`takeDraft()`），正常情况下没有影响。

但在账号/更新请求占满浏览器连接时：

- rewind 请求排队；
- 约 11 秒后被浏览器 `ERR_ABORTED`；
- 立刻重试；
- 实测一次启动堆积 **80 多个** rewind 请求，直到账号超时结束才一起返回。

所以 rewind 不是根因，是连接/队列层面的放大器。**本仓库保留 rewind 轮询**，
没有为了启动速度删掉它。

### 2.4 为什么去掉 purge 仍会卡 43 秒

A/B 实测：把 `dsh-purge` 从 profile bundles 移除后，账号请求仍会卡 43 秒。
所以 purge 是放大器，账号 UI 才是启动阻塞的主因。

---

## 3. flock 的 9 秒 CPU 阻塞

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

服务端 CPU profile 显示：

```text
40.0%  getReport  node:internal/process/report:58
  <- loadBinding  node-addon-system/lib/flock.js:6
  <- errno
  <- tryLockExclusive
  <- acquire  dsh-session-persistence-jsonl/lib/index.js:671
```

首次 `session/create` 需要写 JSONL 会话日志，触发 flock；flock 懒加载 addon
时调用了 `getReport()`。这解释了“账号不卡之后，`session/create` 还要约 10 秒”。

修复用 `/proc/self/maps` 中是否包含 `ld-musl` 判断 libc，保留同样的 addon 选择：

```js
let musl = false;
try { musl = readFileSync('/proc/self/maps', 'utf8').includes('ld-musl'); } catch {}
filename = join(musl ? 'musl' : 'glibc', filename);
```

---

## 4. rewind 的误报

### 4.1 插件做了什么

`dsh-purge/lib/rewind.js`：

1. `planRewind()` 找到最后一条用户消息，算出 `fromSeq`；
2. `clearModelHistory()` 从 `fromSeq` 起切掉 surface 节点；
3. 追加一个 `user/message` 事件，带 `surfaceOp: {op:"replace", startSeq, endSeq}`；
4. 检查 `session.surface.nodes` 是否还包含被切的节点；
5. 再检查 `derivedStillContains(session, text)`：整段 derived 历史里是否还包含
   最后那条用户文字；
6. 任一检查失败 → `throw new Error("没有清掉之前发送的内容")`。

### 4.2 实测失败点

在隔离副本里重现用户的“问候”会话：

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

### 4.3 rc.2 的事件顺序

`planRewind()` 原来：

```js
const fromSeq = bounds && bounds.startSeq >= 0 ? bounds.startSeq : last.seq;
```

`bounds.startSeq` 是 `turn/start` 的 seq。rc.2 下用户消息可能**早于**
`turn/start`：

```text
plan { lastSeq: 24, startSeq: 21, endSeq: 29, fromSeq: 21, text: "<user text>" }
```

从 21 开始切，会漏掉 seq 更早/节点更早的用户消息。修复取
`Math.min(bounds.startSeq, last.seq)`，把用户消息包含进来。

### 4.4 为什么检查要分两层

- **surface 节点检查**：真正决定模型请求里是否还有被切的节点，必须保留；
- **derived 文本检查**：本意是抓“append 没生效”的宿主，但它是**子串搜索**，
  无法区分“这一轮的文字”和“上一轮/助手引用里的同样文字”。

修复保留 surface 检查，去掉主路径上的整段文本检查。这样：

- 真正的清理失败仍会被 surface 检查抓到；
- 重复文本/助手引用不再误报。

---

## 5. 已经排除的原因

| 假设 | 排除方式 |
| --- | --- |
| 代理 | dsh 进程无代理环境变量；连接直连；独立进程同请求正常 |
| WAF IP | 两个 IP 单独请求都正常；强制 DNS 不改善 |
| token 失效 | profile 返回 code 0；登录状态正常 |
| 请求头差异 | 按插件实际头发送，独立进程正常；包括空 `x-client-bundle-id` |
| 两个相同 profile 并发 | 独立进程按同样模式请求，正常 |
| dsh-purge `{{cwd}}` 修复 | 完全移除 purge 后仍卡 43 秒 |
| 页面未加载 | 页面 0.6 秒完成；卡的是初始化 RPC |
| 真刷新 | `performance.now()` 未重置；是 pending 初始化结束后的重渲染 |

## 6. 修复策略

本仓库不尝试改动平台/WAF/网络，也不关闭账号 UI/rewind，而是：

1. 把账号详情从**启动阻塞**改为**按需加载**；
2. 去掉 dsh-purge 页面加载时的自动重活，保留手动功能；
3. 用廉价 libc 检测替代 9 秒报告；
4. 修正 rewind 的误报检查与事件顺序；
5. 保留上游 `{{cwd}}` 修复。

具体补丁见 [03-fixes.md](03-fixes.md)。
