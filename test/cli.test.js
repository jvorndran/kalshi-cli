import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";

import {parseArguments} from "../src/args.js";
import {COMMANDS, SERIES_MAX_RESPONSE_BYTES} from "../src/commands.js";
import {executeRequest} from "../src/execute.js";
import {MAX_OUTPUT_BYTES, runCli} from "../src/main.js";
import {buildRequest, BASE_URL} from "../src/request.js";
import {VERSION} from "../src/version.js";
import {parseLosslessJson, renderYamlDocument} from "../src/yaml.js";

test("milestone live data makes one credential-free GET with an explicit player-stats boolean", async () => {
  for (const value of [undefined, "true", "false"]) {
    const flags = value === undefined ? [] : ["--include-player-stats", value];
    const parsed = parseArguments(["milestones", "live", "--milestone-id", "abc-123", ...flags]);
    const request = buildRequest(parsed.definition, parsed.values);
    const body = {live_data: {
      milestone_id: "abc-123", type: "football_game",
      details: {status: "in_progress", live_data_delayed: true, score: 0,
        player_stats: null, future_field: {amount_fp: "1.2300"}}
    }, additional: null};
    let calls = 0;
    const result = await executeRequest(parsed.definition, request, {fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url, `${BASE_URL}/live_data/milestone/abc-123${value === undefined ? "" : `?include_player_stats=${value}`}`);
      assert.equal(init.method, "GET");
      assert.equal(init.credentials, "omit");
      assert.deepEqual(Object.keys(init.headers).sort(), ["accept", "user-agent"]);
      return jsonResponse(body);
    }});
    assert.equal(calls, 1);
    assert.equal(result.count, 1);
    assert.deepEqual(result.query, value === undefined ? {} : {include_player_stats: value === "true"});
    assert.deepEqual(result.data, body);
    assert.match(renderYamlDocument(result), /player_stats: null/);
    assert.match(renderYamlDocument(result), /amount_fp: "1.2300"/);
  }
});

test("milestone live rejects unsafe or unsupported arguments before a request", async () => {
  for (const flags of [[], ["--milestone-id", "../portfolio"], ["--milestone-id", " "],
    ["--milestone-id", "ID", "--include-player-stats", "maybe"],
    ["--milestone-id", "ID", "--type", "football_game"],
    ["--milestone-id", "ID", "--cursor", "next"],
    ["--milestone-id", "ID", "--url", "https://example.com"]]) {
    let calls = 0;
    const result = await invoke(["milestones", "live", ...flags], {fetchImpl: async () => { calls += 1; }});
    assert.equal(result.exitCode, 2, flags.join(" "));
    assert.equal(result.stdout, "");
    assert.equal(calls, 0);
  }
});

test("milestone live preserves failures and rejects malformed responses atomically", async () => {
  const argv = ["milestones", "live", "--milestone-id", "ID"];
  for (const body of [{}, {live_data: null}, {live_data: []}, {live_data: "bad"}]) {
    const result = await invoke(argv, {fetchImpl: async () => jsonResponse(body)});
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(yamlErrorCode(result.stderr), "upstream_shape_error");
  }
  let calls = 0;
  const result = await invoke(argv, {fetchImpl: async () => {
    calls += 1;
    return jsonResponse({error: {message: "Live data not found"}}, {status: 404});
  }});
  assert.equal(calls, 1);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(yamlErrorCode(result.stderr), "kalshi_http_error");
  assert.match(result.stderr, /Live data not found/);
});

test("milestone live help describes delayed data without requesting it", async () => {
  const result = await invoke(["milestones", "live", "--help"], {fetchImpl: async () => { assert.fail("help must be offline"); }});
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /--milestone-id/);
  assert.match(result.stdout, /--include-player-stats/);
  assert.match(result.stdout, /cached|delayed/i);
});

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

