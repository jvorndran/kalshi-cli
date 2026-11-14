---
name: kalshi-cli
description: Retrieve and preserve public, unauthenticated Kalshi series, events, market metadata, current quote fields, bid-side orderbooks, trades, candlesticks, and historical market data through the read-only kalshi CLI. Use for prediction-market discovery, contract verification, price-history research, liquidity evidence, or reproducible Kalshi snapshots. Never authenticate, trade, or invent contract identity.
---

# Kalshi Public CLI

Use `kalshi` as a narrow evidence-retrieval tool. It exposes only a fixed set of public `GET` endpoints and returns the provider response unchanged inside a deterministic YAML provenance envelope.

## Workflow

1. Confirm the tool before retrieval.
   - Use `kalshi exchange status` for public availability and `kalshi exchange schedule` for trading hours and maintenance windows when assessing an interruption. An inactive flag is data, not a command failure; these commands do not gate or retry other requests.
   - Run `kalshi --version` and the smallest relevant `--help` command.
   - If `kalshi` is unavailable, report that limitation. Do not replace it with an authenticated client, arbitrary HTTP wrapper, or trading SDK.

2. Discover the contract instead of constructing a ticker.
   - Run `kalshi series sports` for the official sport scopes, competitions, and `sport_ordering`. It accepts no flags and makes one public GET; use the metadata to guide discovery, then verify actual event and market identity.
   - Use `kalshi series fee-changes --series-ticker SERIES` for scheduled fee types, multipliers and effective times; add `--show-historical true` for past changes. This unpaginated public GET requires one safe series ticker and caps raw responses at 64 KiB. Preserve `series_fee_change_arr` as evidence; do not infer trading costs.
   - Run `kalshi series tags` to inspect the compact official category/tag index, then use `--category`, `--tags`, or `--min-updated-ts`; the CLI rejects an unfiltered full-catalog request because Kalshi does not paginate that route.
   - If a filtered series response exceeds its 64 KiB safety cap, refine the filter. Never work around the guard by fetching and truncating Kalshi data elsewhere.
   - Narrow through `events` and `markets`. Their default page size is 10; request a larger `--limit` only when the additional records are needed, and split requests if the formatted YAML output cap is reached.
   - Verify the series, event, market ticker, title, close time, status, and resolution rules against the exact user question.
   - Stop at `unresolved_identity` when the game, contract side, threshold, or rules cannot be matched safely.

