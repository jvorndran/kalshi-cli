# Kalshi CLI

[![npm](https://img.shields.io/npm/v/%40jvorndran%2Fkalshi-cli)](https://www.npmjs.com/package/@jvorndran/kalshi-cli)
[![CI](https://github.com/jvorndran/kalshi-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/jvorndran/kalshi-cli/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jvorndran/kalshi-cli/actions/workflows/codeql.yml/badge.svg)](https://github.com/jvorndran/kalshi-cli/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An agent-first, zero-dependency CLI for public Kalshi market data. It exposes a fixed, read-only set of discovery, market, orderbook, trade, candlestick, and historical endpoints as deterministic, newline-terminated YAML.

This is an independent community project. It is not affiliated with or endorsed by Kalshi.

## Install

Requires Node.js 22.12.0 or newer.

```sh
npm install --global @jvorndran/kalshi-cli
kalshi --version
```

For one-off use:

```sh
npx --yes @jvorndran/kalshi-cli --help
```

The CLI never asks for Kalshi credentials because every supported operation uses a public endpoint.

## Quick start

Discover rather than guess identifiers:

```sh
kalshi series tags
kalshi series --category Sports --tags Football
kalshi events --series-ticker KXNCAAFGAME --status open
kalshi markets --series-ticker KXNCAAFGAME --status open
```

After choosing and verifying a ticker from those results:

```sh
kalshi markets get --ticker "MARKET_TICKER_FROM_DISCOVERY"
kalshi markets orderbook --ticker "MARKET_TICKER_FROM_DISCOVERY" --depth 10
kalshi markets trades --ticker "MARKET_TICKER_FROM_DISCOVERY" --limit 10
```

Do not construct a market ticker from a team name. Verify the returned title, participants, selected side, threshold, close time, status, and resolution rules against the exact question you are researching.

## Commands

| Family | Commands | Purpose |
| --- | --- | --- |
| Series | `series`, `series tags`, `series get` | Discover filters and market families, then inspect one series. |
| Events | `events`, `events get`, `events candlesticks` | Discover events, inspect event metadata, or retrieve candles for an event's markets. |
| Markets | `markets`, `markets get`, `markets orderbook`, `markets trades`, `markets candlesticks`, `markets candlesticks batch` | Retrieve market metadata, rules, bid depth, prints, and price history. |
| Historical | `historical cutoff`, `historical markets`, `historical markets get`, `historical markets candlesticks`, `historical trades` | Find the live/archive boundary and retrieve archived public data. |

Run `kalshi <command> --help` for exact options. The complete endpoint and flag contract is in the [command reference](skills/kalshi-cli/references/command-contract.md).

## Output contract

Success writes exactly one YAML document to stdout:

```yaml
provider: kalshi
command: events
endpoint: /events
query:
  limit: 20
  status: open
  series_ticker: KXNCAAFGAME
source_url: https://external-api.kalshi.com/trade-api/v2/events?limit=20&status=open&series_ticker=KXNCAAFGAME
requested_at: "2026-08-04T20:00:00.000Z"
observed_at: "2026-08-04T20:00:00.120Z"
response_sha256: sha256:<hex>
count: 1
data:
  events:
    - event_ticker: EXAMPLE_EVENT_FROM_PROVIDER
  cursor: ""
```

The outer envelope belongs to this CLI. `data` is Kalshi's response, embedded without transforming provider values; precision-sensitive strings, nulls, unknown fields, and numeric lexemes are preserved. Strings that YAML could mistake for booleans, numbers, dates, or nulls are quoted. `count` describes the command's primary result, and `response_sha256` hashes the raw response bytes.

Failures write one structured YAML document to stderr, leave stdout empty, and exit nonzero:

- Exit code `2`: invalid local invocation.
- Exit code `1`: HTTP, network, timeout, response-size, or provider-response failure.

## Bounded discovery, pagination, and historical data

Kalshi's series-list route has no limit or cursor. Inspect the compact official filter index first, then narrow the series query:

```sh
kalshi series tags
kalshi series --category Sports --tags Football
```

To prevent context flooding without altering Kalshi's response, `kalshi series` requires at least one of `--category`, `--tags`, or `--min-updated-ts` and caps the raw response at 64 KiB. A broader result fails with structured YAML on stderr and leaves stdout empty; refine the filter rather than receiving locally truncated provider data.

Paginated event, market, and trade lists default to 10 records. The applied default appears in `query` and `source_url`; use `--limit` when a different page size is intentional. Every successful command also refuses to write more than 64 KiB of formatted YAML; split large market lists or candle ranges into separate requests.

Pagination is always explicit. Read the provider cursor from `data` and pass it to the next request:

```sh
kalshi events --series-ticker KXNCAAFGAME --limit 10
kalshi events --series-ticker KXNCAAFGAME --limit 10 --cursor "CURSOR_FROM_PREVIOUS_RESPONSE"
```

There is no `--all`, automatic pagination, hidden retry, or implicit backoff. Nested markets, milestones, product metadata, and volume remain opt-in because they can materially enlarge a response. On a `429`, the caller decides whether and when to retry.

Older records move from live routes to historical routes. Check the current boundary before switching:

```sh
kalshi historical cutoff
kalshi historical markets --series-ticker KXNCAAFGAME
kalshi historical trades --ticker "ARCHIVED_MARKET_TICKER" --limit 10
kalshi historical markets candlesticks --ticker "ARCHIVED_MARKET_TICKER" --start-ts 1785542400 --end-ts 1786147200 --period-interval 60
```

Live and historical candle schemas can differ, so the CLI preserves each provider response instead of coercing them into one shape.

## College-football example

Currently observed college-football series have included `KXNCAAFGAME` for game winners, `KXNCAAFSPREAD` for full-game spreads, and `KXNCAAFTOTAL` for full-game totals. Treat these as discovery hints, not permanent identifiers.

```sh
kalshi series --category Sports --tags Football
kalshi events --series-ticker KXNCAAFSPREAD --status open
kalshi markets get --ticker "VERIFIED_SPREAD_MARKET"
kalshi markets orderbook --ticker "VERIFIED_SPREAD_MARKET" --depth 10
kalshi markets candlesticks --series-ticker KXNCAAFSPREAD --ticker "VERIFIED_SPREAD_MARKET" --start-ts 1785542400 --end-ts 1786147200 --period-interval 60 --include-latest-before-start
```

A candle close or recent trade is historical evidence, not necessarily an executable quote. An orderbook contains YES and NO bids; the CLI does not invent asks or midpoints.

## Safety and scope

The implementation fixes the host to `https://external-api.kalshi.com/trade-api/v2`, allows only documented public `GET` routes, rejects redirects, omits credentials, times out after 30 seconds, limits raw responses to 20 MiB, and limits successful formatted YAML output to 64 KiB.

It does not provide:

- Authentication, API keys, account access, portfolios, orders, RFQs, or trading
- Arbitrary URLs, methods, headers, bodies, paths, or WebSocket access
- Automatic retries, unbounded pagination, file writes, or data caches
- Derived asks, midpoints, probabilities, recommendations, position sizing, or promises of an edge

## Agent skill

The repository includes an agent skill that teaches compatible agents how to discover contracts, preserve provenance, and interpret market evidence conservatively:

```sh
npx --yes skills add jvorndran/kalshi-cli --skill kalshi-cli
```

Installing the skill does not install the `kalshi` executable. Install the npm package separately before the skill tries to call it. See the bundled [skill instructions](skills/kalshi-cli/SKILL.md).

## Development

```sh
git clone https://github.com/jvorndran/kalshi-cli.git
cd kalshi-cli
npm ci
npm run check
```

`npm run check` performs syntax checks, offline behavior tests, an installed-tarball smoke test, and package-content verification. The default suite never calls Kalshi.

The public live smoke test is deliberately opt-in:

```powershell
$env:KALSHI_LIVE_TESTS = "1"
npm run test:live
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for project boundaries and [RELEASING.md](RELEASING.md) for the release process.

## Support and security

Use [GitHub Issues](https://github.com/jvorndran/kalshi-cli/issues) for reproducible bugs and narrowly scoped feature requests. Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/jvorndran/kalshi-cli/security/advisories/new); do not post exploit details or credentials in an issue.

Released under the [MIT License](LICENSE).
