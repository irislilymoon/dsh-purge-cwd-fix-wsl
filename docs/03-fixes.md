# 03 · 修复内容与手工做法

本仓库修改 **6 个文件**（其中 desktop 补丁可选），全部有备份、可回滚。
自动执行：

```bash
node scripts/apply.mjs --dry-run
node scripts/apply.mjs
```

手工执行时按本文操作；修改前先把目标复制为 `<file>.dsh-wsl-fix.bak`。

## 文件白名单

| 补丁 | 文件 |
| --- | --- |
| cwd | `<DSH_HOME>/profiles/web/node_modules/dsh-purge/lib/index.js` |
| desktop（可选） | `<DSH_HOME>/profiles/web/node_modules/dsh-purge/lib/desktop.js` |
| account | `<dsh 安装>/node_modules/@deepseek-ai/dsh-client-ui-settings-account/lib/client.js` |
| purge-startup | `<DSH_HOME>/profiles/web/node_modules/dsh-purge/client.js` |
| flock | `<dsh 安装>/node_modules/@deepseek-ai/node-addon-system/lib/flock.js` |
| rewind | `<DSH_HOME>/profiles/web/node_modules/dsh-purge/lib/rewind.js` |

`<dsh 安装>` 通常是 `npm root -g` 下的 `@deepseek-ai/dsh`。脚本会自动发现。

---

## 1. 上游 `{{cwd}}` 提示词变量（cwd）

**文件**：`dsh-purge/lib/index.js`

**目的**：新版 DSH 的 prompt 插值不再注册 `cwd`，dsh-purge 自己写的
`Your working directory is {{cwd}}.` 会在渲染阶段整段抛
`unknown prompt variable "{{cwd}}"`，导致每轮“本轮运行失败”。

**来源**：上游 dsh-purge-cwd-fix 的 `cwd-variable.patch`。本仓库在
`patches/upstream-cwd-variable.patch` 保留原补丁，并把插入块独立为
`patches/cwd-variable.insert.js`，供脚本使用。

### 修改 1：注册调用

在：

```js
export function registerPromptSections(ctx, config) {
  addPromptSection(ctx, {
```

前面插入：

```js
export function registerPromptSections(ctx, config) {
  installCwdVariable(ctx);
  addPromptSection(ctx, {
```

### 修改 2：插入 helper

在 `function installRewindDeriveFilter(ctx) {` 前插入
`patches/cwd-variable.insert.js` 的完整内容：

- `CWD_PROMPT_VARIABLE`
- `promptCwdFor()`
- `addPromptVariable()`
- `installCwdVariable()`

helper 会优先读 `workingDirectory` 服务、会话 header 的 `cwd`，最后退回
`process.cwd()`；注册失败只告警，不阻断插件。

### 手工检查

```bash
grep -n "installCwdVariable(ctx);" <purge>/lib/index.js
grep -n "function installCwdVariable(" <purge>/lib/index.js
node --check <purge>/lib/index.js
```

两处都在即可。

---

## 2. Windows 注册表扫描守卫（desktop，可选）

**文件**：`dsh-purge/lib/desktop.js`

**目的**：Windows 上枚举已安装程序时，`Get-ItemProperty $_.PSPath` 遇到损坏/
无权限的注册表项会刷错误。上游补丁改成 try/catch + `-LiteralPath`。

**对 WSL 的影响**：`desktop.js` 的 PowerShell 路径在 Linux 上不会执行；
这一项只是为了让同一份插件目录在 Windows/WSL 共享时不带病。WSL 上可以跳过。

### 手工修改

原：

```powershell
$p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
```

改为：

```powershell
try { $p = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction Stop } catch { return }
```

如果找不到原行（版本不同），跳过；不要强行改。

---

## 3. 账号详情按需加载（account）

**文件**：`@deepseek-ai/dsh-client-ui-settings-account/lib/client.js`

**目的**：rc.2 在普通 web 客户端注册账号 UI，页面启动时自动拉
`getProfile` / `getBalance` / `getUnnotifiedBonuses`。在 WSL 下这些请求可能
卡 30 秒，拖死整页。改成：

- 启动时只读本地登录状态（`getState`，不发平台请求）；
- 打开账号菜单/设置时才 `refresh()` + bonus 读取；
- 登录、模型 provider、余额查询逻辑全部保留。

### 修改 1：启动不再自动读 bonus

原：

```js
if (frame.value.status === "credential-stored") notices.begin();
else notices.end();
```

改为：

```js
if (frame.value.status !== "credential-stored") notices.end();
```

### 修改 2：启动不再自动 refresh

在 stream 循环末尾：

```js
})();
refresh();
}
})().catch(() => {
```

改为：

```js
})();
/* account details load on demand */
}
})().catch(() => {
```

### 修改 3：refreshAccount 支持首次按需初始化

原：

```js
const refreshAccount = async () => {
  avatar.retry();
  await Promise.all([refresh(), notices.refresh()]);
};
```

改为：

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

### 修改 4：打开账号菜单时触发

账号菜单按钮原来的：

