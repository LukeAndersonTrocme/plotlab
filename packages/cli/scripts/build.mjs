// Bundle the CLI into the single ESM file named by package.json "bin". Everything is inlined
// (workspace packages, generated help, pngjs, jpeg-js, fflate, utif2), so the packed CLI has
// no runtime dependencies.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const bins = Object.values(pkg.bin ?? {});
if (bins.length !== 1) throw new Error(`expected exactly one "bin" entry in package.json, found ${bins.length}`);

await build({
  entryPoints: [join(pkgDir, "src", "main.ts")],
  outfile: join(pkgDir, bins[0]),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  logLevel: "warning",
  // pngjs is CommonJS and require()s Node built-ins; give the ESM bundle a real require.
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
  },
});
