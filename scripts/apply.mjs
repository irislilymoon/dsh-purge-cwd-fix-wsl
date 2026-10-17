#!/usr/bin/env node
/**
 * Apply the WSL dsh fixes. Idempotent; aborts before writing if a required
 * source marker does not match the known-know-good version.
 */
import { parseArgs, usage, discover, patchDefs, applyAll, isPortOpen } from './lib.mjs';

const program = 'apply.mjs';
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
if (discovered.running) {
  console.log(`NOTE: dsh web is listening on 127.0.0.1:${opts.port}. It will keep running; restart it after apply. This script never kills processes.`);
}
const defs = patchDefs(discovered);
const result = applyAll(discovered, defs, opts);
if (!result.ok) process.exit(1);
