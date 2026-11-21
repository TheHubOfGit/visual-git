// Bundle the TypeScript server and CLI into one dependency-free file,
// build/cli.mjs, so an installed copy needs nothing but Node itself.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

await build({
  entryPoints: [path.join(root, "server/cli.ts")],
  outfile: path.join(root, "build/cli.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "none",
  define: { __VISUAL_GIT_VERSION__: JSON.stringify(version) },
  // Express and its dependencies are CommonJS and call require() at runtime.
  banner: {
    js: 'import { createRequire as __vgCreateRequire } from "node:module";\nconst require = __vgCreateRequire(import.meta.url);'
  },
  logLevel: "warning"
});

console.log(`Bundled server -> build/cli.mjs (v${version})`);
