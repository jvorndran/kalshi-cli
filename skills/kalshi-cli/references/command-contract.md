# Kalshi CLI Command Contract

The CLI uses the fixed base URL `https://external-api.kalshi.com/trade-api/v2`, public `GET` requests, deterministic YAML output, a 30-second timeout, a 20 MiB raw-response limit, and a 64 KiB formatted-output limit. It does not read Kalshi environment variables or accept arbitrary hosts, methods, headers, bodies, or paths. Successful and failed invocations each emit at most one newline-terminated YAML document on their designated stream.

## Commands

| Command | Endpoint | Required flags | Primary result |
| --- | --- | --- | --- |
| `kalshi exchange status` | `/exchange/status` | none | top-level availability fields |
| `kalshi weather` | `/live_data/weather/{city}` | `--city` and either `--last-sec` or paired `--from`/`--to` | `timeseries[]`; unchanged Fahrenheit values, gaps, status, and optional station audits |
| `kalshi weather calibrations` | `/live_data/weather/{city}/calibrations` | `--city` | `calibrations[]`; complete provider timeline, Celsius offsets/reference, unchanged station order and precision |
| `kalshi exchange schedule` | `/exchange/schedule` | none | `schedule` |
| `kalshi structured-targets` | `/structured_targets` | none | `structured_targets[]`; optional repeated IDs, type, competition, page-size10 (1–2000), explicit cursor |
| `kalshi structured-targets get` | `/structured_targets/{structured_target_id}` | `--structured-target-id` | `structured_target`; unchanged metadata, count one |
| `kalshi incentives` | `/incentive_programs` | none | `incentive_programs[]`; optional status/type/exact description, limit 10 (1–10000), explicit `data.next_cursor` continuation |
| `kalshi milestones` | `/milestones` | none | `milestones[]` |
| `kalshi milestones get` | `/milestones/{milestone_id}` | `--milestone-id` | `milestone` |
| `kalshi milestones game-stats` | `/live_data/milestone/{milestone_id}/game_stats` | `--milestone-id` | `pbp` object or null; count one or zero, unchanged periods/events, no polling |
| `kalshi milestones live` | `/live_data/milestone/{milestone_id}` | `--milestone-id` | `live_data`; optional boolean `--include-player-stats`, one public GET, count one, unchanged status/delay/details; cached data may be stale even without a delay flag |
| `kalshi milestones live batch` | `/live_data/batch` | `--milestone-ids` (1–100 safe comma-separated IDs) | `live_datas[]`; repeated query parameters, optional explicit `--include-player-stats`, no pagination or polling |
| `kalshi series` | `/series` | one of `--category`, `--tags`, `--min-updated-ts` | `series[]` |
| `kalshi series tags` | `/search/tags_by_categories` | none | `tags_by_categories` |
| `kalshi series sports` | `/search/filters_by_sport` | none | `filters_by_sports` plus `sport_ordering` |
| `kalshi series fee-changes` | `/series/fee_changes` | `--series-ticker` (CLI scope requirement) | `series_fee_change_arr[]`; optional explicit boolean `--show-historical`, unpaginated, 64 KiB response cap |
| `kalshi series get` | `/series/{series_ticker}` | `--series-ticker` | `series` |
| `kalshi events` | `/events` | none | `events[]` |
| `kalshi events multivariate` | `/events/multivariate` | none | `events[]`; mutually exclusive `--series-ticker`/`--collection-ticker`, optional `--tickers` (up to100), explicit `--with-nested-markets`, limit10 (1–200), explicit cursor |
| `kalshi collections` | `/multivariate_event_collections` | none | `multivariate_contracts[]`; optional `--status` (unopened/open/closed), `--associated-event-ticker`, `--series-ticker`, limit 10 (1–200), explicit cursor |
| `kalshi collections get` | `/multivariate_event_collections/{collection_ticker}` | `--collection-ticker` | `multivariate_contract`; unchanged associated-event constraints, nulls, ordering, price ranges |
| `kalshi events get` | `/events/{event_ticker}` | `--event-ticker` | `event` |
| `kalshi events live` | `/live_data/events/{event_ticker}` | `--event-ticker` | `live_data`; optional `--range` chart-window hint, count one, unchanged flexible details and historical flags |
| `kalshi events metadata` | `/events/{event_ticker}/metadata` | `--event-ticker` | top-level metadata fields |
| `kalshi events fee-changes` | `/events/fee_changes` | none | `event_fee_changes[]`; optional `--event-ticker`, limit 10 (1–1000), explicit `--cursor`; null override resets preserved |
| `kalshi events candlesticks` | `/series/{series_ticker}/events/{ticker}/candlesticks` | series ticker, event ticker, start, end, interval | `market_tickers[]` plus parallel candle arrays |
| `kalshi markets` | `/markets` | none | `markets[]` |
| `kalshi markets get` | `/markets/{ticker}` | `--ticker` | `market` |
| `kalshi markets orderbook` | `/markets/{ticker}/orderbook` | `--ticker` | `orderbook_fp` |
| `kalshi markets orderbooks` | `/markets/orderbooks` | `--tickers` | `orderbooks[]`; 1-100 safe comma-separated tickers, encoded as repeated query parameters; `query.tickers` is an array; no depth or pagination |
| `kalshi markets trades` | `/markets/trades` | none | `trades[]` |
| `kalshi markets candlesticks` | `/series/{series_ticker}/markets/{ticker}/candlesticks` | series ticker, market ticker, start, end, interval | `candlesticks[]` |
| `kalshi markets candlesticks batch` | `/markets/candlesticks` | market tickers, start, end, interval | `markets[]` |
| `kalshi historical cutoff` | `/historical/cutoff` | none | cutoff timestamp fields |
| `kalshi historical markets` | `/historical/markets` | none | `markets[]` |
| `kalshi historical markets get` | `/historical/markets/{ticker}` | `--ticker` | `market` |
| `kalshi historical markets candlesticks` | `/historical/markets/{ticker}/candlesticks` | ticker, start, end, interval | `candlesticks[]` |
| `kalshi historical trades` | `/historical/trades` | none | `trades[]` |

