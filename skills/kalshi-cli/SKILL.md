---
name: kalshi-cli
description: Retrieve and preserve public, unauthenticated Kalshi series, events, market metadata, current quote fields, bid-side orderbooks, trades, candlesticks, and historical market data through the read-only kalshi CLI. Use for prediction-market discovery, contract verification, price-history research, liquidity evidence, or reproducible Kalshi snapshots. Never authenticate, trade, or invent contract identity.
---

# Kalshi Public CLI

Use `kalshi` as a narrow evidence-retrieval tool. It exposes only a fixed set of public `GET` endpoints and returns the provider response unchanged inside a provenance envelope.

## Workflow

1. Confirm the tool before retrieval.
   - Run `kalshi --version` and the smallest relevant `--help` command.
   - If `kalshi` is unavailable, report that limitation. Do not replace it with an authenticated client, arbitrary HTTP wrapper, or trading SDK.

2. Discover the contract instead of constructing a ticker.
   - Start with `series`, then narrow through `events` and `markets`.
   - Verify the series, event, market ticker, title, close time, status, and resolution rules against the exact user question.
   - Stop at `unresolved_identity` when the game, contract side, threshold, or rules cannot be matched safely.

3. Retrieve only the evidence needed.
   - Use `markets get` for current market fields and rules.
   - Use `markets orderbook` for current YES and NO bid depth.
   - Use `markets trades` for prints and candlestick commands for time-series history.
   - Check `historical cutoff` before assuming an older market remains on the live routes. Switch to the matching `historical` command when required.
   - Read [references/command-contract.md](references/command-contract.md) for the full command surface and live-versus-historical workflow.

4. Preserve provenance and provider precision.
   - Retain `command`, `endpoint`, `query`, `source_url`, `requested_at`, `observed_at`, `response_sha256`, `count`, and unchanged `data`.
   - Preserve fixed-point price, volume, and open-interest strings exactly. Convert them only in a separate, stated calculation.
   - Keep each response's caller-controlled cursor. Never invent `--all`, automatic pagination, or implicit retries.
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
