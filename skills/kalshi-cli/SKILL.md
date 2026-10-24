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
   - Use `milestones --category Sports --type football_game --minimum-start-date RFC3339` for upcoming milestone IDs and related event tickers, optionally scoped by `--competition`, `--source-id`, or `--related-event-ticker`. The scheduled-start bound is passed unchanged for provider validation; `--min-updated-ts` filters metadata updates independently. Names come from provider data; an empty result is not proof of absence. Lists default to 10 (CLI bounds 1–200) with explicit `--cursor`; inspect one returned ID with `milestones get --milestone-id ID`. Milestone timing and details do not replace market resolution rules.
   - Use `events metadata --event-ticker EVENT` for settlement-source URLs, competition/scope, image URLs, and market metadata in one public GET with no query. It returns `count: 1` and unchanged provider data; URLs are never fetched automatically. Verify rules separately with `markets get`.
   - Use `events fee-changes --event-ticker EVENT` for public fee overrides and scheduled resets. The event scope is optional; one page defaults to 10 (1–1000) and continuation needs an explicit `--cursor`. Preserve null overrides: they clear the override and fall back to the parent series. Do not calculate trading costs or fetch parent data automatically.
   - Use `milestones live --milestone-id ID` for provider live data in one public GET; optional `--include-player-stats true` requests supported player statistics (Pro Football, Pro Basketball, College Men's Basketball with player mappings). Explicit false is preserved; omission uses the provider default. Keep the complete `data.live_data` object and count one. Its status updates more often than milestone metadata, but cached data may still be stale; absence of `live_data_delayed` never proves freshness. No polling, retry, or follow-up is implicit. Verify market rules and freshness independently.
   - Use `markets get` for current market fields and rules.
   - Use `markets orderbook` for current YES and NO bid depth.
   - Use `markets orderbooks --tickers TICKER_A,TICKER_B` for up to 100 verified market books in one public GET. The API receives repeated ticker query parameters and `query.tickers` is an array; preserve `data.orderbooks` and its provider order/precision. No depth, cursor, retries, or implicit follow-up; use the single-book command for a depth limit.
   - Use `markets trades` for prints and candlestick commands for time-series history.
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