Run `kalshi <command> --help` for the exact optional flags. The shell uses kebab-case flags and emits the API's documented snake_case query names in the output envelope.

## Discover a CFB contract

Use currently observed metadata; series names can change.

```powershell
kalshi series tags
kalshi series --category Sports --tags Football
kalshi events --series-ticker <VERIFIED_SERIES> --status open
kalshi markets --event-ticker <VERIFIED_EVENT> --status open
kalshi markets get --ticker <VERIFIED_MARKET>
```

Candidate series may describe game winners, spread thresholds, or total thresholds, but the ticker is only a discovery hint. Verify the title, game participants, selected side, strike or threshold, close time, and resolution rules from the returned market.

## Capture current quote and liquidity evidence

```powershell
kalshi markets get --ticker <VERIFIED_MARKET>
kalshi markets orderbook --ticker <VERIFIED_MARKET> --depth 10
kalshi markets trades --ticker <VERIFIED_MARKET> --limit 10
```

Keep these as separately observed snapshots. Orderbook depth accepts `0` through `100`; `0` requests all available levels. The orderbook returns YES and NO bids, not guaranteed executable asks. Trades are prints and may be stale. Current market fields can also be stale or thin, so preserve timestamps, liquidity, and spread evidence.

## Capture price history

For a live or recent market:

```powershell
kalshi markets candlesticks --series-ticker <VERIFIED_SERIES> --ticker <VERIFIED_MARKET> --start-ts <UNIX_SECONDS> --end-ts <UNIX_SECONDS> --period-interval 60 --include-latest-before-start
```

For several markets, use a comma-separated list of at most 100 tickers:

```powershell
kalshi markets candlesticks batch --market-tickers <TICKER_1,TICKER_2> --start-ts <UNIX_SECONDS> --end-ts <UNIX_SECONDS> --period-interval 5
```

