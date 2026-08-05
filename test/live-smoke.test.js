import assert from "node:assert/strict";
import test from "node:test";

import {runCli} from "../src/main.js";

function captureStream() {
  let value = "";
  return {
    write(chunk) {
      value += String(chunk);
      return true;
    },
    text() {
      return value;
    }
  };
}

const live = process.env.KALSHI_LIVE_TESTS === "1" ? test : test.skip;

live("public endpoints work without credentials", {timeout: 45_000}, async () => {
  const previous = process.env.KALSHI_API_KEY;
  delete process.env.KALSHI_API_KEY;
  try {
    for (const argv of [["historical", "cutoff"], ["markets", "--limit", "1", "--status", "open"]]) {
      const stdout = captureStream();
      const stderr = captureStream();
      const exitCode = await runCli(argv, {stdout, stderr});
      assert.equal(exitCode, 0, stderr.text());
      assert.equal(stderr.text(), "");
      const document = JSON.parse(stdout.text());
      assert.equal(document.provider, "kalshi");
      assert.match(document.source_url, /^https:\/\/external-api\.kalshi\.com\/trade-api\/v2\//);
      assert.match(document.response_sha256, /^sha256:[0-9a-f]{64}$/);
    }
  } finally {
    if (previous === undefined) delete process.env.KALSHI_API_KEY;
    else process.env.KALSHI_API_KEY = previous;
  }
});