```js
onClick: () => {
  setOpen((value) => !value);
},
```

改为：

```js
onClick: () => {
  if (!open) { try { refreshAccount(); } catch (_error) {} }
  setOpen((value) => !value);
},
```

设置页原有的 `settingsOpen` effect 仍会调用 `refreshAccount()`，所以设置页也
会按需加载。

### 保留 / 取舍

- 登录状态仍从 `.credentials.yaml` 读取；
- account provider / 模型推理不变；
- 打开账号菜单会触发 profile/余额/bonus；
- 启动阶段不再请求这三个接口；
- 如果 WSL 平台连接仍然卡，账号菜单可能 30 秒后显示失败——只影响菜单，
  不影响主界面/新会话。

---

## 4. dsh-purge 启动优化（purge-startup）

**文件**：`dsh-purge/client.js`

**目的**：页面加载时自动检查更新（客户端 45s 超时）、挂载 5s 后自动重扫
65 个补丁（约 7s），与账号请求叠加，把 40s 放大到 100s。

### 修改 1：去掉自动更新检查

原（`loadAll` 内）：

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

改为：

```js
/* auto update check disabled for fast startup; manual 检测更新 still works */
```

**保留**：面板里的“检测更新”按钮仍然调用 `/dsh-purge/update`；应用/切换版本
等手动操作后的刷新也保留。只是不再在页面加载时自动跑。

### 修改 2：去掉 5 秒后的自动 status 重扫

原：

```js
useEffect(() => {
  loadAll();
  const timer = setTimeout(() => { loadAll(); }, 5000);
  return () => clearTimeout(timer);
}, [loadAll]);
```

改为：

```js
/* purge panel: initial load only */
useEffect(() => {
  loadAll();
}, [loadAll]);
```

第一次加载仍在；应用/还原/导入等动作后仍会调用 `loadAll()`。
**rewind 轮询没有改动。**

### 取舍

- 面板的更新信息在你点“检测更新”之前可能为空；
- 面板状态不会每 5 秒自动刷新，但手动操作后仍会刷新；
- 启动不再被 45s 更新检查/7s 重扫拖住。

---

## 5. flock 快速 libc 检测（flock）

**文件**：`@deepseek-ai/node-addon-system/lib/flock.js`

**目的**：原代码用 `process.report.getReport()` 判断 glibc/musl；Node 26/WSL
下约 9 秒，阻塞首次 `session/create` 的文件锁路径。

### 修改 1：引入 `readFileSync`

```js
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
```

### 修改 2：替换 report

原：

```js
// Node's report types omit the libc field supplied by Linux reports.
const report = process.report.getReport();
filename = join(report.header.glibcVersionRuntime ? 'glibc' : 'musl', filename);
```

改为：

```js
// Cheap libc detection: the full diagnostic report is very slow on Node 26/WSL.
let musl = false;
try { musl = readFileSync('/proc/self/maps', 'utf8').includes('ld-musl'); } catch {}
filename = join(musl ? 'musl' : 'glibc', filename);
```

addon 选择逻辑不变：WSL/Ubuntu 的进程 maps 不含 `ld-musl`，仍选 glibc。
如果系统没有 `/proc/self/maps`，默认 glibc（与原行为在常见 Linux 上一致）。

---

## 6. rewind rc.2 兼容（rewind）

**文件**：`dsh-purge/lib/rewind.js`

**目的**：修复“回退失败: 没有清掉之前发送的内容”。

### 修改 1：清理起点包含用户消息

原：

```js
const fromSeq = bounds && bounds.startSeq >= 0 ? bounds.startSeq : last.seq;
```

改为：

```js
const fromSeq = bounds && bounds.startSeq >= 0 ? Math.min(bounds.startSeq, last.seq) : last.seq;
```

rc.2 中用户消息可能早于 `turn/start`；取最小值，避免漏掉用户消息。

### 修改 2：去掉整段 derived 文本误报

原：

```js
if (shadowed.some((seq) => left.has(seq))) {
  throw new Error("没有清掉之前发送的内容");
}
if (derivedStillContains(session, text)) {
  throw new Error("没有清掉之前发送的内容");
}
return true;
```

改为：

```js
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
  - 之前的失败回退留下空标记 → 误报。
- 实测 surface 节点已经清掉时，模型历史就是干净的；重复文字属于更早的轮次，
  不应该让本次回退失败。

### 保留

- 手动“回退一次/上一轮”；
- `/rewind once|round` 命令；
- 子代理回退；
- 1.2 秒 rewind 轮询（没有为了启动速度删掉）。

---

## 应用顺序与重启

1. `node scripts/diagnose.mjs`（只读）
2. `node scripts/apply.mjs --dry-run`
3. `node scripts/apply.mjs`
4. 重启 `dsh web`（Ctrl+C，再执行）
5. 按 [04-verification.md](04-verification.md) 验收

脚本不会 kill 进程；重启必须由用户做。

## 回滚

```bash
node scripts/revert.mjs
```

然后重启。详见 [README 的回滚章节](../README.md#回滚)。