Single-market, event, and historical candles accept intervals of `1`, `60`, or `1440` minutes. Batch candles accept a positive integer minute interval and are limited by Kalshi to 100 tickers and 10,000 returned candles. Preserve `adjusted_end_ts` when Kalshi truncates or adjusts the request.

If the live route no longer covers the market:

```powershell
kalshi historical cutoff
kalshi historical markets --series-ticker <VERIFIED_SERIES>
kalshi historical markets candlesticks --ticker <VERIFIED_MARKET> --start-ts <UNIX_SECONDS> --end-ts <UNIX_SECONDS> --period-interval 60
kalshi historical trades --ticker <VERIFIED_MARKET> --limit 10
```

Live and historical candle schemas differ. Preserve the raw response rather than coercing one into the other during retrieval.

## Pagination and query limits

- Paginated event, market, and trade list commands apply a caller-visible default `--limit 10`.
- `events` accepts explicit page limits of 1–200 records; market and trade list commands accept 0–1000.
- `series tags` returns Kalshi's compact official category/tag index for discovery.
- `series` is unpaginated, requires `--category`, `--tags`, or `--min-updated-ts`, and has a 64 KiB raw-response cap. Oversized results fail without writing partial or locally truncated data to stdout.
- Pass the returned `cursor` into the next explicit request. There is no automatic pagination.
- Nested markets, milestones, product metadata, and volume are opt-in response expansions.
- Any successful formatted response over 64 KiB fails with `output_too_large`; lower `--limit`, narrow filters, or shorten candle ranges.
- `--start-ts` must be at most `--end-ts`; `--min-ts` must be at most `--max-ts`.
- Live market timestamp-filter families cannot be mixed. Historical market primary filters are mutually exclusive.
- A structured error and nonzero exit leave stdout empty. Local invocation errors use exit code 2; provider, network, timeout, and response-contract errors use exit code 1.

## Milestone discovery

`milestones` accepts `--limit` (default 10, CLI bounds 1–200), `--cursor`, `--minimum-start-date` (RFC3339 scheduled-start bound, passed unchanged for provider validation), `--category`, `--competition`, `--type`, `--source-id`, `--related-event-ticker`, and `--min-updated-ts` (non-negative Unix seconds, filtering metadata update time independently of scheduled start). Flags map directly to the corresponding snake_case query names. `milestones get` requires a discovered `--milestone-id` (1–200 letters, numbers, periods, underscores, or hyphens, starting with a letter or number) and sends no query. Both make exactly one public unauthenticated GET and preserve timing, related/primary event tickers, nested details, source IDs, nulls, and unknown fields inside `data`. Lists never follow cursors automatically.

## Event metadata

`events metadata` requires a discovered `--event-ticker` using the same safe ticker validation as `events get`. It sends no query parameters and makes exactly one public, credential-free GET. The required string `image_url` identifies the response shape; the complete response, including `featured_image_url`, `market_details`, `settlement_sources`, competition/scope, empty arrays, nulls, and unknown fields, stays unchanged inside `data`. Successful lookup reports `count: 1`, including an empty image string or metadata arrays. It does not fetch returned URLs or follow related markets. Inspect market rules separately.

## Exchange availability

`kalshi exchange status` and `kalshi exchange schedule` each make one public, unauthenticated GET with no query parameters. Both return `count: 1`, including when `exchange_active` is false. Availability flags, optional resume estimates, per-index status, standard hours, maintenance windows, and unknown provider fields remain unchanged in `data`. A successful status response reports availability; inactive trading is not a CLI error. Neither command automatically retries, polls, or gates other commands.

Use `kalshi events live --event-ticker EVENT_FROM_DISCOVERY` to retrieve event-keyed live data such as crypto charts, commodity timeseries, or weather observations. Optional `--range 15min` passes a chart-window hint where the data type supports it; omit it for the provider default. The single public GET `/live_data/events/{event_ticker}` returns `count: 1` and preserves `data.live_data.type`, flexible `details`, historical flags, available ranges, nulls, and precision. Data may be cached or delayed. No polling or follow-up requests are implicit.

