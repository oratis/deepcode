#!/usr/bin/env node

import process from 'node:process';

import { runAppServer } from './run.js';

const home = process.env.DEEPCODE_HOME ?? `${process.env.HOME ?? process.cwd()}/.deepcode`;

await runAppServer({ input: process.stdin, output: process.stdout, home });
