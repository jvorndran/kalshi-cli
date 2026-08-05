# Contributing

Contributions are welcome when they preserve the project's narrow security and data-integrity boundaries.

## Product boundaries

- Public, unauthenticated Kalshi market data only
- Fixed production host, allowlisted `GET` routes, and no arbitrary requests
- No account, credential, portfolio, order, RFQ, trading, or WebSocket support
- No hidden retries, automatic pagination, file writes, or provider-data reinterpretation
- Zero runtime dependencies

Open an issue before proposing a material expansion of that scope.

## Development

Use Node.js 22.12.0 or newer:

```sh
npm ci
npm run check
```

The default suite is offline. Add mocked coverage for every behavior change, including exact query mapping, local validation, stream separation, provider-shape handling, and package contents.

The live smoke test is opt-in and calls only public endpoints:

```powershell
$env:KALSHI_LIVE_TESTS = "1"
npm run test:live
```

Never add, request, log, or commit a Kalshi credential. Keep `README.md`, `skills/kalshi-cli/SKILL.md`, and the command reference synchronized with behavior changes.