test("all commands resolve to the fixed endpoint and response contract", () => {
  const cases = [
    [["exchange", "status"], "/exchange/status", "boolean"],
    [["exchange", "schedule"], "/exchange/schedule", "object"],
    [["milestones"], "/milestones", "array"],
    [["milestones", "get", "--milestone-id", "MILESTONE"], "/milestones/MILESTONE", "object"],
    [["milestones", "live", "--milestone-id", "MILESTONE"], "/live_data/milestone/MILESTONE", "object"],
    [["series", "--category", "Sports"], "/series", "array"],
    [["series", "tags"], "/search/tags_by_categories", "object"],
    [["series", "sports"], "/search/filters_by_sport", "object"],
    [["series", "fee-changes", "--series-ticker", "SERIES"], "/series/fee_changes", "array"],
    [["series", "get", "--series-ticker", "SERIES"], "/series/SERIES", "object"],
    [["collections"], "/multivariate_event_collections", "array"],
    [["collections", "get", "--collection-ticker", "COLLECTION"], "/multivariate_event_collections/COLLECTION", "object"],
    [["events"], "/events", "array"],
    [["events", "multivariate"], "/events/multivariate", "array"],
    [["events", "get", "--event-ticker", "EVENT"], "/events/EVENT", "object"],
    [["events", "metadata", "--event-ticker", "EVENT"], "/events/EVENT/metadata", "string"],
    [["events", "fee-changes"], "/events/fee_changes", "array"],
    [["events", "candlesticks", "--series-ticker", "SERIES", "--event-ticker", "EVENT", "--start-ts", "1", "--end-ts", "2", "--period-interval", "60"], "/series/SERIES/events/EVENT/candlesticks", "array"],
    [["markets"], "/markets", "array"],
    [["markets", "get", "--ticker", "MARKET"], "/markets/MARKET", "object"],
    [["markets", "orderbook", "--ticker", "MARKET"], "/markets/MARKET/orderbook", "object"],
    [["markets", "orderbooks", "--tickers", "MARKET"], "/markets/orderbooks", "array"],
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
  assert.deepEqual(COMMANDS.map((definition) => definition.name), cases.map(([argv]) => argv.filter((part) => !part.startsWith("--") && !/^\d+$/.test(part) && !["SERIES", "EVENT", "MARKET", "MILESTONE", "COLLECTION", "Sports"].includes(part)).join(" ")));
  for (const [argv, endpoint, resultType] of cases) {
    const parsed = parseArguments(argv);
    const request = buildRequest(parsed.definition, parsed.values);
    assert.equal(request.endpoint, endpoint, parsed.definition.name);
    assert.equal(parsed.definition.resultType, resultType, parsed.definition.name);
    assert.ok(request.url.startsWith(BASE_URL));
  }
});

test("batch orderbooks use repeated ticker parameters and preserve complete provider books", async () => {
  const parsed = parseArguments(["markets", "orderbooks", "--tickers", " MARKET-A, MARKET-B "]);
  const request = buildRequest(parsed.definition, parsed.values);
  assert.deepEqual(request.query, {tickers: ["MARKET-A", "MARKET-B"]});
  const body = {orderbooks: [
    {ticker: "MARKET-B", orderbook_fp: {yes_dollars: [["0.4500", "12.3400"]], no_dollars: []}},
    {ticker: "MARKET-A", orderbook_fp: {yes_dollars: [], no_dollars: [["0.5500", "0.0000"]]}}
  ], future_field: null};
  let calls = 0;
  const result = await executeRequest(parsed.definition, request, {fetchImpl: async (url, init) => {
    calls += 1;
    assert.equal(url, `${BASE_URL}/markets/orderbooks?tickers=MARKET-A&tickers=MARKET-B`);
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.deepEqual(Object.keys(init.headers).sort(), ["accept", "user-agent"]);
    return jsonResponse(body);
  }});
  assert.equal(calls, 1);
  assert.equal(result.count, 2);
  assert.deepEqual(result.data, body);
  const rendered = renderYamlDocument(result);
  assert.match(rendered, /"12.3400"/);
  assert.match(rendered, /future_field: null/);
  const empty = await invoke(["markets", "orderbooks", "--tickers", "MARKET"], {
    fetchImpl: async () => jsonResponse({orderbooks: []})
  });
  assert.equal(empty.exitCode, 0);
  assert.equal(yamlScalar(empty.stdout, "count"), 0);
});

test("batch orderbooks accept exactly 100 safe tickers and keep single-book requests unchanged", () => {
  const tickers = Array.from({length: 100}, (_, i) => `MARKET-${i}`);
  const parsed = parseArguments(["markets", "orderbooks", "--tickers", tickers.join(",")]);
  const request = buildRequest(parsed.definition, parsed.values);
  assert.deepEqual(new URL(request.url).searchParams.getAll("tickers"), tickers);
  const single = parseArguments(["markets", "orderbook", "--ticker", "MARKET", "--depth", "10"]);
  assert.equal(buildRequest(single.definition, single.values).url, `${BASE_URL}/markets/MARKET/orderbook?depth=10`);
});

test("batch orderbook arguments fail before any request", async () => {
  for (const flags of [
    [], ["--tickers", ""], ["--tickers", "A,,B"], ["--tickers", "../secret"],
    ["--tickers", "https://example.com"], ["--tickers", "A".repeat(201)],
    ["--tickers", Array(101).fill("MARKET").join(",")],
    ["--tickers", "MARKET", "--depth", "1"],
    ["--tickers", "MARKET", "--all"], ["--tickers", "MARKET", "--cursor", "next"]
  ]) {
    let calls = 0;
    const result = await invoke(["markets", "orderbooks", ...flags], {fetchImpl: async () => { calls += 1; }});
    assert.equal(result.exitCode, 2, flags.join(" "));
    assert.equal(result.stdout, "");
    assert.equal(calls, 0);
  }
});

test("batch orderbooks reject malformed responses and preserve provider failures", async () => {
  const argv = ["markets", "orderbooks", "--tickers", "MARKET"];
  for (const body of [{}, {orderbooks: {}}, {orderbooks: null}]) {
    const result = await invoke(argv, {fetchImpl: async () => jsonResponse(body)});
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(yamlErrorCode(result.stderr), "upstream_shape_error");
  }
  let calls = 0;
  const failed = await invoke(argv, {fetchImpl: async () => {
    calls += 1;
    return jsonResponse({error: {message: "Slow down"}}, {status: 429});
  }});
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.stdout, "");
  assert.equal(yamlErrorCode(failed.stderr), "kalshi_http_error");
  assert.equal(calls, 1);
});

