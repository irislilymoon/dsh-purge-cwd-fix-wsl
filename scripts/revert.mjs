#!/usr/bin/env node
/** Restore the files changed by apply.mjs, then restart dsh web. */
import { parseArgs, usage, discover, patchDefs, revertAll } from './lib.mjs';

const program = 'revert.mjs';
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
const defs = patchDefs(discovered);
const restored = revertAll(discovered, defs);
if (restored.length === 0) {
  console.log('No applicable backups. The upstream {{cwd}} fix (and any manual edits) are left untouched.');
}
