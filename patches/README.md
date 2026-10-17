# patches/

本目录只包含兼容性补丁/插入块，不包含 dsh、dsh-purge 或 DeepSeek Harness 的完整源码。

## 文件

| 文件 | 来源 | 用途 |
| --- | --- | --- |
| `upstream-cwd-variable.patch` | 上游 `dsh-purge-cwd-fix` | `{{cwd}}` 提示词变量修复的原始 unified diff |
| `upstream-desktop-registry-scan.patch` | 上游 `dsh-purge-cwd-fix` | Windows 注册表枚举守卫的原始 diff |
| `cwd-variable.insert.js` | 从上游修复后的 `dsh-purge/lib/index.js` 中提取 | 供 `scripts/lib.mjs` 插入的 helper 块 |

上游补丁文件是 MIT 许可的兼容性补丁；版权归上游 contributors。见
`../LICENSE.upstream` 与 `../NOTICE.md`。

## WSL 脚本如何使用

`scripts/apply.mjs` **不直接** `git apply` 这些 patch，而是用**唯一标记**应用：

1. cwd：
   - 在 `export function registerPromptSections(ctx, config) {` 后插入
     `installCwdVariable(ctx);`；
   - 在 `function installRewindDeriveFilter(ctx) {` 前插入
     `patches/cwd-variable.insert.js` 的内容；
2. desktop（可选）：替换 PowerShell 的 `Get-ItemProperty` 行；
3. account / purge-startup / flock / rewind：见 `scripts/lib.mjs` 的 `patchDefs()`。

这样避免行号/格式差异，并且可以幂等跳过已应用的文件。

## 标记表（known-good: dsh 0.2.1-rc.2, dsh-purge 1.1.71）

| id | 文件 | 关键 doneMarker | 必需 |
| --- | --- | --- | --- |
| cwd | `dsh-purge/lib/index.js` | `installCwdVariable(ctx);` + `function installCwdVariable(` | 是 |
| desktop | `dsh-purge/lib/desktop.js` | `Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction Stop` | 否 |
| account | `dsh-client-ui-settings-account/lib/client.js` | `accountDetailsRequested` / `/* account details load on demand */` | 是 |
| purge-startup | `dsh-purge/client.js` | `auto update check disabled for fast startup` + `/* purge panel: initial load only */` | 是 |
| flock | `node-addon-system/lib/flock.js` | `Cheap libc detection` | 是 |
| rewind | `dsh-purge/lib/rewind.js` | `Math.min(bounds.startSeq, last.seq)` + `surface nodes are the source of truth` | 是 |

## 手工应用（不使用脚本时）

### cwd

```bash
P="$HOME/.dsh/profiles/web/node_modules/dsh-purge"
cp "$P/lib/index.js" "$P/lib/index.js.dsh-wsl-fix.bak"
# 1) 在 registerPromptSections 开头插入 installCwdVariable(ctx);
# 2) 在 installRewindDeriveFilter 前插入 patches/cwd-variable.insert.js 的内容
node --check "$P/lib/index.js"
```

或者直接使用上游 diff：

```bash
cd "$P"
patch -p1 --dry-run < /path/to/upstream-cwd-variable.patch
patch -p1           < /path/to/upstream-cwd-variable.patch
```

如果提示 already applied / reversed，说明已修复，跳过。

### desktop（可选）

```bash
P="$HOME/.dsh/profiles/web/node_modules/dsh-purge"
cp "$P/lib/desktop.js" "$P/lib/desktop.js.dsh-wsl-fix.bak"
patch -p1 --dry-run < /path/to/upstream-desktop-registry-scan.patch
patch -p1           < /path/to/upstream-desktop-registry-scan.patch
```

WSL 上这段 PowerShell 不会执行；仅当同一插件目录在 Windows/WSL 共享时有用。

### account / purge-startup / flock / rewind

按 [../docs/03-fixes.md](../docs/03-fixes.md) 的前后代码手工替换；
每处修改前备份，改完 `node --check`。

## 验证

```bash
node scripts/diagnose.mjs
node scripts/apply.mjs --dry-run
```

6 项 `applied`、0 个待改即完成。不要只看行号；只看标记和语法检查。

## 不要做的事

- 不要修改 `sessions/`、`.credentials.yaml`、`settings.yaml`、`storages/`；
- 不要把上游 patch 应用到错误版本；
- 不要在标记不匹配时强行 `patch --fuzz` / 手工猜；
- 不要重新分发第三方源码。
