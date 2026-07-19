#!/usr/bin/env node
// Package every buildable Foundry module in packages/* into a CDN-ready release
// tree. For each module it:
//   1. reads packages/<id>/module.json
//   2. rewrites `url`, `manifest`, and `download` to the Timeweb CDN
//   3. stages module.json + dist/ + lang/ + README/LICENSE
//   4. zips the staged contents (module.json at the archive root)
//   5. writes release/<PREFIX>/<id>/module.json and
//      release/<PREFIX>/<id>/<id>-<version>.zip
//
// The GitHub Actions workflow (or a manual run) then uploads release/ to the
// bucket root, so keys line up 1:1 with the CDN URLs above.
//
// Env:
//   CDN_BASE        e.g. https://cdn.golarion.schmooky.dev   (no trailing slash)
//   CDN_PATH_PREFIX default "foundry-modules"
//   REPO_URL        default https://github.com/igaming-bulochka/foundry-modules
//   ONLY            optional comma-separated module ids to limit the run

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const PACKAGES = path.join(ROOT, "packages");
const RELEASE = path.join(ROOT, "release");

// Raw S3 bucket URL until DNS for foundry-modules.schmooky.dev is live; flip
// this (and the module setting default) to the pretty domain once it CNAMEs.
const CDN_BASE = (process.env.CDN_BASE || "https://s3.twcstorage.ru/foundry-modules").replace(/\/+$/, "");
// Empty by default: the CDN host is already foundry-modules.*, so modules live
// at the bucket root (…/globe-map/module.json). Set CDN_PATH_PREFIX to nest.
const PREFIX = (process.env.CDN_PATH_PREFIX ?? "").replace(/^\/+|\/+$/g, "");
const REPO_URL = process.env.REPO_URL || "https://github.com/igaming-bulochka/foundry-modules";
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);

/** Join CDN path parts, dropping empty segments so there are no double slashes. */
function cdnJoin(...parts) {
  return parts.filter((p) => p !== "" && p != null).join("/");
}

// Files/dirs never shipped in a release zip (large map data lives on the VPS,
// sources and sourcemaps are not needed by Foundry at runtime).
const EXCLUDE_TOP = new Set(["node_modules", "src", "tools", "styles", ".git"]);
const EXCLUDE_GLOB = [/\.map$/, /\.pmtiles$/, /\.tsbuildinfo$/];

function log(msg) {
  process.stdout.write(`[package] ${msg}\n`);
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyInto(src, destDir) {
  const base = path.basename(src);
  if (EXCLUDE_TOP.has(base)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    const out = path.join(destDir, base);
    fs.mkdirSync(out, { recursive: true });
    for (const entry of fs.readdirSync(src)) copyInto(path.join(src, entry), out);
  } else {
    if (EXCLUDE_GLOB.some((re) => re.test(base))) return;
    fs.copyFileSync(src, path.join(destDir, base));
  }
}

function rewriteManifest(mod, id, version) {
  const dir = cdnJoin(CDN_BASE, PREFIX, id);
  return {
    ...mod,
    url: REPO_URL,
    manifest: `${dir}/module.json`,
    download: `${dir}/${id}-${version}.zip`,
  };
}

function zipDir(contentsDir, zipPath) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  rmrf(zipPath);
  // Zip the *contents* (module.json at archive root) so Foundry extracts cleanly.
  execFileSync("zip", ["-r", "-q", zipPath, "."], { cwd: contentsDir, stdio: "inherit" });
}

function discoverModules() {
  return fs
    .readdirSync(PACKAGES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(PACKAGES, name, "module.json")))
    .filter((name) => ONLY.length === 0 || ONLY.includes(name));
}

function main() {
  rmrf(RELEASE);
  fs.mkdirSync(RELEASE, { recursive: true });

  const mods = discoverModules();
  if (mods.length === 0) {
    log("no modules with a module.json found; nothing to do");
    return;
  }

  const summary = [];
  for (const name of mods) {
    const pkgDir = path.join(PACKAGES, name);
    const mod = JSON.parse(fs.readFileSync(path.join(pkgDir, "module.json"), "utf8"));
    const id = mod.id || name;
    const version = String(mod.version || "0.0.0");

    if (!fs.existsSync(path.join(pkgDir, "dist"))) {
      log(`skip ${id}: no dist/ (run the build first)`);
      continue;
    }

    const outDir = path.join(RELEASE, PREFIX, id);
    const stageDir = path.join(RELEASE, ".stage", id);
    rmrf(stageDir);
    fs.mkdirSync(stageDir, { recursive: true });

    // Stage shipped files.
    const rewritten = rewriteManifest(mod, id, version);
    fs.writeFileSync(path.join(stageDir, "module.json"), JSON.stringify(rewritten, null, 2));
    for (const entry of ["dist", "lang", "packs", "templates", "assets", "README.md", "LICENSE"]) {
      const src = path.join(pkgDir, entry);
      if (fs.existsSync(src)) copyInto(src, stageDir);
    }

    // Emit the CDN layout.
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "module.json"), JSON.stringify(rewritten, null, 2));
    const zipPath = path.join(outDir, `${id}-${version}.zip`);
    zipDir(stageDir, zipPath);

    const bytes = fs.statSync(zipPath).size;
    summary.push({ id, version, zip: path.relative(ROOT, zipPath), kb: Math.round(bytes / 1024) });
    log(`packaged ${id}@${version} -> ${path.relative(ROOT, zipPath)} (${Math.round(bytes / 1024)} KB)`);
  }

  rmrf(path.join(RELEASE, ".stage"));

  fs.writeFileSync(
    path.join(RELEASE, "manifest-index.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), cdnBase: CDN_BASE, prefix: PREFIX, modules: summary }, null, 2),
  );
  log(`done: ${summary.length} module(s). Release tree at ${path.relative(ROOT, RELEASE)}/`);
}

main();