test("batch orderbook help is offline and states its explicit bound", async () => {
  let calls = 0;
  const result = await invoke(["markets", "orderbooks", "--help"], {fetchImpl: async () => { calls += 1; }});
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /--tickers/);
  assert.match(result.stdout, /100/);
  assert.equal(calls, 0);
});

test("collections discovery forwards bounded filters and preserves provider collection rules", async () => {
  const parsed = parseArguments(["collections", "--limit", "2", "--cursor", "page+2/=", "--status", "open", "--associated-event-ticker", "EVENT", "--series-ticker", "SERIES"]);
  const request = buildRequest(parsed.definition, parsed.values);
  assert.deepEqual(request.query, {limit: 2, cursor: "page+2/=", status: "open", associated_event_ticker: "EVENT", series_ticker: "SERIES"});
  const body = {multivariate_contracts: [{collection_ticker: "COLLECTION", associated_events: [{ticker: "EVENT", is_yes_only: false, size_max: null}], size_min: 1, size_max: 4, is_ordered: false, price_ranges: [{start: "0.0000", end: "1.0000", step: "0.0100"}]}], cursor: "next", unknown: null};
  let calls = 0;
  const result = await executeRequest(parsed.definition, request, {fetchImpl: async (url, init) => {
    calls += 1;
    assert.equal(url, `${BASE_URL}/multivariate_event_collections?limit=2&cursor=page%2B2%2F%3D&status=open&associated_event_ticker=EVENT&series_ticker=SERIES`);
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers.authorization, undefined);
    return jsonResponse(body);
  }});
  assert.equal(calls, 1);
  assert.equal(result.count, 1);
  assert.deepEqual(result.data, body);
  const defaults = parseArguments(["collections"]);
  assert.deepEqual(buildRequest(defaults.definition, defaults.values).query, {limit: 10});
  const empty = await invoke(["collections"], {fetchImpl: async () => jsonResponse({multivariate_contracts: [], cursor: ""})});
  assert.equal(empty.exitCode, 0);
  assert.equal(yamlScalar(empty.stdout, "count"), 0);
});

test("collection detail requires a safe identifier and performs exactly one public GET", async () => {
  const body = {multivariate_contract: {collection_ticker: "COLLECTION", is_ordered: true, description: "Provider rules", unknown: null}};
  let calls = 0;
  const result = await invoke(["collections", "get", "--collection-ticker", "COLLECTION"], {fetchImpl: async (url, init) => {
    calls += 1;
    assert.equal(url, `${BASE_URL}/multivariate_event_collections/COLLECTION`);
    assert.equal(init.method, "GET");
    assert.equal(init.headers.authorization, undefined);
    return jsonResponse(body);
  }});
  assert.equal(result.exitCode, 0);
  assert.equal(calls, 1);
  assert.equal(yamlScalar(result.stdout, "count"), 1);
  assert.match(result.stdout, /unknown: null/);
});

