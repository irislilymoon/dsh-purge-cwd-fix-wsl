# 05 · 可迁移性 / 版本适配

本仓库的脚本不写死用户名、不写死 nvm 路径，通过以下顺序发现安装位置。
目标：别人 clone 后直接跑；不同 Node/npm 布局可以用参数覆盖。

## 1. 路径发现顺序

### dsh 安装目录

1. `--dsh-root <dir>`（最高优先级）
2. `npm root -g` + `@deepseek-ai/dsh`
3. `<当前 node 可执行文件>/../lib/node_modules/@deepseek-ai/dsh`
4. `~/.nvm/versions/node/<process.version>/lib/node_modules/@deepseek-ai/dsh`
5. `/usr/local/lib/node_modules/@deepseek-ai/dsh`
6. `/usr/lib/node_modules/@deepseek-ai/dsh`

第一个包含 `package.json` 的目录胜出。

### DSH_HOME / profile

1. `--dsh-home <dir>`
2. `$DSH_HOME`
3. `~/.dsh`

profile 默认 `web`，可用 `--profile <name>` 覆盖：

```bash
node scripts/diagnose.mjs --dsh-home /custom/dsh --profile web
```

### dsh-purge

`<$DSH_HOME>/profiles/<profile>/node_modules/dsh-purge`。

如果你的 dsh-purge 不在这个 profile 下（例如自定义安装），脚本会报
`missing-file`；需要把 dsh-purge 放到对应 profile，或者手动按
[docs/03-fixes.md](03-fixes.md) 修改并把脚本的白名单路径改掉。

## 2. 版本门禁

本仓库 validated 版本：

- `@deepseek-ai/dsh` = **0.2.1-rc.2**；
- `dsh-purge` = **1.1.71**。

脚本不是按行号打补丁，而是按**唯一标记**替换/插入。版本不同时：

- 某个 required 标记找不到（或出现多次）→ `diagnose` 显示 `missing`；
- `apply` 会在**写任何文件之前中止**；
- 已应用的版本会显示 `applied`；部分应用显示 `ready-partial`（脚本会补齐）。

**不要**在 `missing` 时用 `--force`/手工猜锚点。先按第 4 节适配。

## 3. 不同安装布局示例

### nvm（默认）

脚本会自动找到 `~/.nvm/versions/node/v26.10.0/lib/node_modules/@deepseek-ai/dsh`。

### fnm / volta / pnpm global

```bash
node scripts/diagnose.mjs \
  --dsh-root "$(dirname "$(readlink -f "$(which dsh)")")/../lib/node_modules/@deepseek-ai/dsh"
```

如果 `dsh` 是符号链接，用 `readlink -f` 找到真实入口，再定位
`node_modules/@deepseek-ai/dsh`。

### 多个 dsh 版本并存

用 `--dsh-root` 明确指定正在运行的那个；`dsh --version` 确认版本。
不要把补丁打到另一个版本上。

### DSH_HOME 不在 ~/.dsh

```bash
node scripts/diagnose.mjs --dsh-home /path/to/dsh-home
node scripts/apply.mjs   --dsh-home /path/to/dsh-home
```

### Windows 原生

本仓库面向 WSL/Linux。Windows 原生请使用上游 **dsh-purge-cwd-fix** 的
PowerShell 脚本；不要直接把本仓库的 WSL 路径/重启方式套到 Windows。
`desktop.js` 的 registry 补丁是可选的，可在共享插件目录上手动应用。

## 4. 适配新版本（维护者）

1. 先只读诊断：

   ```bash
   node scripts/diagnose.mjs --json
   ```

   看哪些补丁 `missing`、缺的是哪个 step。

2. 在**隔离副本**里对比新旧源码（不要直接改用户安装）：

   ```bash
   cp -a ~/.dsh /tmp/dsh-adapt-home
   cp -a "$(npm root -g)/@deepseek-ai/dsh" /tmp/dsh-adapt-root
   ```

