import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";
import test from "node:test";

import {VERSION} from "../src/version.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function npmPackDryRun() {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("npm", ["pack", "--dry-run", "--json"], {
      cwd: packageRoot,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`npm pack failed (${code}): ${stderr}`));
      else resolvePromise(JSON.parse(stdout));
    });
  });
}

test("package metadata and dry-run contents preserve the public zero-dependency boundary", async () => {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.version, VERSION);
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.equal(manifest.bin.kalshi, "bin/kalshi.js");
  assert.deepEqual(manifest.publishConfig, {
    access: "public",
    registry: "https://registry.npmjs.org/"
  });
  assert.equal(manifest.repository.url, "git+https://github.com/jvorndran/kalshi-cli.git");

  const [result] = await npmPackDryRun();
  const files = new Set(result.files.map((entry) => entry.path.replaceAll("\\", "/")));
  for (const required of [
    "bin/kalshi.js",
    "src/main.js",
    "src/version.js",
    "skills/kalshi-cli/SKILL.md",
    "skills/kalshi-cli/agents/openai.yaml",
    "skills/kalshi-cli/references/command-contract.md",
    "README.md",
    "LICENSE"
  ]) assert.ok(files.has(required), `missing packed file: ${required}`);
  assert.ok([...files].every((path) => !path.startsWith("test/")), "test files must not be packed");
  assert.ok([...files].every((path) => !path.startsWith("scripts/")), "release scripts must not be packed");
  assert.ok([...files].every((path) => !path.startsWith(".github/")), "GitHub metadata must not be packed");
  assert.ok(!files.has("AGENTS.md"), "repository instructions must not be packed");
});
