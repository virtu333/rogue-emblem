#!/usr/bin/env node
// Headless play from a shell: `npm run play -- <command> [options]` (tools/play/README.md).
// The calls themselves live in cliMain.js.

import { runCli } from './cliMain.js';

runCli(process.argv.slice(2)).then((code) => process.exit(code));
