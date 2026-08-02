import process from 'node:process';

import { runAppServer } from './run.js';

const home = process.env.DEEPCODE_HOME ?? `${process.env.HOME ?? process.cwd()}/.deepcode`;

runAppServer({
  input: process.stdin,
  output: process.stdout,
  home,
  forceFileCredentials: true,
}).catch((error) => {
  process.stderr.write(`DeepCode app-server fatal: ${(error as Error).message ?? String(error)}\n`);
  process.exitCode = 1;
});
