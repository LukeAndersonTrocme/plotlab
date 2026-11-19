// Bundle the CLI into the single ESM file named by package.json "bin". Everything is inlined
// (workspace packages, generated help, pngjs, jpeg-js, fflate, utif2, @cwasm/webp), so the packed CLI has
// no runtime dependencies. @cwasm/webp reads webp.wasm from beside itself, so its loader is
// rewritten to use the bytes embedded in the bundle.
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const bins = Object.values(pkg.bin ?? {});
if (bins.length !== 1) throw new Error(`expected exactly one "bin" entry in package.json, found ${bins.length}`);

const inlineWebpWasm = {
  name: "inline-webp-wasm",
  setup(b) {
    b.onLoad({ filter: /[\\/]@cwasm[\\/]webp[\\/]index\.js$/ }, (args) => {
      const src = readFileSync(args.path, "utf8");
      const read = "fs.readFileSync(path.join(__dirname, 'webp.wasm'))";
      if (!src.includes(read)) throw new Error("@cwasm/webp changed how it loads webp.wasm; update inline-webp-wasm");
      const wasm = readFileSync(join(dirname(args.path), "webp.wasm")).toString("base64");
      return { contents: src.replace(read, `Buffer.from(${JSON.stringify(wasm)}, "base64")`), loader: "js" };
    });
  },
};

// Start from an empty dist/, so a renamed bin never ships the old bundle beside it ("files": ["dist"]).
rmSync(join(pkgDir, "dist"), { recursive: true, force: true });

await build({
  entryPoints: [join(pkgDir, "src", "main.ts")],
  outfile: join(pkgDir, bins[0]),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  logLevel: "warning",
  plugins: [inlineWebpWasm],
  // pngjs is CommonJS and require()s Node built-ins; give the ESM bundle a real require.
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
  },
});