3. Retrieve only the evidence needed.
   - Use `kalshi milestones game-stats --milestone-id ID_FROM_DISCOVERY` to retrieve play-by-play statistics in one public GET `/live_data/milestone/{milestone_id}/game_stats`. The unchanged `data.pbp` object contains provider periods and events. A null `pbp` is preserved with count zero for unsupported milestones or missing provider mappings; it does not prove that no game occurred. Objects have count one. No polling, retries, credentials, or follow-up calls are added; cached or delayed play-by-play does not establish freshness. The existing output cap applies; this endpoint has no pagination or narrowing flags. Oversized responses fail before stdout is written; `milestones live` offers a compact snapshot.
   - Use `kalshi structured-targets --type football_player --competition NCAAF --page-size 10` to discover public target identities and source IDs. Optional `--ids ID_A,ID_B` becomes repeated `ids` query parameters (up to 2000). Pages default to 10 (1–2000); pass `data.cursor` explicitly as `--cursor` to continue. Inspect a returned ID with `structured-targets get --structured-target-id ID`. Each command makes one unauthenticated GET and preserves names, details, source IDs, nulls, and unknown fields in `data`. Target identity does not establish market rules or live-data freshness.
   - Use `events live --event-ticker EVENT` for event-keyed crypto, commodity, or weather live data in one public GET. Optional `--range` is a provider chart-window hint, not a guaranteed restriction. Preserve type, details, historical flags and ranges; cached or delayed data does not establish freshness. No polling or follow-up calls are implicit.
   - Use `milestones --category Sports --type football_game --minimum-start-date RFC3339` for upcoming milestone IDs and related event tickers, optionally scoped by `--competition`, `--source-id`, or `--related-event-ticker`. The scheduled-start bound is passed unchanged for provider validation; `--min-updated-ts` filters metadata updates independently. Names come from provider data; an empty result is not proof of absence. Lists default to 10 (CLI bounds 1–200) with explicit `--cursor`; inspect one returned ID with `milestones get --milestone-id ID`. Milestone timing and details do not replace market resolution rules.
   - Use `events metadata --event-ticker EVENT` for settlement-source URLs, competition/scope, image URLs, and market metadata in one public GET with no query. It returns `count: 1` and unchanged provider data; URLs are never fetched automatically. Verify rules separately with `markets get`.
   - Use `events fee-changes --event-ticker EVENT` for public fee overrides and scheduled resets. The event scope is optional; one page defaults to 10 (1–1000) and continuation needs an explicit `--cursor`. Preserve null overrides: they clear the override and fall back to the parent series. Do not calculate trading costs or fetch parent data automatically.
   - Use `milestones live --milestone-id ID` for provider live data in one public GET; optional `--include-player-stats true` requests supported player statistics (Pro Football, Pro Basketball, College Men's Basketball with player mappings). Explicit false is preserved; omission uses the provider default. Keep the complete `data.live_data` object and count one. Its status updates more often than milestone metadata, but cached data may still be stale; absence of `live_data_delayed` never proves freshness. No polling, retry, or follow-up is implicit. Verify market rules and freshness independently.
   - Use `milestones live batch --milestone-ids ID_A,ID_B` for 1–100 discovered IDs in one public GET with repeated `milestone_ids` query parameters. Optional `--include-player-stats true/false` matches the single-milestone command. Preserve `data.live_datas`, order, nulls and delay indicators; missing entries or delay flags establish neither coverage nor freshness. No implicit polling or follow-up.
   - Use `markets get` for current market fields and rules.
   - Use `markets orderbook` for current YES and NO bid depth.
   - Use `markets orderbooks --tickers TICKER_A,TICKER_B` for up to 100 verified market books in one public GET. The API receives repeated ticker query parameters and `query.tickers` is an array; preserve `data.orderbooks` and its provider order/precision. No depth, cursor, retries, or implicit follow-up; use the single-book command for a depth limit.
   - Use `markets trades` for prints and candlestick commands for time-series history.
   - Use `incentives --status active --type liquidity` for public reward-program metadata. Optional status, type, and exact `--incentive-description` filters go to the provider. One page defaults to 10 (1–10000); continue with `data.next_cursor` as `--cursor`. Preserve reward units and all provider values in `data.incentive_programs`; no trading or follow-up is implicit.
   - Check `historical cutoff` before assuming an older market remains on the live routes. Switch to the matching `historical` command when required.
   - Read [references/command-contract.md](references/command-contract.md) for the full command surface and live-versus-historical workflow.

4. Preserve provenance and provider precision.
   - Use `events multivariate --collection-ticker COLLECTION` to read existing combination events. Alternatively scope by `--series-ticker`; the two cannot be combined. Optional `--tickers` accepts at most 100, and `--with-nested-markets true` includes markets. Default page10 (1–200), explicit cursor, one public GET, no creation or implicit follow-up.
   - Discover multivariate collections with `collections --status open`, optionally scoped by `--associated-event-ticker` or `--series-ticker`. Use `collections get --collection-ticker COLLECTION` to inspect associated events, size/ordering constraints, and price ranges. Lists default to 10 (1–200) and continue only with an explicit cursor; both commands are public GETs that preserve provider values and never create a combination.
   - Parse stdout and stderr as one newline-terminated YAML document. Retain `command`, `endpoint`, `query`, `source_url`, `requested_at`, `observed_at`, `response_sha256`, `count`, and unchanged `data`.
   - Successful formatted YAML responses are capped at 64 KiB. A structured `output_too_large` error means the caller should narrow the filter, lower `--limit`, or shorten a candle range.
   - Preserve fixed-point price, volume, and open-interest strings exactly. Convert them only in a separate, stated calculation.
   - Keep each response's caller-controlled cursor. Never invent `--all`, automatic pagination, or implicit retries. Leave nested markets, milestones, product metadata, and volume disabled unless the task needs them.
   - Store immutable raw captures outside version control unless the user explicitly authorizes a suitable artifact destination and provider terms permit redistribution.

5. Interpret conservatively.
   - A candlestick close or last trade is historical evidence, not a current executable quote.
   - An orderbook contains bid levels. Do not invent an ask or midpoint; derive one only in a downstream analysis that states the formula and verifies complement and settlement assumptions.
   - Do not map a Kalshi binary contract to a sportsbook spread, total, or moneyline unless the event identity, selected side, threshold, timing, and resolution rules are compatible.
   - Treat an empty result as no returned record for that query, not proof that no relevant contract exists.

## Failure handling

Use the structured error code, command, endpoint, query, status, and hint. Correct local invocation errors before retrying. On `429`, leave retry timing caller controlled. On `401`, report that the supposedly public route may have changed; never add credentials. Preserve successful earlier evidence when a later page or historical lookup fails.

## Safety boundary

This skill retrieves decision-support evidence only. It never reads credentials, accesses portfolio or order endpoints, opens a WebSocket, places a trade, sizes a position, or promises an edge. Route statistical interpretation to the relevant research skill after the raw market identity and provenance are secure.

Use `kalshi weather --city miami --last-sec 300` for a bounded public city temperature index. Alternatively, pair `--from` and `--to` with inclusive Unix millisecond boundaries; do not combine them with `--last-sec` (seconds). Add `--detailed true` for per-station readings and quality-control dispositions, or pass `false` explicitly. One unauthenticated GET preserves the full `timeseries`, units, configuration, unknown fields, nulls, precision, and missing-minute gaps. Published values are Fahrenheit. Incomplete points and labelled historical backfills are not canonical settlement values; verify market rules separately. No polling, retries, or follow-up calls occur. Narrow the window or omit station detail if the existing output cap is reached.

Use `kalshi weather calibrations --city miami` to inspect the complete published configuration timeline in one public GET. Each record retains its effective and publication times, configuration version, station weights and offsets, city reference, and provider notes. Offsets and the city reference are Celsius; the published temperature index is Fahrenheit. Provider order, precision, nulls, and unknown fields remain unchanged. This route has no time-window or pagination flags and does not fetch index observations automatically. If the complete timeline exceeds the output cap, the command fails with empty stdout; it never truncates the evidence.

Use `kalshi markets --min-updated-ts 0 --max-updated-ts 100` for a bounded metadata-update window. The lower bound is exclusive and the upper bound inclusive, in non-negative safe-integer Unix seconds; equal bounds are accepted and reversed bounds fail locally. These timestamps track non-trading metadata changes, not quote updates. Either bound excludes event/ticker/status and other timestamp filters; optional `--series-ticker` requires `--mve-filter exclude`. Pagination remains caller-controlled with one public GET per invocation; provider data and order are unchanged.

Run `kalshi commands` to list the installed public GET commands as YAML. The catalog gives each command's path, summary, and endpoint template without making a request. Pass a listed command path to `kalshi describe` for its options.

Use `kalshi commands --group historical --search candlesticks` to narrow the offline catalog. `--group` selects an exact top-level group; `--search` matches a case-insensitive literal substring in names, summaries, or endpoint templates (1–200 characters after trimming). Filters compose, preserve catalog order, and appear in `filters`; `count` reflects matches, including zero with `commands: []`. Request flags remain invalid here. `kalshi commands --help` lists valid groups.

Use `kalshi plan <command> [options]` to validate and preview an installed public request offline. It applies the normal defaults, required flags, bounds and cross-option rules, then emits versioned YAML with `command: plan` and `request` fields for the command, GET method, endpoint, query and exact `source_url`. It never fetches, reads credentials or writes files. A plan does not establish provider availability or freshness. The 64 KiB output cap and structured errors still apply. Omit `plan` to execute.

Use `kalshi describe markets candlesticks` (or any supported command path) to inspect versioned YAML command metadata without making a request. The document lists the GET route template, result key/type, flag types, required flags, defaults, numeric bounds, choices, CSV limits, parameter locations and available command notes. Supply only the command path, without request flags. This is local CLI metadata, not provider data or a complete cross-option validation schema; consult `kalshi <command> --help` and the command contract for combinations and time-range rules. Normal invocations still validate all inputs before fetching. Descriptions need no credentials, never write files and are deterministic for the installed version.

Use `kalshi commands --option cursor` to find commands with that exact supported option. Supply the bare, case-sensitive name, such as `ticker` or `period-interval`, without leading hyphens. Unknown option names fail locally. This filter combines with `--group` and `--search`, preserves catalog order and row fields, and records the normalized name in `filters.option`. It works offline; it does not set an option on a public request.

Use `kalshi commands --pagination cursor` to discover commands that accept a caller-supplied cursor, or `--pagination none` for commands without a cursor option. This describes the installed CLI's options, not whether a provider response is complete. The filter works offline, combines with group, search, and option filters, and records its value in `filters.pagination`. It preserves catalog order and row fields; it does not fetch or follow pages. Other values fail locally.

Use `commands --result-type array|object|string|boolean` to discover primary result shapes offline; combine with the other catalog filters. See the command contract for scope and validation.