test("collection validation rejects unsafe scopes and malformed responses without partial stdout", async () => {
  for (const flags of [["--limit", "0"], ["--limit", "201"], ["--status", "settled"], ["--associated-event-ticker", "../bad"], ["get"], ["get", "--collection-ticker", "https://example.com"]]) {
    let calls = 0;
    const result = await invoke(["collections", ...flags], {fetchImpl: async () => { calls += 1; }});
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(calls, 0);
  }
  for (const [args, body] of [
    [["collections"], {multivariate_contracts: {}}],
    [["collections", "get", "--collection-ticker", "COLLECTION"], {multivariate_contract: null}]
  ]) {
    const result = await invoke(args, {fetchImpl: async () => jsonResponse(body)});
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /upstream_shape_error/);
  }
});

test("multivariate events expose an existing collection's public events with explicit paging", async () => {
  const parsed = parseArguments(["events", "multivariate", "--limit", "2", "--cursor", "page+2/=", "--collection-ticker", "COLLECTION", "--tickers", "EVENT,EVENT2", "--with-nested-markets", "false"]);
  const request = buildRequest(parsed.definition, parsed.values);
  assert.deepEqual(request.query, {limit: 2, cursor: "page+2/=", collection_ticker: "COLLECTION", tickers: "EVENT,EVENT2", with_nested_markets: false});
  const body = {events: [{event_ticker: "EVENT", collateral_return_type: "", mutually_exclusive: false, markets: [{ticker: "MARKET", yes_bid_dollars: "0.123400", unknown: null}]}], cursor: "next"};
  let calls = 0;
  const result = await executeRequest(parsed.definition, request, {fetchImpl: async (url, init) => {
    calls += 1;
    assert.equal(url, `${BASE_URL}/events/multivariate?limit=2&cursor=page%2B2%2F%3D&collection_ticker=COLLECTION&tickers=EVENT%2CEVENT2&with_nested_markets=false`);
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers.authorization, undefined);
    return jsonResponse(body);
  }});
  assert.equal(calls, 1);
  assert.equal(result.count, 1);
  assert.deepEqual(result.data, body);
  const scoped = parseArguments(["events", "multivariate", "--series-ticker", "SERIES", "--with-nested-markets", "true"]);
  assert.deepEqual(buildRequest(scoped.definition, scoped.values).query, {limit: 10, series_ticker: "SERIES", with_nested_markets: true});
  const empty = await invoke(["events", "multivariate"], {fetchImpl: async () => jsonResponse({events: [], cursor: ""})});
  assert.equal(empty.exitCode, 0);
  assert.equal(yamlScalar(empty.stdout, "count"), 0);
});

test("multivariate discovery rejects incompatible and unsafe filters before a request", async () => {
  for (const flags of [
    ["--series-ticker", "SERIES", "--collection-ticker", "COLLECTION"],
    ["--limit", "0"], ["--limit", "201"], ["--collection-ticker", "../bad"],
    ["--with-nested-markets", "maybe"], ["--tickers", "EVENT,,OTHER"],
    ["--tickers", Array.from({length: 101}, (_, i) => `EVENT${i}`).join(",")]
  ]) {
    let calls = 0;
    const result = await invoke(["events", "multivariate", ...flags], {fetchImpl: async () => { calls += 1; }});
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(calls, 0);
  }
  const bad = await invoke(["events", "multivariate"], {fetchImpl: async () => jsonResponse({events: null})});
  assert.equal(bad.exitCode, 1);
  assert.equal(bad.stdout, "");
  assert.match(bad.stderr, /upstream_shape_error/);
  const help = await invoke(["events", "multivariate", "--help"]);
  assert.match(help.stdout, /Cannot combine/);
});

