# Changelog

All notable changes to this project will be documented here. Versions follow Semantic Versioning.

## [Unreleased]

- Replace JSON output with deterministic, newline-terminated YAML while preserving Kalshi's nulls, unknown fields, fixed-point strings, and raw number lexemes
- Default paginated list commands to 20 records while keeping `--limit` and cursors caller-controlled
- Add compact `series tags` discovery and require a category, tag, or update timestamp for `series`; its unpaginated response is capped at 64 KiB to prevent context flooding without truncating Kalshi data

## [0.1.0] - 2026-08-05

- Initial public, unauthenticated, read-only Kalshi market-data CLI
- Sixteen allowlisted discovery, market, candlestick, trade, and historical commands
- Provenance envelopes, explicit pagination, structured errors, response limits, and bundled agent skill

[Unreleased]: https://github.com/jvorndran/kalshi-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jvorndran/kalshi-cli/releases/tag/v0.1.0
