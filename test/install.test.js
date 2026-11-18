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

    const plan = await run(executable, ["plan", "markets", "--status", "open"], {cwd: installRoot});
    assert.equal(plan.code, 0, plan.stderr);
    assert.equal(plan.stderr, "");
    assert.match(plan.stdout, /^schema_version: 1\ncommand: plan\nrequest:/);
    assert.match(plan.stdout, /source_url: https:\/\/external-api\.kalshi\.com\/trade-api\/v2\/markets\?/);

    const weather = await run(executable, ["plan", "weather", "availability"], {cwd: installRoot});
    assert.equal(weather.code, 0, weather.stderr);
    assert.equal(weather.stderr, "");
    assert.match(weather.stdout, /endpoint: \/weather_point_markets\/availability/);

    const concerts = await run(executable, ["plan", "concerts", "availability", "--date-from", "2028-02-29"], {cwd: installRoot});
    assert.equal(concerts.code, 0, concerts.stderr);
    assert.equal(concerts.stderr, "");
    assert.match(concerts.stdout, /endpoint: \/concert_cancellation_markets\/availability/);
    assert.match(concerts.stdout, /date_from: "2028-02-29"/);

    const catalog = await run(executable, ["commands", "--group", "historical", "--search", "candlesticks", "--option", "period-interval", "--result-type", "array", "--required-option", "ticker"], {cwd: installRoot});
    assert.equal(catalog.code, 0, catalog.stderr);
    assert.equal(catalog.stderr, "");
    assert.match(catalog.stdout, /count: 1\ncommands:\n  - command: historical markets candlesticks\n/);
    assert.match(catalog.stdout, /  required_option: ticker\n/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