test("series fee changes preserve scheduled and historical fee evidence with one public GET", async () => {
  const argv = ["series", "fee-changes", "--series-ticker", "SERIES", "--show-historical", "false"];
  const parsed = parseArguments(argv);
  const body = {series_fee_change_arr: [{id: "change-1", series_ticker: "SERIES", fee_type: "quadratic", fee_multiplier: 0.5, scheduled_ts: "2026-10-20T00:00:00Z", unknown: null}], extra: "0.0100"};
  let calls = 0;
  const result = await executeRequest(parsed.definition, buildRequest(parsed.definition, parsed.values), {
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url, `${BASE_URL}/series/fee_changes?series_ticker=SERIES&show_historical=false`);
      assert.equal(init.method, "GET");
      assert.equal(init.credentials, "omit");
      assert.equal(init.headers.authorization, undefined);
      return jsonResponse(body);
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.data, body);
  assert.equal(result.count, 1);
  const historical = parseArguments(["series", "fee-changes", "--series-ticker", "SERIES", "--show-historical", "true"]);
  assert.equal(buildRequest(historical.definition, historical.values).query.show_historical, true);
  const empty = await invoke(["series", "fee-changes", "--series-ticker", "SERIES"], {fetchImpl: async () => jsonResponse({series_fee_change_arr: []})});
  assert.equal(empty.exitCode, 0);
  assert.equal(yamlScalar(empty.stdout, "count"), 0);
});

test("series fee discovery requires a safe bounded scope and validates its response atomically", async () => {
  let calls = 0;
  for (const flags of [[], ["--series-ticker", "../orders"], ["--series-ticker", "SERIES", "--show-historical", "yes"], ["--series-ticker", "SERIES", "--limit", "10"]]) {
    const result = await invoke(["series", "fee-changes", ...flags], {fetchImpl: async () => { calls += 1; }});
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  }
  assert.equal(calls, 0);
  const help = await invoke(["series", "fee-changes", "--help"]);
  assert.match(help.stdout, /--show-historical/);
  for (const body of [{}, {series_fee_change_arr: null}, {series_fee_change_arr: {}}]) {
    const result = await invoke(["series", "fee-changes", "--series-ticker", "SERIES"], {fetchImpl: async () => jsonResponse(body)});
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(yamlErrorCode(result.stderr), "upstream_shape_error");
  }
  const oversized = await invoke(["series", "fee-changes", "--series-ticker", "SERIES"], {
    fetchImpl: async () => jsonResponse({series_fee_change_arr: [], padding: "x".repeat(SERIES_MAX_RESPONSE_BYTES)})
  });
  assert.equal(oversized.exitCode, 1);
  assert.equal(oversized.stdout, "");
  assert.equal(yamlErrorCode(oversized.stderr), "response_too_large");
});

test("event fee changes preserve override resets and caller-controlled pagination", async () => {
  const argv = ["events", "fee-changes", "--event-ticker", "EVENT", "--limit", "2", "--cursor", "page+2/="];
  const parsed = parseArguments(argv);
  const request = buildRequest(parsed.definition, parsed.values);
  assert.equal(request.endpoint, "/events/fee_changes");
  assert.deepEqual(request.query, {event_ticker: "EVENT", limit: 2, cursor: "page+2/="});
  const body = {event_fee_changes: [{id: "change", event_ticker: "EVENT", series_ticker: "SERIES", fee_type_override: null, fee_multiplier_override: null, scheduled_ts: "2026-10-20T00:00:00Z", unknown: "0.0100"}], cursor: "next", extra: false};
  let calls = 0;
  const result = await executeRequest(parsed.definition, request, {fetchImpl: async (url, init) => {
    calls += 1;
    assert.equal(new URL(url).searchParams.get("cursor"), "page+2/=");
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers.authorization, undefined);
    return jsonResponse(body);
  }});
  assert.equal(calls, 1);
  assert.deepEqual(result.data, body);
  assert.equal(result.count, 1);
  const defaults = parseArguments(["events", "fee-changes"]);
  assert.deepEqual(buildRequest(defaults.definition, defaults.values).query, {limit: 10});
  const empty = await invoke(["events", "fee-changes"], {fetchImpl: async () => jsonResponse({event_fee_changes: [], cursor: ""})});
  assert.equal(empty.exitCode, 0);
  assert.equal(yamlScalar(empty.stdout, "count"), 0);
});

test("event fee changes reject invalid options before requests and invalid shapes atomically", async () => {
  let calls = 0;
  for (const flags of [["--limit", "0"], ["--limit", "1001"], ["--event-ticker", "../orders"], ["--all"], ["--show-historical", "true"]]) {
    const result = await invoke(["events", "fee-changes", ...flags], {fetchImpl: async () => { calls += 1; }});
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  }
  assert.equal(calls, 0);
  for (const body of [{}, {event_fee_changes: null}, {event_fee_changes: {}}]) {
    const result = await invoke(["events", "fee-changes"], {fetchImpl: async () => jsonResponse(body)});
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(yamlErrorCode(result.stderr), "upstream_shape_error");
  }
  const help = await invoke(["events", "fee-changes", "--help"]);
  assert.match(help.stdout, /--event-ticker/);
  assert.match(help.stdout, /--cursor/);
});

