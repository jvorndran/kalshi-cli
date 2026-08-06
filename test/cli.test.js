import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";

import {parseArguments} from "../src/args.js";
import {COMMANDS, SERIES_MAX_RESPONSE_BYTES} from "../src/commands.js";
import {executeRequest} from "../src/execute.js";
import {runCli} from "../src/main.js";
import {buildRequest, BASE_URL} from "../src/request.js";
import {VERSION} from "../src/version.js";
import {parseLosslessJson, renderYamlDocument} from "../src/yaml.js";

function captureStream() {
  const chunks = [];
  return {
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    text() {
      return chunks.join("");
    }
  };
}

async function invoke(argv, options = {}) {
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCode = await runCli(argv, {stdout, stderr, ...options});
  return {exitCode, stdout: stdout.text(), stderr: stderr.text()};
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {"content-type": "application/json", ...init.headers}
  });
}

function yamlScalar(document, key, indent = 0) {
  const match = document.match(new RegExp(`^${" ".repeat(indent)}${key}: (.+)$`, "m"));
  assert.ok(match, `missing YAML scalar: ${key}`);
  const value = match[1];
  if (value.startsWith('"')) return JSON.parse(value);
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function yamlErrorCode(document) {
  return yamlScalar(document, "code", 2);
}

test("root help is offline and lists the public command surface", async () => {
  let calls = 0;
  const result = await invoke(["--help"], {fetchImpl: async () => { calls += 1; }});
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /markets candlesticks batch/);
  assert.match(result.stdout, /historical cutoff/);
  assert.equal(result.stderr, "");
  assert.equal(calls, 0);
});

test("all 17 commands resolve to the fixed endpoint and response contract", () => {
  const cases = [
    [["series", "--category", "Sports"], "/series", "array"],
    [["series", "tags"], "/search/tags_by_categories", "object"],
    [["series", "get", "--series-ticker", "SERIES"], "/series/SERIES", "object"],
    [["events"], "/events", "array"],
    [["events", "get", "--event-ticker", "EVENT"], "/events/EVENT", "object"],
    [["events", "candlesticks", "--series-ticker", "SERIES", "--event-ticker", "EVENT", "--start-ts", "1", "--end-ts", "2", "--period-interval", "60"], "/series/SERIES/events/EVENT/candlesticks", "array"],
    [["markets"], "/markets", "array"],
    [["markets", "get", "--ticker", "MARKET"], "/markets/MARKET", "object"],
    [["markets", "orderbook", "--ticker", "MARKET"], "/markets/MARKET/orderbook", "object"],
    [["markets", "trades"], "/markets/trades", "array"],
    [["markets", "candlesticks", "--series-ticker", "SERIES", "--ticker", "MARKET", "--start-ts", "1", "--end-ts", "2", "--period-interval", "60"], "/series/SERIES/markets/MARKET/candlesticks", "array"],
    [["markets", "candlesticks", "batch", "--market-tickers", "MARKET", "--start-ts", "1", "--end-ts", "2", "--period-interval", "5"], "/markets/candlesticks", "array"],
    [["historical", "cutoff"], "/historical/cutoff", "string"],
    [["historical", "markets"], "/historical/markets", "array"],
    [["historical", "markets", "get", "--ticker", "MARKET"], "/historical/markets/MARKET", "object"],
    [["historical", "markets", "candlesticks", "--ticker", "MARKET", "--start-ts", "1", "--end-ts", "2", "--period-interval", "60"], "/historical/markets/MARKET/candlesticks", "array"],
    [["historical", "trades"], "/historical/trades", "array"]
  ];
  assert.equal(COMMANDS.length, cases.length);
  assert.deepEqual(COMMANDS.map((definition) => definition.name), cases.map(([argv]) => argv.filter((part) => !part.startsWith("--") && !/^\d+$/.test(part) && !["SERIES", "EVENT", "MARKET", "Sports"].includes(part)).join(" ")));
  for (const [argv, endpoint, resultType] of cases) {
    const parsed = parseArguments(argv);
    const request = buildRequest(parsed.definition, parsed.values);
    assert.equal(request.endpoint, endpoint, parsed.definition.name);
    assert.equal(parsed.definition.resultType, resultType, parsed.definition.name);
    assert.ok(request.url.startsWith(BASE_URL));
  }
});

