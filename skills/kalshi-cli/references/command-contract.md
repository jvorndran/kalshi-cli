# Kalshi CLI Command Contract

The CLI uses the fixed base URL `https://external-api.kalshi.com/trade-api/v2`, public `GET` requests, JSON output, a 30-second timeout, and a 20 MiB response limit. It does not read Kalshi environment variables or accept arbitrary hosts, methods, headers, bodies, or paths.

## Commands

| Command | Endpoint | Required flags | Primary result |
| --- | --- | --- | --- |
| `kalshi series` | `/series` | none | `series[]` |
| `kalshi series get` | `/series/{series_ticker}` | `--series-ticker` | `series` |
| `kalshi events` | `/events` | none | `events[]` |
| `kalshi events get` | `/events/{event_ticker}` | `--event-ticker` | `event` |
| `kalshi events candlesticks` | `/series/{series_ticker}/events/{ticker}/candlesticks` | series ticker, event ticker, start, end, interval | `market_tickers[]` plus parallel candle arrays |
| `kalshi markets` | `/markets` | none | `markets[]` |
| `kalshi markets get` | `/markets/{ticker}` | `--ticker` | `market` |
| `kalshi markets orderbook` | `/markets/{ticker}/orderbook` | `--ticker` | `orderbook_fp` |
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
kalshi series --category Sports --tags Football --include-product-metadata
kalshi events --series-ticker <VERIFIED_SERIES> --status open --with-nested-markets
kalshi markets --event-ticker <VERIFIED_EVENT> --status open
kalshi markets get --ticker <VERIFIED_MARKET>
```

Candidate series may describe game winners, spread thresholds, or total thresholds, but the ticker is only a discovery hint. Verify the title, game participants, selected side, strike or threshold, close time, and resolution rules from the returned market.

## Capture current quote and liquidity evidence

```powershell
kalshi markets get --ticker <VERIFIED_MARKET>
kalshi markets orderbook --ticker <VERIFIED_MARKET> --depth 10
kalshi markets trades --ticker <VERIFIED_MARKET> --limit 100
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
kalshi historical trades --ticker <VERIFIED_MARKET> --limit 100
```

Live and historical candle schemas differ. Preserve the raw response rather than coercing one into the other during retrieval.

## Pagination and query limits

- `events` limits pages to 1–200 records; market and trade list commands accept 0–1000.
- Pass the returned `cursor` into the next explicit request. There is no automatic pagination.
- `--start-ts` must be at most `--end-ts`; `--min-ts` must be at most `--max-ts`.
- Live market timestamp-filter families cannot be mixed. Historical market primary filters are mutually exclusive.
- A structured error and nonzero exit leave stdout empty. Local invocation errors use exit code 2; provider, network, timeout, and response-contract errors use exit code 1.
