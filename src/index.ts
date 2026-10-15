#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { runCli } from './cli.js';
import { startServer } from './serve.js';

export { PostconditionRuntime } from './runtime.js';
export { PostconditionStore } from './store.js';
export { runVerifier } from './verifiers/index.js';
export type * from './types.js';

const isMain = process.argv[1] !== undefined &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
  const command = process.argv[2];
  if (command === 'serve' || (command === undefined && !process.stdin.isTTY)) {
    startServer().catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  } else {
    runCli(process.argv.slice(2)).then((code) => {
      process.exitCode = code;
    }, (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
