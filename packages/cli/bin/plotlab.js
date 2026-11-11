#!/usr/bin/env node
// Dev shim: runs the TypeScript CLI through tsx. A bundled build comes later.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const main = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.ts");
const r = spawnSync(process.execPath, ["--import", "tsx", main, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