test("milestone discovery maps filters, preserves the response, and leaves pagination caller-controlled", async () => {
  const argv = ["milestones", "--category", "Sports", "--competition", "College Football", "--type", "football_game", "--source-id", "provider:123", "--related-event-ticker", "EVENT", "--min-updated-ts", "0", "--cursor", "page+2/="];
  const parsed = parseArguments(argv);
  const request = buildRequest(parsed.definition, parsed.values);
  assert.deepEqual(request.query, {limit: 10, cursor: "page+2/=", category: "Sports", competition: "College Football", type: "football_game", source_id: "provider:123", related_event_ticker: "EVENT", min_updated_ts: 0});
  const body = {milestones: [{id: "abc-123", start_date: "2026-10-17T19:00:00Z", related_event_tickers: ["EVENT"], details: {score: null, precise: "0.0100"}}], cursor: "next", unknown: false};
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(new URL(url).pathname, "/trade-api/v2/milestones");
    assert.equal(new URL(url).searchParams.get("competition"), "College Football");
    assert.equal(new URL(url).searchParams.get("cursor"), "page+2/=");
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "omit");
    assert.equal(Object.keys(options.headers).some((key) => /authorization|kalshi-access/i.test(key)), false);
    return jsonResponse(body);
  };
  const result = await executeRequest(parsed.definition, request, {fetchImpl});
  assert.deepEqual(result.data, body);
  assert.equal(result.count, 1);
  assert.equal(calls, 1);
  const cli = await invoke(argv, {fetchImpl});
  assert.equal(cli.exitCode, 0);
  assert.equal(cli.stderr, "");
  assert.match(cli.stdout, /score: null/);
  assert.match(cli.stdout, /precise: "0.0100"/);
  assert.match(cli.stdout, /cursor: next/);
  assert.equal(calls, 2);
});

test("milestones can be bounded by scheduled start independently of metadata updates", async () => {
  const timestamp = "2026-10-17T12:34:56.123-04:00";
  const parsed = parseArguments(["milestones", "--minimum-start-date", timestamp, "--min-updated-ts", "0"]);
  const request = buildRequest(parsed.definition, parsed.values);
  assert.deepEqual(request.query, {limit: 10, minimum_start_date: timestamp, min_updated_ts: 0});
  let calls = 0;
  const result = await invoke(["milestones", "--minimum-start-date", timestamp], {
    fetchImpl: async (url) => {
      calls += 1;
      assert.equal(new URL(url).searchParams.get("minimum_start_date"), timestamp);
      assert.equal(new URL(url).searchParams.has("min_updated_ts"), false);
      return jsonResponse({milestones: [], cursor: ""});
    }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(calls, 1);
  const blank = await invoke(["milestones", "--minimum-start-date", " "], {fetchImpl: async () => { calls += 1; }});
  assert.equal(blank.exitCode, 2);
  assert.equal(blank.stdout, "");
  assert.equal(calls, 1);
});

test("milestone lookup uses a discovered ID and validates both response shapes", async () => {
  const parsed = parseArguments(["milestones", "get", "--milestone-id", "abc-123"]);
  const request = buildRequest(parsed.definition, parsed.values);
  assert.equal(request.url, `${BASE_URL}/milestones/abc-123`);
  assert.deepEqual(request.query, {});
  const body = {milestone: {id: "abc-123", details: {unknown: null}}};
  const result = await executeRequest(parsed.definition, request, {fetchImpl: async () => jsonResponse(body)});
  assert.deepEqual(result.data, body);
  assert.equal(result.count, 1);
  for (const [argv, bodies] of [
    [["milestones"], [{}, {milestones: {}}, {milestones: null}]],
    [["milestones", "get", "--milestone-id", "abc-123"], [{}, {milestone: []}, {milestone: null}]]
  ]) {
    for (const invalid of bodies) {
      const cli = await invoke(argv, {fetchImpl: async () => jsonResponse(invalid)});
      assert.equal(cli.exitCode, 1);
      assert.equal(cli.stdout, "");
      assert.equal(yamlErrorCode(cli.stderr), "upstream_shape_error");
    }
  }
  const empty = await invoke(["milestones"], {fetchImpl: async () => jsonResponse({milestones: [], cursor: ""})});
  assert.equal(empty.exitCode, 0);
  assert.equal(yamlScalar(empty.stdout, "count"), 0);
});

test("milestone help and invalid invocations never fetch", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; };
  for (const argv of [["milestones", "--help"], ["milestones", "get", "--help"]]) {
    const result = await invoke(argv, {fetchImpl});
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /milestone/i);
  }
  for (const argv of [
    ["milestones", "get"], ["milestones", "get", "--milestone-id", "../orders"],
    ["milestones", "--limit", "0"], ["milestones", "--limit", "201"],
    ["milestones", "--min-updated-ts", "-1"], ["milestones", "--category", " "],
    ["milestones", "--all"], ["milestones", "--url", "https://example.com"]
  ]) {
    const result = await invoke(argv, {fetchImpl});
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  }
  assert.equal(calls, 0);
});

