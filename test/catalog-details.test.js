import assert from "node:assert/strict";
import test from "node:test";
import {COMMANDS, describeCommand} from "../src/commands.js";
import {runCli} from "../src/main.js";
import {renderYamlDocument} from "../src/yaml.js";

async function invoke(flags) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["commands", ...flags], {
    fetchImpl: async () => assert.fail("catalog must stay offline"),
    stdout: {write(value) { stdout += value; }},
    stderr: {write(value) { stderr += value; }}
  });
  return {exitCode, stdout, stderr};
}

test("detailed catalog returns the installed schemas for filtered public commands offline", async () => {
  const result = await invoke(["--details", "true", "--group", "historical", "--option", "period-interval"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  const definitions = COMMANDS.filter(({path, options}) => path[0] === "historical" &&
    options.some(({flag}) => flag === "period-interval"));
  assert.equal(result.stdout, renderYamlDocument({
    schema_version: 1, command: "commands", details: true,
    filters: {group: "historical", option: "period-interval"},
    count: definitions.length, commands: definitions.map(describeCommand)
  }));
  assert.match(result.stdout, /result_key: candlesticks/);
  assert.match(result.stdout, /flag: "--period-interval"/);
  assert.match(result.stdout, /required: true/);
  assert.match(result.stdout, /choices:/);
});

test("explicit false preserves the compact catalog and detailed empty results stay well formed", async () => {
  assert.deepEqual(await invoke(["--details", "false"]), await invoke([]));
  const empty = await invoke(["--details=true", "--group", "exchange", "--option", "cursor"]);
  assert.equal(empty.exitCode, 0);
  assert.match(empty.stdout, /details: true/);
  assert.match(empty.stdout, /count: 0\ncommands: \[\]/);
  assert.deepEqual(await invoke(["--no-details"]), await invoke([]));
  assert.match((await invoke(["--help"])).stdout, /--details\s+Include/);
});

test("invalid detail flags fail before output or fetching", async () => {
  for (const flags of [["--details=yes"], ["--details", "TRUE"], ["--no-details=false"],
    ["--details", "true", "--details", "false"]]) {
    const result = await invoke(flags);
    assert.equal(result.exitCode, 2, flags.join(" "));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /error:/);
  }
});

test("oversized detailed catalog fails atomically with a narrowing hint", async () => {
  const definition = COMMANDS[0];
  const previous = definition.helpNotes;
  try {
    definition.helpNotes = ["x".repeat(65536)];
    const result = await invoke(["--details", "true", "--group", "exchange"]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /code: output_too_large/);
    assert.match(result.stderr, /--group/);
  } finally {
    if (previous === undefined) delete definition.helpNotes;
    else definition.helpNotes = previous;
  }
});

test("the full detailed catalog and boolean shorthand work without requests", async () => {
  const result = await invoke(["--details"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, new RegExp(`count: ${COMMANDS.length}\\n`));
  assert.equal(result.stdout, (await invoke(["--details=true"])).stdout);
});

test("catalog discovers exact primary result keys offline", async () => {
  for (const key of [...new Set(COMMANDS.map(({resultKey}) => resultKey))]) {
    const result = await invoke(["--result-key", key]);
    const expected = COMMANDS.filter(({resultKey}) => resultKey === key);
    assert.equal(result.exitCode, 0, key);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, renderYamlDocument({
      schema_version: 1, command: "commands", filters: {result_key: key},
      count: expected.length,
      commands: expected.map(({name, summary, endpoint}) => ({command: name, summary, endpoint}))
    }));
  }
});

test("result key discovery composes with detailed schemas and existing catalog filters", async () => {
  const result = await invoke(["--details", "--result-key= markets ", "--group", "historical", "--pagination", "cursor"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /result_key: markets/);
  assert.match(result.stdout, /count: 1\ncommands:/);
  assert.match(result.stdout, /command: historical markets/);
  const empty = await invoke(["--result-key", "markets", "--group", "exchange"]);
  assert.equal(empty.exitCode, 0);
  assert.match(empty.stdout, /count: 0\ncommands: \[\]/);
  assert.match((await invoke(["--help"])).stdout, /--result-key <value>/);
});

test("malformed or unknown primary result keys fail before any output or request", async () => {
  for (const flags of [["--result-key"], ["--result-key", " "], ["--result-key", "Markets"],
    ["--result-key", "data"], ["--result-key", "market", "--result-key", "markets"]]) {
    const result = await invoke(flags);
    assert.equal(result.exitCode, 2, flags.join(" "));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /error:/);
  }
});

test("catalog excludes each known option without fetching or changing row order", async () => {
  for (const flag of [...new Set(COMMANDS.flatMap(({options}) => options.map(({flag}) => flag)))]) {
    const result = await invoke(["--exclude-option", flag]);
    const expected = COMMANDS.filter(({options}) => !options.some(option => option.flag === flag));
    assert.equal(result.exitCode, 0, flag);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, renderYamlDocument({
      schema_version: 1, command: "commands", filters: {exclude_option: flag},
      count: expected.length,
      commands: expected.map(({name, summary, endpoint}) => ({command: name, summary, endpoint}))
    }));
  }
});

