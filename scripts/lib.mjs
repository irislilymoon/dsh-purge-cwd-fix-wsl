#!/usr/bin/env node
/**
 * Shared helpers for the WSL dsh fast-start + rewind compatibility fix.
 *
 * This file intentionally makes no network requests and never reads user
 * sessions or credentials. It only inspects package files and the four/five
 * installed source files listed in patchDefs().
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const EXPECTED_DSH = '0.2.1-rc.2';
export const EXPECTED_PURGE = '1.1.71';

export function parseArgs(argv) {
  const out = {
    dryRun: false,
    json: false,
    help: false,
    dshRoot: '',
    dshHome: '',
    profile: 'web',
    port: 3080,
    skipCwd: false,
    skipDesktop: false,
  };
  const takes = new Set(['--dsh-root', '--dsh-home', '--profile', '--port']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--skip-cwd') {
      out.skipCwd = true;
      continue;
    }
    if (arg === '--skip-desktop') {
      out.skipDesktop = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    const eq = arg.indexOf('=');
    const flag = eq >= 0 ? arg.slice(0, eq) : arg;
    if (takes.has(flag)) {
      const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      if (flag === '--dsh-root') out.dshRoot = value;
      else if (flag === '--dsh-home') out.dshHome = value;
      else if (flag === '--profile') out.profile = value;
      else if (flag === '--port') out.port = Number(value);
      continue;
    }
    throw new Error(`unknown option ${arg}`);
  }
  return out;
}

export function usage(program) {
  return `${program} — WSL dsh fast-start / rewind fix

Usage:
  node scripts/diagnose.mjs [options]
  node scripts/apply.mjs    [options]
  node scripts/revert.mjs   [options]

Options:
  --dry-run          print the plan without writing (apply only)
  --json             machine-readable output (diagnose only)
  --dsh-root <dir>   @deepseek-ai/dsh install directory (default: npm root -g)
  --dsh-home <dir>   DSH_HOME (default: $DSH_HOME or ~/.dsh)
  --profile <name>   dsh profile (default: web)
  --port <port>      dsh web port for the running-instance check (default: 3080)
  --skip-cwd         do not apply the upstream {{cwd}} prompt-variable patch
  --skip-desktop     do not apply the optional Windows registry-scan patch
  -h, --help         this help

Notes:
  - Apply is idempotent; already-patched files are skipped.
  - A version marker mismatch aborts the whole apply before any write.
  - Backups are written next to each file as <file>.dsh-wsl-fix.bak.
  - The script never edits sessions, credentials, settings, or profiles.
`;
}

export function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

export function exists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

export function readJson(file) {
  return JSON.parse(readText(file));
}

function npmGlobalRoot() {
  try {
    const out = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim();
  } catch {
    return '';
  }
}

function resolveDshRoot(explicit) {
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  const npmRoot = npmGlobalRoot();
  if (npmRoot) candidates.push(path.join(npmRoot, '@deepseek-ai', 'dsh'));
  candidates.push(path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh'));
  candidates.push(path.join(os.homedir(), '.nvm', 'versions', 'node', process.version, 'lib', 'node_modules', '@deepseek-ai', 'dsh'));
  candidates.push('/usr/local/lib/node_modules/@deepseek-ai/dsh');
  candidates.push('/usr/lib/node_modules/@deepseek-ai/dsh');
  for (const candidate of candidates) {
    if (candidate && exists(path.join(candidate, 'package.json'))) return path.resolve(candidate);
  }
  throw new Error(
    'cannot find the @deepseek-ai/dsh install. Pass --dsh-root <dir> (the directory containing package.json).\n' +
    'Candidates checked:\n  ' + candidates.filter(Boolean).join('\n  '),
  );
}

export function versionOfPkg(dir) {
  try {
    return String(readJson(path.join(dir, 'package.json')).version || '');
  } catch {
    return '';
  }
}

export function isWsl() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft/i.test(readText('/proc/version'));
  } catch {
    return false;
  }
}

export function discover(opts = {}) {
  const dshHome = path.resolve(opts.dshHome || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
  const profile = opts.profile || 'web';
  const profileDir = path.join(dshHome, 'profiles', profile);
  const dshRoot = resolveDshRoot(opts.dshRoot);
  const purgeDir = path.join(profileDir, 'node_modules', 'dsh-purge');
  const paths = {
    dshRoot,
    dshHome,
    profile,
    profileDir,
    purgeDir,
    accountClient: path.join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-account', 'lib', 'client.js'),
    flock: path.join(dshRoot, 'node_modules', '@deepseek-ai', 'node-addon-system', 'lib', 'flock.js'),
    purgeClient: path.join(purgeDir, 'client.js'),
    purgeRewind: path.join(purgeDir, 'lib', 'rewind.js'),
    purgeIndex: path.join(purgeDir, 'lib', 'index.js'),
    purgeDesktop: path.join(purgeDir, 'lib', 'desktop.js'),
  };
  return {
    ...paths,
    wsl: isWsl(),
    node: process.version,
    dshVersion: versionOfPkg(dshRoot),
    purgeVersion: versionOfPkg(purgeDir),
    running: false,
  };
}

export async function isPortOpen(port, host = '127.0.0.1', timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

const step = (name, from, to, doneMarker) => ({ name, from, to, doneMarker });

export function patchDefs(paths) {
  const cwdHelper = readText(path.join(REPO_ROOT, 'patches', 'cwd-variable.insert.js')).trimEnd() + '\n';
  const cwdSteps = [
    step(
      'register cwd variable',
      'export function registerPromptSections(ctx, config) {\n',
      'export function registerPromptSections(ctx, config) {\n  installCwdVariable(ctx);\n',
      'installCwdVariable(ctx);',
    ),
    step(
      'insert cwd helper',
      'function installRewindDeriveFilter(ctx) {',
      `${cwdHelper}\nfunction installRewindDeriveFilter(ctx) {`,
      'function installCwdVariable(',
    ),
  ];

  const desktopSteps = [
    step(
      'safe registry enumeration',
      '$p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue',
      'try { $p = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction Stop } catch { return }',
      'Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction Stop',
    ),
  ];

  const accountSteps = [
    step(
      'account: no boot bonus read',
      'if (frame.value.status === "credential-stored") notices.begin();\n\t\t\t\t\telse notices.end();',
      'if (frame.value.status !== "credential-stored") notices.end();',
      'if (frame.value.status !== "credential-stored") notices.end();',
    ),
    step(
      'account: no boot refresh',
      '\t\t\t\t\t})();\n\t\t\t\t\trefresh();\n\t\t\t\t}\n\t\t\t})().catch(() => {',
      '\t\t\t\t\t})();\n\t\t\t\t\t/* account details load on demand */\n\t\t\t\t}\n\t\t\t})().catch(() => {',
      '/* account details load on demand */',
    ),
    step(
      'account: on-demand refreshAccount',
      '\t\t\tconst refreshAccount = async () => {\n\t\t\t\tavatar.retry();\n\t\t\t\tawait Promise.all([refresh(), notices.refresh()]);\n\t\t\t};',
      '\t\t\tlet accountDetailsRequested = false;\n\t\t\tconst refreshAccount = async () => {\n\t\t\t\tavatar.retry();\n\t\t\t\tif (accountDetailsRequested) notices.refresh();\n\t\t\t\telse {\n\t\t\t\t\taccountDetailsRequested = true;\n\t\t\t\t\tnotices.begin();\n\t\t\t\t}\n\t\t\t\tawait refresh();\n\t\t\t};',
      'accountDetailsRequested',
    ),
    step(
      'account: open menu loads details',
      '\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\tsetOpen((value) => !value);\n\t\t\t\t\t\t\t},',
      '\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\tif (!open) { try { refreshAccount(); } catch (_error) {} }\n\t\t\t\t\t\t\t\tsetOpen((value) => !value);\n\t\t\t\t\t\t\t},',
      'if (!open) { try { refreshAccount(); } catch (_error) {} }',
    ),
  ];

  const purgeClientSteps = [
    step(
      'purge: no automatic update check',
      '\t\t\t\tapiJson("/dsh-purge/update")\n\t\t\t\t\t.then((d) => {\n\t\t\t\t\t\tif (!d) return;\n\t\t\t\t\t\tif (d.channel) setChannel(d.channel);\n\t\t\t\t\t\tsetUpdateInfo(d);\n\t\t\t\t\t\tsyncPicks(d);\n\t\t\t\t\t})\n\t\t\t\t\t.catch(() => {});\n',
      '\t\t\t\t/* auto update check disabled for fast startup; manual 检测更新 still works */\n',
      'auto update check disabled for fast startup',
    ),
    step(
      'purge: no 5s status refresh',
      '\t\t\tuseEffect(() => {\n\t\t\t\tloadAll();\n\t\t\t\tconst timer = setTimeout(() => { loadAll(); }, 5000);\n\t\t\t\treturn () => clearTimeout(timer);\n\t\t\t}, [loadAll]);\n',
      '\t\t\t/* purge panel: initial load only */\n\t\t\tuseEffect(() => {\n\t\t\t\tloadAll();\n\t\t\t}, [loadAll]);\n',
      '/* purge panel: initial load only */',
    ),
  ];

  const flockSteps = [
    step(
      'flock: import fast reader',
      "import { createRequire } from 'node:module';",
      "import { createRequire } from 'node:module';\nimport { readFileSync } from 'node:fs';",
      "import { readFileSync } from 'node:fs';",
    ),
    step(
      'flock: cheap libc detection',
      "        // Node's report types omit the libc field supplied by Linux reports.\n        const report = process.report.getReport();\n        filename = join(report.header.glibcVersionRuntime ? 'glibc' : 'musl', filename);",
      "        // Cheap libc detection: the full diagnostic report is very slow on Node 26/WSL.\n        let musl = false;\n        try { musl = readFileSync('/proc/self/maps', 'utf8').includes('ld-musl'); } catch {}\n        filename = join(musl ? 'musl' : 'glibc', filename);",
      'Cheap libc detection',
    ),
  ];

  const rewindSteps = [
    step(
      'rewind: include user prompt before turn/start',
      '  const fromSeq = bounds && bounds.startSeq >= 0 ? bounds.startSeq : last.seq;',
      '  const fromSeq = bounds && bounds.startSeq >= 0 ? Math.min(bounds.startSeq, last.seq) : last.seq;',
      'Math.min(bounds.startSeq, last.seq)',
    ),
    step(
      'rewind: drop false-positive text check',
      '  if (shadowed.some((seq) => left.has(seq))) {\n    throw new Error("没有清掉之前发送的内容");\n  }\n  if (derivedStillContains(session, text)) {\n    throw new Error("没有清掉之前发送的内容");\n  }\n  return true;',
      '  if (shadowed.some((seq) => left.has(seq))) {\n    throw new Error("没有清掉之前发送的内容");\n  }\n  /* surface nodes are the source of truth; derived text may legitimately repeat\n     in earlier turns or assistant replies, so do not use it as a failure test */\n  return true;',
      'surface nodes are the source of truth',
    ),
  ];

  return [
    {
      id: 'cwd',
      title: 'upstream {{cwd}} prompt variable',
      fileKey: 'purgeIndex',
      optional: false,
      skip: (opts) => opts.skipCwd,
      steps: cwdSteps,
      note: 'Required for dsh-purge on newer DSH hosts; reuses the upstream dsh-purge-cwd-fix insertion.',
    },
    {
      id: 'desktop',
      title: 'upstream PowerShell registry scan guard',
      fileKey: 'purgeDesktop',
      optional: true,
      skip: (opts) => opts.skipDesktop,
      steps: desktopSteps,
      note: 'Windows-only code path; harmless to apply on WSL, optional if the marker is absent.',
    },
    {
      id: 'account',
      title: 'web account details load on demand',
      fileKey: 'accountClient',
      optional: false,
      skip: () => false,
      steps: accountSteps,
      note: 'Keeps account login/provider; profile/balance/bonus are fetched when the account menu opens.',
    },
    {
      id: 'purge-startup',
      title: 'dsh-purge page-load update/status work',
      fileKey: 'purgeClient',
      optional: false,
      skip: () => false,
      steps: purgeClientSteps,
      note: 'Auto update check and 5s status rescan are removed; manual 检测更新 still works.',
    },
    {
      id: 'flock',
      title: 'flock libc detection without process.report',
      fileKey: 'flock',
      optional: false,
      skip: () => false,
      steps: flockSteps,
      note: 'Removes the ~9s Node diagnostic report on Node 26/WSL.',
    },
    {
      id: 'rewind',
      title: 'rewind rc.2 compatibility',
      fileKey: 'purgeRewind',
      optional: false,
      skip: () => false,
      steps: rewindSteps,
      note: 'Fixes the false-positive "没有清掉之前发送的内容" when text repeats in earlier turns or assistant replies.',
    },
  ];
}

