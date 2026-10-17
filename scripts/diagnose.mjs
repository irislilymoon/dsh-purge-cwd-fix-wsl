#!/usr/bin/env node
/** Read-only health check. Prints the discovered paths, versions, patch states, and running instance. */
import { parseArgs, usage, discover, patchDefs, evaluatePatch, printPlan, isPortOpen, legacyBackups, exists, EXPECTED_DSH, EXPECTED_PURGE } from './lib.mjs';

const program = 'diagnose.mjs';
let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
if (opts.help) {
  console.log(usage(program));
  process.exit(0);
}

let discovered;
try {
  discovered = discover(opts);
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(2);
}
discovered.running = await isPortOpen(opts.port);
const defs = patchDefs(discovered);
const evaluated = defs.map((def) => evaluatePatch(def, discovered));
const legacy = legacyBackups(discovered);
const backupInfo = [];
for (const def of defs) {
  const file = discovered[def.fileKey];
  if (!file) continue;
  const fixed = file + '.dsh-wsl-fix.bak';
  backupInfo.push({
    id: def.id,
    file,
    backup: exists(fixed) ? fixed : (legacy.get(file) || ''),
  });
}

if (opts.json) {
  console.log(JSON.stringify({
    wsl: discovered.wsl,
    node: discovered.node,
    dsh: { root: discovered.dshRoot, version: discovered.dshVersion, expected: EXPECTED_DSH },
    dshHome: discovered.dshHome,
    profile: discovered.profile,
    purge: { dir: discovered.purgeDir, version: discovered.purgeVersion, expected: EXPECTED_PURGE },
    running: { port: opts.port, listening: discovered.running },
    patches: evaluated.map((item) => ({
      id: item.id,
      title: item.title,
      file: item.file,
      optional: item.optional,
      state: item.state,
      steps: item.steps,
    })),
    backups: backupInfo,
  }, null, 2));
} else {
  printPlan(discovered, evaluated);
  console.log(`Running:    dsh web on 127.0.0.1:${opts.port}: ${discovered.running ? 'yes (restart needed after apply)' : 'no'}`);
  const withBackup = backupInfo.filter((b) => b.backup);
  console.log(`Backups:    ${withBackup.length ? withBackup.map((b) => `${b.id} -> ${b.backup}`).join('\n            ') : 'none created yet'}`);
  console.log('');
  console.log('Next:');
  console.log('  node scripts/apply.mjs --dry-run   # preview');
  console.log('  node scripts/apply.mjs             # apply');
  console.log('  node scripts/revert.mjs            # rollback (uses backups)');
  console.log('  See docs/04-verification.md after restarting dsh web.');
}

const blockers = evaluated.filter((item) => !item.optional && !['applied', 'ready', 'ready-partial'].includes(item.state));
process.exitCode = blockers.length ? 1 : 0;
