// Assemble a self-contained copy of Visual Git that can be carried to any
// machine: release/visual-git/ plus a .zip (Windows) and .tar.gz (macOS/Linux).
// Run `npm run release`, which builds first.
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const releaseDir = path.join(root, "release");
const out = path.join(releaseDir, "visual-git");

for (const needed of ["build/cli.mjs", "dist/index.html"]) {
  if (!existsSync(path.join(root, needed))) {
    console.error(`Missing ${needed}. Run "npm run build" first (or use "npm run release").`);
    process.exit(1);
  }
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(path.join(out, "app", "build"), { recursive: true });

cpSync(path.join(root, "build/cli.mjs"), path.join(out, "app/build/cli.mjs"));
cpSync(path.join(root, "dist"), path.join(out, "app/dist"), { recursive: true });
writeFileSync(
  path.join(out, "app/package.json"),
  `${JSON.stringify({ name: "visual-git", version, type: "module", private: true }, null, 2)}\n`
);
writeFileSync(path.join(out, "VERSION"), `${version}\n`);

// Windows scripts need CRLF line endings; shell scripts need LF and the executable bit.
const packaging = path.join(root, "packaging");
for (const name of readdirSync(packaging)) {
  if (/\.(ico|png)$/i.test(name)) {
    // Icons are binary: copy them byte for byte.
    copyFileSync(path.join(packaging, name), path.join(out, name));
    continue;
  }
  const text = readFileSync(path.join(packaging, name), "utf8").replace(/\r\n/g, "\n");
  const windows = /\.(cmd|ps1|txt)$/i.test(name);
  const target = path.join(out, name);
  writeFileSync(target, windows ? text.replace(/\n/g, "\r\n") : text);
  if (!windows) chmodSync(target, 0o755);
}

function tryRun(command, args) {
  try {
    execFileSync(command, args, { cwd: releaseDir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const zipName = `visual-git-${version}.zip`;
const tarName = `visual-git-${version}.tar.gz`;
// `zip` on macOS/Linux; bsdtar (built into Windows 10+ and macOS) can also write zips.
const zipped = tryRun("zip", ["-qr", zipName, "visual-git"]) || tryRun("tar", ["-a", "-cf", zipName, "visual-git"]);
const tarred = tryRun("tar", ["-czf", tarName, "visual-git"]);

console.log(`Release folder: release/visual-git`);
console.log(zipped ? `Windows archive: release/${zipName}` : "Could not create the .zip (no zip or bsdtar found); zip release/visual-git by hand.");
console.log(tarred ? `macOS/Linux archive: release/${tarName}` : "Could not create the .tar.gz.");