export function evaluatePatch(def, paths) {
  const file = paths[def.fileKey];
  if (!file || !exists(file)) {
    return { id: def.id, title: def.title, file, optional: def.optional, state: 'missing-file', steps: [] };
  }
  const src = readText(file);
  const steps = def.steps.map((s) => {
    if (src.includes(s.doneMarker)) return { name: s.name, state: 'applied' };
    const count = src.split(s.from).length - 1;
    if (count === 1) return { name: s.name, state: 'ready' };
    return { name: s.name, state: count > 1 ? 'ambiguous' : 'missing' };
  });
  const allApplied = steps.every((s) => s.state === 'applied');
  const allReady = steps.every((s) => s.state === 'ready');
  const canApply = steps.every((s) => s.state === 'applied' || s.state === 'ready');
  let state;
  if (allApplied) state = 'applied';
  else if (allReady) state = 'ready';
  else if (canApply) state = 'ready-partial';
  else state = 'missing';
  return {
    id: def.id,
    title: def.title,
    file,
    optional: def.optional,
    state,
    steps,
    partial: state === 'ready-partial',
  };
}

export function legacyBackups(paths) {
  const map = new Map();
  const add = (key, suffixes) => {
    const file = paths[key];
    if (!file) return;
    for (const suffix of suffixes) {
      const candidate = file + suffix;
      if (exists(candidate)) {
        map.set(file, candidate);
        break;
      }
    }
  };
  add('accountClient', ['.account-lazy.bak']);
  add('flock', ['.flock-libc.bak']);
  add('purgeClient', ['.purge-lazy.bak', '.purge-status-lazy.bak']);
  add('purgeRewind', ['.rewind-seq.bak', '.rewind-derived.bak']);
  return map;
}

