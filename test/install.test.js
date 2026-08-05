import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtemp, mkdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

import {VERSION} from "../src/version.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const env = {...process.env};
    delete env.npm_config_dry_run;
    delete env.NPM_CONFIG_DRY_RUN;
    const child = spawn(command, args, {
      cwd: options.cwd ?? packageRoot,
      env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({code, stdout, stderr}));
  });
}

test("packed artifact installs offline and exposes the kalshi executable", {timeout: 30_000}, async () => {
  const root = await mkdtemp(join(tmpdir(), "kalshi-cli-install-"));
  const installRoot = join(root, "consumer");
  await mkdir(installRoot);

  try {
    const packed = await run("npm", ["pack", "--json", "--pack-destination", root]);
    assert.equal(packed.code, 0, packed.stderr);
    const [{filename}] = JSON.parse(packed.stdout);
    const tarball = join(root, filename);

    const installed = await run("npm", [
      "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", installRoot, tarball
    ]);
    assert.equal(installed.code, 0, installed.stderr);

    const executable = join(
      installRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "kalshi.cmd" : "kalshi"
    );
    const version = await run(executable, ["--version"], {cwd: installRoot});
    assert.equal(version.code, 0, version.stderr);
    assert.equal(version.stdout, `${VERSION}\n`);

    const help = await run(executable, ["--help"], {cwd: installRoot});
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /Public, unauthenticated, read-only Kalshi market data/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