test("sports discovery preserves filters, provider ordering, nulls, and unknown fields", async () => {
  const body = {
    filters_by_sports: {Football: {scopes: ["Game"], competitions: ["College"]}},
    sport_ordering: ["Football", "Basketball"],
    unknown: {precise: "0.0100", nullable: null}
  };
  const parsed = parseArguments(["series", "sports"]);
  const request = buildRequest(parsed.definition, parsed.values);
  assert.deepEqual(request.query, {});
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls += 1;
    assert.equal(url, `${BASE_URL}/search/filters_by_sport`);
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "omit");
    assert.equal(Object.keys(options.headers).some((key) => /authorization|kalshi-access/i.test(key)), false);
    return jsonResponse(body);
  };
  const result = await executeRequest(parsed.definition, request, {fetchImpl});
  assert.deepEqual(result.data, body);
  assert.equal(result.count, 1);
  const cli = await invoke(["series", "sports"], {fetchImpl});
  assert.equal(cli.exitCode, 0);
  assert.equal(cli.stderr, "");
  assert.match(cli.stdout, /filters_by_sports:/);
  assert.match(cli.stdout, /sport_ordering:/);
  assert.match(cli.stdout, /nullable: null/);
  assert.equal(calls, 2);
});

test("sports discovery validates the provider shape and remains offline for help and invalid flags", async () => {
  for (const body of [{}, {filters_by_sports: null}, {filters_by_sports: []}, {filters_by_sports: "Football"}]) {
    const result = await invoke(["series", "sports"], {fetchImpl: async () => jsonResponse(body)});
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(yamlErrorCode(result.stderr), "upstream_shape_error");
  }
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error("unexpected network"); };
  const help = await invoke(["series", "sports", "--help"], {fetchImpl});
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /series sports/);
  const invalid = await invoke(["series", "sports", "--category", "Sports"], {fetchImpl});
  assert.equal(invalid.exitCode, 2);
  assert.equal(invalid.stdout, "");
  assert.equal(calls, 0);
});

test("exchange commands preserve status and schedule data with one unauthenticated GET", async () => {
  for (const [name, body] of [
    ["status", {exchange_active: false, trading_active: false, exchange_estimated_resume_time: null, unknown: "0.0100"}],
    ["schedule", {schedule: {standard_hours: [], maintenance_windows: [{start_datetime: "2026-10-15T00:00:00Z", end_datetime: "2026-10-15T01:00:00Z"}]}, unknown: null}]
  ]) {
    const parsed = parseArguments(["exchange", name]);
    const request = buildRequest(parsed.definition, parsed.values);
    let calls = 0;
    const result = await executeRequest(parsed.definition, request, {fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, `${BASE_URL}/exchange/${name}`);
      assert.equal(options.method, "GET");
      assert.equal(options.credentials, "omit");
      assert.equal(options.headers.authorization, undefined);
      return jsonResponse(body);
    }});
    assert.equal(calls, 1);
    assert.deepEqual(result.query, {});
    assert.deepEqual(result.data, body);
    assert.equal(result.count, 1);
    const cli = await invoke(["exchange", name], {fetchImpl: async () => jsonResponse(body)});
    assert.equal(cli.exitCode, 0);
    assert.equal(cli.stderr, "");
    assert.match(cli.stdout, /count: 1/);
    assert.match(cli.stdout, /unknown:/);
  }
});