function writeAtomic(file, text) {
  const tmp = file + '.dsh-wsl-fix.new';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function checkSyntax(file) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

export function printPlan(discovered, evaluated) {
  console.log(`WSL:        ${discovered.wsl ? 'yes' : 'no'}   Node: ${discovered.node}`);
  console.log(`dsh:        ${discovered.dshRoot} (${discovered.dshVersion || 'unknown'})`);
  console.log(`DSH_HOME:   ${discovered.dshHome}   profile: ${discovered.profile}`);
  console.log(`dsh-purge:  ${discovered.purgeDir} (${discovered.purgeVersion || 'unknown'})`);
  if (discovered.dshVersion && discovered.dshVersion !== EXPECTED_DSH) {
    console.log(`WARNING:    this repo is validated for dsh ${EXPECTED_DSH}; found ${discovered.dshVersion}`);
  }
  if (discovered.purgeVersion && discovered.purgeVersion !== EXPECTED_PURGE) {
    console.log(`WARNING:    this repo is validated for dsh-purge ${EXPECTED_PURGE}; found ${discovered.purgeVersion}`);
  }
  console.log('Patches:');
  for (const item of evaluated) {
    const optional = item.optional ? ' optional' : '';
    console.log(`  [${item.state}]${optional} ${item.id.padEnd(14)} ${item.title}`);
    if (item.state === 'missing' || item.state === 'missing-file') {
      for (const s of item.steps) if (s.state !== 'applied') console.log(`      - ${s.name}: ${s.state}`);
    }
  }
}

export function applyAll(discovered, defs, opts) {
  const evaluated = defs.filter((d) => !d.skip(opts)).map((d) => evaluatePatch(d, discovered));
  printPlan(discovered, evaluated);
  const blockers = evaluated.filter((e) => !e.optional && e.state !== 'applied' && e.state !== 'ready' && e.state !== 'ready-partial');
  if (blockers.length) {
    console.error('\nABORT: required markers did not match. No files were written.');
    console.error('This usually means a different dsh/dsh-purge version. Open docs/05-portability.md and docs/06-troubleshooting.md.');
    return { ok: false, evaluated };
  }
  const pending = evaluated.filter((e) => e.state === 'ready' || e.state === 'ready-partial');
  if (opts.dryRun) {
    console.log(`\nDry run: ${pending.length} file(s) would be patched; nothing written.`);
    return { ok: true, evaluated, dryRun: true };
  }
  if (pending.length === 0) {
    console.log('\nAll selected patches are already applied. Nothing to do.');
    return { ok: true, evaluated, applied: [] };
  }

  const written = [];
  try {
    for (const item of pending) {
      const def = defs.find((d) => d.id === item.id);
      const file = item.file;
      const original = readText(file);
      const backup = file + '.dsh-wsl-fix.bak';
      if (!exists(backup)) fs.writeFileSync(backup, original);
      let src = original;
      for (const s of def.steps) {
        if (src.includes(s.doneMarker)) continue;
        const count = src.split(s.from).length - 1;
        if (count !== 1) throw new Error(`${def.id}/${s.name}: marker found ${count} times`);
        src = src.replace(s.from, s.to);
      }
      writeAtomic(file, src);
      checkSyntax(file);
      written.push({ id: def.id, file, backup });
      console.log(`patched ${def.id}: ${file}`);
    }
  } catch (error) {
    console.error(`\nFAILED: ${error.message}`);
    console.error('Restoring files changed in this run...');
    for (const item of written) {
      try {
        const data = fs.readFileSync(item.backup);
        const tmp = item.file + '.dsh-wsl-fix.restore';
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, item.file);
        console.error(`restored ${item.file}`);
      } catch (restoreError) {
        console.error(`could not restore ${item.file}: ${restoreError.message}`);
      }
    }
    return { ok: false, evaluated, error: error.message };
  }
  console.log('\nDone. Restart dsh web (Ctrl+C in its terminal, then `dsh web`).');
  console.log('Verify with docs/04-verification.md. Revert with `node scripts/revert.mjs`.');
  return { ok: true, evaluated, applied: written };
}

export function revertAll(discovered, defs) {
  const legacy = legacyBackups(discovered);
  const seen = new Set();
  const restored = [];
  for (const def of defs) {
    const file = discovered[def.fileKey];
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const fixed = file + '.dsh-wsl-fix.bak';
    const backup = exists(fixed) ? fixed : legacy.get(file);
    if (!backup) {
      console.log(`[leave] ${def.id}: no backup created by this repo (upstream/manual state is preserved)`);
      continue;
    }
    try {
      const data = fs.readFileSync(backup);
      const tmp = file + '.dsh-wsl-fix.restore';
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, file);
      checkSyntax(file);
      console.log(`[restored] ${def.id}: ${file} <- ${backup}`);
      restored.push({ id: def.id, file, backup });
    } catch (error) {
      console.error(`[failed] ${def.id}: ${error.message}`);
    }
  }
  if (restored.length) console.log('\nDone. Restart dsh web to apply the revert.');
  else console.log('\nNothing was restored.');
  return restored;
}