test("option exclusions compose with detailed catalog discovery and contradictory filters", async () => {
  const result = await invoke(["--details", "--group", "markets", "--option", "ticker",
    "--pagination", "none", "--result-type", "object", "--required-option", "ticker",
    "--result-key", "orderbook_fp", "--exclude-option= cursor ", "--search", "ORDERBOOK"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  const expected = COMMANDS.find(({name}) => name === "markets orderbook");
  assert.equal(result.stdout, renderYamlDocument({
    schema_version: 1, command: "commands", details: true,
    filters: {group: "markets", search: "ORDERBOOK", option: "ticker", pagination: "none",
      result_type: "object", required_option: "ticker", result_key: "orderbook_fp", exclude_option: "cursor"},
    count: 1, commands: [describeCommand(expected)]
  }));
  const empty = await invoke(["--option", "ticker", "--exclude-option", "ticker"]);
  assert.equal(empty.exitCode, 0);
  assert.match(empty.stdout, /count: 0\ncommands: \[\]/);
  assert.match((await invoke(["--help"])).stdout, /--exclude-option <value>/);
  const unfiltered = await invoke([]);
  assert.equal(unfiltered.stdout, renderYamlDocument({schema_version: 1, command: "commands",
    count: COMMANDS.length, commands: COMMANDS.map(({name, summary, endpoint}) => ({command: name, summary, endpoint}))}));
});

test("unknown or malformed option exclusions fail atomically offline", async () => {
  for (const flags of [["--exclude-option"], ["--exclude-option", " "], ["--exclude-option", "Ticker"],
    ["--exclude-option", "--ticker"], ["--exclude-option", "unknown"],
    ["--exclude-option", "ticker", "--exclude-option", "cursor"]]) {
    const result = await invoke(flags);
    assert.equal(result.exitCode, 2, flags.join(" "));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /error:/);
  }
});

test("option search finds flags, provider parameters and descriptions offline", async () => {
  for (const needle of ["Unix timestamp", "min_ts", "PERIOD-INTERVAL", "not-a-real-option", "[a-z]"]) {
    const expected = COMMANDS.filter(({options}) => options.some(option =>
      [option.flag, option.query, option.pathName, option.description].some(value => value?.toLowerCase().includes(needle.toLowerCase()))));
    const result = await invoke(["--option-search", needle]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, renderYamlDocument({schema_version:1, command:"commands",
      filters:{option_search:needle}, count:expected.length,
      commands:expected.map(({name,summary,endpoint}) => ({command:name,summary,endpoint}))}));
  }
});
test("option search composes with catalog filters and detailed schemas", async () => {
  const result = await invoke(["--option-search= timestamp ", "--group", "historical", "--search", "trades", "--details", "--exclude-option", "period-interval"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, renderYamlDocument({schema_version:1, command:"commands", details:true,
    filters:{group:"historical",search:"trades",exclude_option:"period-interval",option_search:"timestamp"},
    count:1,commands:[describeCommand(COMMANDS.find(({name}) => name === "historical trades"))]}));
  assert.match((await invoke(["--help"])).stdout, /--option-search <value>/);
});
test("invalid option searches fail atomically without fetching", async () => {
  for (const flags of [["--option-search"],["--option-search", " "],["--option-search", "x".repeat(201)],
    ["--option-search", "ticker", "--option-search", "cursor"]]) {
    const result = await invoke(flags);
    assert.equal(result.exitCode,2);
    assert.equal(result.stdout,"");
    assert.match(result.stderr,/error:/);
  }
});