test("exchange shape failures leave stdout empty", async () => {
  for (const [name, body] of [["status", {}], ["status", {exchange_active: "false"}], ["status", {exchange_active: null}], ["schedule", {schedule: []}]]) {
    const result = await invoke(["exchange", name], {fetchImpl: async () => jsonResponse(body)});
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(yamlErrorCode(result.stderr), "upstream_shape_error");
  }
});

test("exchange help and invalid options never request data", async () => {
  for (const name of ["status", "schedule"]) {
    let calls = 0;
    const options = {fetchImpl: async () => { calls += 1; }};
    assert.equal((await invoke(["exchange", name, "--help"], options)).exitCode, 0);
    const invalid = await invoke(["exchange", name, "--limit", "10"], options);
    assert.equal(invalid.exitCode, 2);
    assert.equal(invalid.stdout, "");
    assert.equal(calls, 0);
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
    assert.equal(request.query.limit, 10, parsed.definition.name);
    assert.match(request.url, /[?&]limit=10(?:&|$)/);
  }
});

test("series help explains its required filter and safety cap", async () => {
  const result = await invoke(["series", "--help"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /List filtered public market series \(requires a filter\)/);
  assert.match(result.stdout, /Supply one of --category, --tags, or --min-updated-ts/);
  assert.match(result.stdout, /over 64 KiB/);
});

test("formatted YAML output is capped without writing partial stdout", async () => {
  const result = await invoke(["markets", "--limit", "1"], {
    fetchImpl: async () => jsonResponse({markets: [{ticker: "TEST", padding: "x".repeat(MAX_OUTPUT_BYTES)}]})
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(yamlErrorCode(result.stderr), "output_too_large");
  assert.match(yamlScalar(result.stderr, "message", 2), /Formatted YAML output exceeds/);
  assert.match(yamlScalar(result.stderr, "hint", 2), /smaller --limit/);
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

test("event metadata makes one credential-free GET and preserves the complete provider response", async () => {
  const body = {
    image_url: "https://example.com/event.png",
    featured_image_url: null,
    market_details: [{market_ticker: "EVENT-A", image_url: "", color_code: "#123456"}],
    settlement_sources: [{name: "Official source", url: "https://example.com/results"}],
    competition: "College Football",
    competition_scope: "Game",
    future_field: {amount_fp: "1.2300", available: false}
  };
  let calls = 0;
  const parsed = parseArguments(["events", "metadata", "--event-ticker", "EVENT"]);
  const request = buildRequest(parsed.definition, parsed.values);
  const result = await executeRequest(parsed.definition, request, {
    fetchImpl: async (url, init) => {
      calls += 1;
      assert.equal(url, `${BASE_URL}/events/EVENT/metadata`);
      assert.equal(init.method, "GET");
      assert.equal(init.credentials, "omit");
      assert.deepEqual(Object.keys(init.headers).sort(), ["accept", "user-agent"]);
      return jsonResponse(body);
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.count, 1);
  assert.deepEqual(result.query, {});
  assert.deepEqual(result.data, body);
  const rendered = renderYamlDocument(result);
  assert.match(rendered, /featured_image_url: null/);
  assert.match(rendered, /amount_fp: "1.2300"/);
});

test("event metadata requires a safe event ticker before any request and documents the lookup", async () => {
  for (const flags of [[], ["--event-ticker", " "], ["--event-ticker", "../account"], ["--event-ticker", "EVENT", "--url", "https://example.com"]]) {
    let calls = 0;
    const result = await invoke(["events", "metadata", ...flags], {fetchImpl: async () => { calls += 1; }});
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.equal(calls, 0);
  }
  const help = await invoke(["events", "metadata", "--help"]);
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /--event-ticker/);
  assert.match(help.stdout, /settlement sources/i);
});

test("event metadata accepts empty image strings and rejects a missing or invalid primary field atomically", async () => {
  const valid = await invoke(["events", "metadata", "--event-ticker", "EVENT"], {
    fetchImpl: async () => jsonResponse({image_url: "", market_details: [], settlement_sources: []})
  });
  assert.equal(valid.exitCode, 0);
  assert.equal(yamlScalar(valid.stdout, "count"), 1);
  for (const body of [{}, {image_url: null}, {image_url: []}]) {
    const result = await invoke(["events", "metadata", "--event-ticker", "EVENT"], {fetchImpl: async () => jsonResponse(body)});
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.equal(yamlErrorCode(result.stderr), "upstream_shape_error");
  }
});