test("market get maps an encoded path and preserves the raw provider document", async () => {
  const raw = {
    market: {
      ticker: "KXNCAAFGAME-TEST",
      yes_bid_dollars: "0.4100",
      yes_ask_dollars: "0.4300",
      volume_fp: "1234.00",
      nullable_field: null,
      future_field: {kept: true}
    }
  };
  const rawText = JSON.stringify(raw);
  const calls = [];
  const dates = [new Date("2026-08-04T20:00:00.000Z"), new Date("2026-08-04T20:00:00.125Z")];
  const result = await invoke(["markets", "get", "--ticker", "KXNCAAFGAME-TEST"], {
    now: () => dates.shift(),
    fetchImpl: async (url, options) => {
      calls.push({url, options});
      return new Response(rawText, {status: 200, headers: {"content-type": "application/json"}});
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${BASE_URL}/markets/KXNCAAFGAME-TEST`);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.headers.authorization, undefined);
  assert.equal(calls[0].options.headers["user-agent"], `@jvorndran/kalshi-cli/${VERSION}`);

  assert.equal(yamlScalar(result.stdout, "count"), 1);
  assert.equal(yamlScalar(result.stdout, "requested_at"), "2026-08-04T20:00:00.000Z");
  assert.equal(yamlScalar(result.stdout, "observed_at"), "2026-08-04T20:00:00.125Z");
  assert.equal(yamlScalar(result.stdout, "response_sha256"), `sha256:${createHash("sha256").update(rawText).digest("hex")}`);
  assert.match(result.stdout, /data:\n  market:\n    ticker: KXNCAAFGAME-TEST/);
  assert.match(result.stdout, /yes_bid_dollars: "0\.4100"/);
  assert.match(result.stdout, /nullable_field: null/);
  assert.match(result.stdout, /future_field:\n      kept: true/);
  assert.ok(result.stdout.endsWith("\n"));
  assert.ok(!result.stdout.endsWith("\n\n"));
});

test("provider number lexemes remain lossless in CLI output", async () => {
  const rawText = '{"markets":[{"ticker":"TEST","unsafe_integer":9007199254740993,"large_exponent":1e400}]}';
  const result = await invoke(["markets"], {
    fetchImpl: async () => new Response(rawText, {status: 200, headers: {"content-type": "application/json"}})
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /unsafe_integer: 9007199254740993/);
  assert.match(result.stdout, /large_exponent: 1e400/);
  assert.equal(yamlScalar(result.stdout, "count"), 1);
});

test("series list and series get use different response-shape contracts", async () => {
  const list = await invoke(["series", "--category", "Sports", "--include-volume=false"], {
    fetchImpl: async (url) => {
      assert.equal(url, `${BASE_URL}/series?category=Sports&include_volume=false`);
      return jsonResponse({series: [{ticker: "KXNCAAFGAME"}]});
    }
  });
  assert.equal(list.exitCode, 0);
  assert.equal(yamlScalar(list.stdout, "count"), 1);

  const get = await invoke(["series", "get", "--series-ticker", "KXNCAAFGAME"], {
    fetchImpl: async () => jsonResponse({series: {ticker: "KXNCAAFGAME"}})
  });
  assert.equal(get.exitCode, 0);
  assert.match(get.stdout, /data:\n  series:\n    ticker: KXNCAAFGAME/);
});

test("oversized unpaginated series results fail without polluting stdout", async () => {
  const result = await invoke(["series", "--category", "Sports"], {
    fetchImpl: async () => jsonResponse({series: [{ticker: "TEST", padding: "x".repeat(SERIES_MAX_RESPONSE_BYTES)}]})
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(yamlErrorCode(result.stderr), "response_too_large");
  assert.match(yamlScalar(result.stderr, "hint", 2), /kalshi series tags/);
});

test("YAML rendering quotes ambiguous strings and preserves nulls and empty collections", () => {
  const provider = parseLosslessJson('{"true":".5","values":["true","2026-08-05T00:00:00Z","0.5600",null,{},[]]}');
  assert.equal(renderYamlDocument({data: provider}), [
    "data:",
    '  "true": ".5"',
    "  values:",
    '    - "true"',
    '    - "2026-08-05T00:00:00Z"',
    '    - "0.5600"',
    "    - null",
    "    - {}",
    "    - []",
    ""
  ].join("\n"));
});

test("options map exactly and pagination remains caller-controlled", () => {
  const parsed = parseArguments([
    "events", "--limit", "25", "--cursor", "next_page", "--series-ticker", "KXNCAAFGAME",
    "--status", "open", "--with-nested-markets", "false"
  ]);
  const request = buildRequest(parsed.definition, parsed.values);
  assert.deepEqual(request.query, {
    limit: 25,
    cursor: "next_page",
    with_nested_markets: false,
    status: "open",
    series_ticker: "KXNCAAFGAME"
  });
  assert.equal(
    request.url,
    `${BASE_URL}/events?limit=25&cursor=next_page&with_nested_markets=false&status=open&series_ticker=KXNCAAFGAME`
  );
});

test("paginated list commands default to a small caller-visible page", () => {
  for (const argv of [["events"], ["markets"], ["markets", "trades"], ["historical", "markets"], ["historical", "trades"]]) {
    const parsed = parseArguments(argv);
    const request = buildRequest(parsed.definition, parsed.values);
    assert.equal(request.query.limit, 20, parsed.definition.name);
    assert.match(request.url, /[?&]limit=20(?:&|$)/);
  }
});

test("batch candles accept arbitrary positive minute intervals and normalize ticker CSV", () => {
  const parsed = parseArguments([
    "markets", "candlesticks", "batch",
    "--market-tickers", "AAA, BBB",
    "--start-ts", "100",
    "--end-ts", "200",
    "--period-interval", "5"
  ]);
  const request = buildRequest(parsed.definition, parsed.values);
  assert.deepEqual(request.query, {
    market_tickers: "AAA,BBB",
    start_ts: 100,
    end_ts: 200,
    period_interval: 5
  });
});

for (const [name, argv, code, message] of [
  ["unknown options", ["markets", "--all"], "unknown_option", "--all"],
  ["duplicate options", ["markets", "--limit", "1", "--limit", "2"], "duplicate_option", "more than once"],
  ["unfiltered unpaginated series", ["series"], "invalid_query", "unpaginated endpoint"],
  ["missing required values", ["markets", "get"], "missing_required_option", "--ticker is required"],
  ["invalid tickers", ["markets", "get", "--ticker", "../orders"], "invalid_argument", "ticker"],
  ["invalid event ticker CSV values", ["events", "--tickers", "GOOD,../orders"], "invalid_argument", "invalid ticker"],
  ["invalid live-market ticker CSV values", ["markets", "--tickers", "GOOD,../orders"], "invalid_argument", "invalid ticker"],
  ["invalid historical-market ticker CSV values", ["historical", "markets", "--tickers", "GOOD,../orders"], "invalid_argument", "invalid ticker"],
  ["invalid candle ranges", ["markets", "candlesticks", "--series-ticker", "SERIES", "--ticker", "MARKET", "--start-ts", "2", "--end-ts", "1", "--period-interval", "60"], "invalid_query", "less than or equal"],
  ["invalid candle intervals", ["markets", "candlesticks", "--series-ticker", "SERIES", "--ticker", "MARKET", "--start-ts", "1", "--end-ts", "2", "--period-interval", "5"], "invalid_argument", "one of"],
  ["reversed market timestamp ranges", ["markets", "--min-created-ts", "2", "--max-created-ts", "1"], "invalid_query", "minimum created timestamp"],
  ["incompatible live market filters", ["markets", "--min-updated-ts", "1", "--status", "open"], "invalid_query", "cannot be combined"],
  ["multiple historical primary filters", ["historical", "markets", "--series-ticker", "SERIES", "--event-ticker", "EVENT"], "invalid_query", "only one"]
]) {
  test(`${name} fail locally without a network request`, async () => {
    let calls = 0;
    const result = await invoke(argv, {fetchImpl: async () => { calls += 1; }});
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(yamlErrorCode(result.stderr), code);
    assert.match(yamlScalar(result.stderr, "message", 2), new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    assert.equal(calls, 0);
  });
}

test("historical cutoff validates and counts the string cutoff", async () => {
  const result = await invoke(["historical", "cutoff"], {
    fetchImpl: async () => jsonResponse({
      market_settled_ts: "2026-06-05T00:00:00Z",
      trades_created_ts: "2026-06-05T00:00:00Z"
    })
  });
  assert.equal(result.exitCode, 0);
  assert.equal(yamlScalar(result.stdout, "count"), 1);
});

test("provider errors are normalized without leaking arbitrary request headers", async () => {
  const result = await invoke(["markets", "--limit", "1"], {
    fetchImpl: async () => jsonResponse({error: {code: "rate_limited", message: "Slow down", details: "public quota"}}, {status: 429})
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(yamlErrorCode(result.stderr), "kalshi_http_error");
  assert.equal(yamlScalar(result.stderr, "status", 2), 429);
  assert.equal(yamlScalar(result.stderr, "message", 2), "Slow down");
  assert.match(yamlScalar(result.stderr, "hint", 2), /caller-controlled/);
  assert.equal(yamlScalar(result.stderr, "endpoint", 2), "/markets");
  assert.match(result.stderr, /query:\n    limit: 1/);
});

test("deep provider error details are bounded and remain structured", async () => {
  const nesting = 12_000;
  const rawText = `{"error":{"message":"Nested failure","details":${"[".repeat(nesting)}null${"]".repeat(nesting)}}}`;
  const result = await invoke(["markets"], {
    fetchImpl: async () => new Response(rawText, {status: 500, headers: {"content-type": "application/json"}})
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(yamlErrorCode(result.stderr), "kalshi_http_error");
  assert.equal(yamlScalar(result.stderr, "message", 2), "Nested failure");
  assert.match(result.stderr, /truncated/);
});

test("unexpected provider shapes fail closed", async () => {
  const result = await invoke(["markets"], {fetchImpl: async () => jsonResponse({markets: {not: "an array"}})});
  assert.equal(result.exitCode, 1);
  assert.equal(yamlErrorCode(result.stderr), "upstream_shape_error");
});

test("response-size limits are enforced before reading the body", async () => {
  const parsed = parseArguments(["markets"]);
  const request = buildRequest(parsed.definition, parsed.values);
  await assert.rejects(
    executeRequest(parsed.definition, request, {
      maxResponseBytes: 10,
      fetchImpl: async () => new Response("{}", {headers: {"content-length": "11"}})
    }),
    (error) => error.code === "response_too_large" && error.endpoint === "/markets"
  );
});

test("response-size limits are enforced while reading chunked bodies", async () => {
  const parsed = parseArguments(["markets"]);
  const request = buildRequest(parsed.definition, parsed.values);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("123456"));
      controller.enqueue(new TextEncoder().encode("789012"));
      controller.close();
    }
  });
  await assert.rejects(
    executeRequest(parsed.definition, request, {
      maxResponseBytes: 10,
      fetchImpl: async () => new Response(body, {headers: {"content-type": "application/json"}})
    }),
    (error) => error.code === "response_too_large" && error.endpoint === "/markets"
  );
});

for (const [name, response, code] of [
  ["empty", new Response("", {status: 200}), "upstream_empty_response"],
  ["non-JSON", new Response("not json", {status: 200}), "upstream_invalid_json"]
]) {
  test(`${name} upstream responses return stable errors`, async () => {
    const result = await invoke(["markets"], {fetchImpl: async () => response});
    assert.equal(result.exitCode, 1);
    assert.equal(yamlErrorCode(result.stderr), code);
  });
}

test("timeouts abort the public request and return a stable error", async () => {
  const result = await invoke(["markets"], {
    timeoutMs: 5,
    fetchImpl: async (_url, {signal}) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {once: true});
    })
  });
  assert.equal(result.exitCode, 1);
  assert.equal(yamlErrorCode(result.stderr), "network_timeout");
});

test("timeouts also interrupt a stalled response body", async () => {
  const result = await invoke(["markets"], {
    timeoutMs: 5,
    fetchImpl: async (_url, {signal}) => new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener("abort", () => controller.error(signal.reason), {once: true});
      }
    }))
  });
  assert.equal(result.exitCode, 1);
  assert.equal(yamlErrorCode(result.stderr), "network_timeout");
});