3. 找到对应的新锚点：
   - 账号 UI：`credential-stored` 的 stream 循环、`refreshAccount`、账号菜单
     `onClick`；
   - purge client：`loadAll()` 里的 `/dsh-purge/update`、5 秒 `setTimeout`；
   - flock：`platform === 'linux'` 分支的 libc 判定；
   - rewind：`planRewind` 的 `fromSeq`、`clearModelHistory` 的最终检查；
   - cwd：`registerPromptSections` 和 `installRewindDeriveFilter` 锚点。

4. 更新 `scripts/lib.mjs` 里对应 `patchDefs()` 的 `from`/`to`/`doneMarker`。
   保持：
   - 每个 `from` 在目标文件中唯一；
   - `doneMarker` 只在补丁已应用时出现；
   - required 补丁缺标记时仍然中止。

5. 在 staging 树做端到端测试（见第 5 节），确认：
   - 全新文件 → apply → 全部 applied；
   - 语法检查通过；
   - revert → 哈希与原始一致。

6. 更新：
   - `README.md` 的 known-good 表；
   - `CHANGELOG.md`；
   - `docs/03-fixes.md` 的前后代码；
   - `patches/README.md` 的锚点表。

## 5. staging 端到端测试（推荐每次改脚本都做）

```bash
S=/tmp/dsh-fix-stage
rm -rf "$S"
mkdir -p "$S/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-account/lib" \
         "$S/dsh/node_modules/@deepseek-ai/node-addon-system/lib" \
         "$S/stage-home/profiles/web/node_modules/dsh-purge/lib"
echo '{"version":"0.2.1-rc.2"}' > "$S/dsh/package.json"
echo '{"version":"1.1.71","type":"module"}' > "$S/stage-home/profiles/web/node_modules/dsh-purge/package.json"

# 放入原始文件（示例用本机备份，实际用你的原始副本）
cp client.original.js "$S/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-account/lib/client.js"
cp flock.original.js "$S/dsh/node_modules/@deepseek-ai/node-addon-system/lib/flock.js"
cp purge-client.original.js "$S/stage-home/profiles/web/node_modules/dsh-purge/client.js"
cp rewind.original.js "$S/stage-home/profiles/web/node_modules/dsh-purge/lib/rewind.js"
cp index.original.js "$S/stage-home/profiles/web/node_modules/dsh-purge/lib/index.js"
cp desktop.original.js "$S/stage-home/profiles/web/node_modules/dsh-purge/lib/desktop.js"

node scripts/diagnose.mjs --dsh-root "$S/dsh" --dsh-home "$S/stage-home" --port 3999
node scripts/apply.mjs   --dsh-root "$S/dsh" --dsh-home "$S/stage-home" --port 3999
node scripts/diagnose.mjs --dsh-root "$S/dsh" --dsh-home "$S/stage-home" --port 3999
node scripts/apply.mjs   --dsh-root "$S/dsh" --dsh-home "$S/stage-home" --port 3999 --dry-run
node scripts/revert.mjs  --dsh-root "$S/dsh" --dsh-home "$S/stage-home"
cmp "$S/.../client.js" client.original.js
```

本仓库在 2026-10-17 用真实原始备份做过同样的测试，6 个文件 apply/revert 后
`cmp` 全部一致。

## 6. 备份兼容

- 新应用：`<file>.dsh-wsl-fix.bak`；
- 早期手工补丁的备份名：`.account-lazy.bak`、`.flock-libc.bak`、
  `.purge-lazy.bak`、`.purge-status-lazy.bak`、`.rewind-seq.bak`、
  `.rewind-derived.bak`；
- `revert.mjs` 会优先 `.dsh-wsl-fix.bak`，其次这些兼容名；
- 上游 `{{cwd}}`/desktop 修复若没有本仓库备份，revert 会保留，不误删。

## 7. 为什么不能照抄行号

- dsh/purge 是打包后的单文件，行号随版本变化；
- 同一段代码可能出现在多个 bundle；
- 标记唯一性 + 写入前全量校验 + 语法检查，才能安全地在用户机器上执行。

如果新版本的标记不再唯一，脚本会中止；适配时宁可多写一个 `doneMarker`，
也不要放宽到“随便找一个相似字符串”。