Use `kalshi structured-targets --type football_player --competition NCAAF --page-size 10` to discover public target identities and source IDs. Optional `--ids ID_A,ID_B` becomes repeated `ids` query parameters (up to 2000). Pages default to 10 (1–2000); pass `data.cursor` explicitly as `--cursor` to continue. Inspect a returned ID with `structured-targets get --structured-target-id ID`. Each command makes one unauthenticated GET and preserves names, details, source IDs, nulls, and unknown fields in `data`. Target identity does not establish market rules or live-data freshness.

Use `kalshi milestones game-stats --milestone-id ID_FROM_DISCOVERY` to retrieve play-by-play statistics in one public GET `/live_data/milestone/{milestone_id}/game_stats`. The unchanged `data.pbp` object contains provider periods and events. A null `pbp` is preserved with count zero for unsupported milestones or missing provider mappings; it does not prove that no game occurred. Objects have count one. No polling, retries, credentials, or follow-up calls are added; cached or delayed play-by-play does not establish freshness. The existing output cap applies; this endpoint has no pagination or narrowing flags. Oversized responses fail before stdout is written; `milestones live` offers a compact snapshot.

`markets` accepts `--min-updated-ts` (exclusive) and `--max-updated-ts` (inclusive) in non-negative safe-integer Unix seconds for non-trading metadata updates. Either may stand alone; minimum must not exceed maximum. Either bound excludes event/ticker/status and other timestamp filters. A series scope requires `--mve-filter exclude`; `mve_filter=only` is incompatible. Limit and explicit cursor remain available, with one public GET and unchanged provider data.

Run `kalshi commands` to list the installed public GET commands as YAML. The catalog gives each command's path, summary, and endpoint template without making a request. Pass a listed command path to `kalshi describe` for its options.

Catalog filters are local: `--group` selects one exact, case-sensitive top-level command group and `--search` selects a case-insensitive literal substring in any command name, summary, or endpoint template. Search is trimmed, must contain 1–200 characters, and rejects embedded control characters. Group and search filters accept `--flag=value` or separate values and combine with AND semantics. Duplicate filters, unknown groups, request flags, and positional arguments fail before any request with empty stdout and a structured error. Filtered output adds `filters` in group/search/option order, includes only supplied normalized values, and keeps the original command order and row fields. `count` is the match count; an empty match succeeds with `commands: []`. An unfiltered invocation retains its existing output. Use `kalshi commands --group historical --search candlesticks` to find the archived candle route offline.

`kalshi plan <command> [options]` applies the same local parsing, defaults, required flags, bounds and cross-option validation as execution, then emits `schema_version: 1`, `command: plan` and a `request` object with `command`, `method: GET`, resolved `endpoint`, normalized `query` and exact `source_url`. Repeated query values remain arrays and appear as repeated URL parameters; explicit false remains false. All installed public routes are supported. Planning never fetches, reads credentials or writes files and does not verify provider availability or freshness. The 64 KiB formatted-output cap and atomic structured error streams apply. `kalshi plan` and `kalshi plan --help` show offline usage; `kalshi plan <command> --help` shows command options without requiring request values. Remove the leading `plan` to execute.

Use `kalshi describe markets candlesticks` (or any supported command path) to inspect versioned YAML command metadata without making a request. The document lists the GET route template, result key/type, flag types, required flags, defaults, numeric bounds, choices, CSV limits, parameter locations and available command notes. Supply only the command path, without request flags. This is local CLI metadata, not provider data or a complete cross-option validation schema; consult `kalshi <command> --help` and the command contract for combinations and time-range rules. Normal invocations still validate all inputs before fetching. Descriptions need no credentials, never write files and are deterministic for the installed version.

Use `kalshi commands --option cursor` to find commands with that exact supported option. Supply the bare, case-sensitive name, such as `ticker` or `period-interval`, without leading hyphens. Unknown option names fail locally. This filter combines with `--group` and `--search`, preserves catalog order and row fields, and records the normalized name in `filters.option`. It works offline; it does not set an option on a public request.
