#!/usr/bin/env node
// deepcode CLI entry point.
// M0 skeleton — actual REPL / slash commands / flag parsing in M2.

import { PROJECT_NAME, VERSION } from '@deepcode/core';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`${PROJECT_NAME} v${VERSION} — pre-alpha skeleton`);
  console.log('');
  console.log('Usage: deepcode [options]');
  console.log('');
  console.log('  -h, --help       Show this help');
  console.log('  -v, --version    Show version');
  console.log('');
  console.log('NOTE: M0 skeleton. Real REPL / -p / --mode / etc. arrive in M2+.');
  console.log('See docs/DEVELOPMENT_PLAN.md for the full milestone roadmap.');
  process.exit(0);
}

console.log(`${PROJECT_NAME} v${VERSION} — not yet usable. See \`deepcode --help\`.`);
process.exit(0);
