# Repository operating rules

- Keep this CLI public, unauthenticated, read-only, and zero dependency.
- Hardcode the Kalshi production Trade API host and an explicit allowlist of `GET` routes.
- Never add arbitrary URL, method, header, request-body, credential, portfolio, account, order, RFQ, or WebSocket options.
- Preserve provider response values exactly inside the JSON `data` field, including nulls, unknown fields, and fixed-point strings.
- Keep pagination caller-controlled. Do not add an unbounded `--all` mode or hidden retries.
- Keep the default test suite offline. Live public smoke tests must remain explicitly opt-in.
- Keep `skills/kalshi-cli` synchronized with the command surface and output contract.
- Do not claim affiliation with or endorsement by Kalshi.
