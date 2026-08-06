const stringOption = (flag, query, description, extra = {}) => ({
  flag,
  key: query,
  query,
  type: "string",
  description,
  ...extra
});

const integerOption = (flag, query, description, extra = {}) => ({
  flag,
  key: query,
  query,
  type: "integer",
  description,
  ...extra
});

const booleanOption = (flag, query, description, extra = {}) => ({
  flag,
  key: query,
  query,
  type: "boolean",
  description,
  ...extra
});

const tickerOption = (flag, key, description, extra = {}) => stringOption(flag, key, description, {
  ticker: true,
  ...extra
});

const cursorOption = stringOption("cursor", "cursor", "Pagination cursor from the prior response.", {
  maxLength: 4096,
  ascii: true
});

export const DEFAULT_PAGE_LIMIT = 10;
export const SERIES_MAX_RESPONSE_BYTES = 64 * 1024;

const pageLimitOption = (subject, {min, max}) => integerOption(
  "limit",
  "limit",
  `Maximum ${subject} to return (${min}-${max}; default ${DEFAULT_PAGE_LIMIT}).`,
  {min, max, defaultValue: DEFAULT_PAGE_LIMIT}
);

const tradeOptions = () => [
  pageLimitOption("trades", {min: 0, max: 1000}),
  cursorOption,
  tickerOption("ticker", "ticker", "Filter by one market ticker."),
  integerOption("min-ts", "min_ts", "Return trades after this Unix timestamp in seconds.", {min: 0}),
  integerOption("max-ts", "max_ts", "Return trades before this Unix timestamp in seconds.", {min: 0}),
  booleanOption("is-block-trade", "is_block_trade", "Filter block trades explicitly with true or false.")
];

const candleTimeOptions = (period = {}) => [
  integerOption("start-ts", "start_ts", "Inclusive candle start boundary in Unix seconds.", {required: true, min: 0}),
  integerOption("end-ts", "end_ts", "Inclusive candle end boundary in Unix seconds.", {required: true, min: 0}),
  integerOption("period-interval", "period_interval", "Candle interval in minutes.", {required: true, ...period})
];

function validateTimeRange(values) {
  if (values.start_ts !== undefined && values.end_ts !== undefined && values.start_ts > values.end_ts) {
    return "--start-ts must be less than or equal to --end-ts.";
  }
  if (values.min_ts !== undefined && values.max_ts !== undefined && values.min_ts > values.max_ts) {
    return "--min-ts must be less than or equal to --max-ts.";
  }
}

function validateLiveMarketFilters(values) {
  for (const [minimum, maximum, label] of [
    ["min_created_ts", "max_created_ts", "created"],
    ["min_close_ts", "max_close_ts", "close"],
    ["min_settled_ts", "max_settled_ts", "settled"]
  ]) {
    if (values[minimum] !== undefined && values[maximum] !== undefined && values[minimum] > values[maximum]) {
      return `The minimum ${label} timestamp must be less than or equal to the maximum ${label} timestamp.`;
    }
  }

  const groups = [
    ["min_created_ts", "max_created_ts"],
    ["min_close_ts", "max_close_ts"],
    ["min_settled_ts", "max_settled_ts"],
    ["min_updated_ts"]
  ].filter((group) => group.some((key) => values[key] !== undefined));

  if (groups.length > 1) return "Use only one market timestamp-filter family per request.";

  if (values.min_updated_ts !== undefined) {
    const incompatible = [
      "event_ticker", "min_created_ts", "max_created_ts", "max_close_ts", "min_close_ts",
      "min_settled_ts", "max_settled_ts", "status", "tickers"
    ].some((key) => values[key] !== undefined);
    if (incompatible) return "--min-updated-ts cannot be combined with other market filters except --series-ticker and --mve-filter exclude.";
    if (values.series_ticker !== undefined && values.mve_filter !== "exclude") {
      return "Combining --min-updated-ts with --series-ticker requires --mve-filter exclude.";
    }
    if (values.mve_filter !== undefined && values.mve_filter !== "exclude") {
      return "--min-updated-ts permits only --mve-filter exclude.";
    }
  }

  const status = values.status;
  if ((values.min_created_ts !== undefined || values.max_created_ts !== undefined) && status !== undefined && !["unopened", "open"].includes(status)) {
    return "Created-time filters require status unopened, open, or no status filter.";
  }
  if ((values.min_close_ts !== undefined || values.max_close_ts !== undefined) && status !== undefined && status !== "closed") {
    return "Close-time filters require status closed or no status filter.";
  }
  if ((values.min_settled_ts !== undefined || values.max_settled_ts !== undefined) && status !== undefined && status !== "settled") {
    return "Settled-time filters require status settled or no status filter.";
  }
}

function validateHistoricalMarketFilters(values) {
  const primary = ["tickers", "event_ticker", "series_ticker", "mve_filter"]
    .filter((key) => values[key] !== undefined);
  if (primary.length > 1) return "Historical markets accept only one of --tickers, --event-ticker, --series-ticker, or --mve-filter.";
}

function validateSeriesFilters(values) {
  const scoped = ["category", "tags", "min_updated_ts"]
    .some((key) => values[key] !== undefined);
  if (!scoped) {
    return "Series is an unpaginated endpoint; supply --category, --tags, or --min-updated-ts to keep discovery bounded.";
  }
}

const command = (path, summary, endpoint, resultKey, options = [], validate, resultType = "array", extra = {}) => ({
  path,
  name: path.join(" "),
  summary,
  endpoint,
  resultKey,
  resultType,
  options,
  validate,
  ...extra
});

export const COMMANDS = [
  command(["series"], "List filtered public market series (requires a filter).", "/series", "series", [
    stringOption("category", "category", "Filter by category."),
    stringOption("tags", "tags", "Filter by tag."),
    booleanOption("include-product-metadata", "include_product_metadata", "Include product metadata."),
    booleanOption("include-volume", "include_volume", "Include aggregate volume."),
    integerOption("min-updated-ts", "min_updated_ts", "Filter metadata updated after this Unix timestamp.", {min: 0})
  ], validateSeriesFilters, "array", {
    maxResponseBytes: SERIES_MAX_RESPONSE_BYTES,
    responseTooLargeHint: "Narrow the unpaginated series query with a more specific category, tag, or recent --min-updated-ts value. Run kalshi series tags to inspect available filters.",
    helpNotes: [
      "Supply one of --category, --tags, or --min-updated-ts.",
      "Unpaginated responses over 64 KiB are rejected before stdout is written."
    ]
  }),
  command(["series", "tags"], "List official series tags grouped by category.", "/search/tags_by_categories", "tags_by_categories", [], undefined, "object"),
  command(["series", "get"], "Get one public market series.", "/series/{series_ticker}", "series", [
    tickerOption("series-ticker", "series_ticker", "Series ticker.", {required: true, location: "path", pathName: "series_ticker"}),
    booleanOption("include-volume", "include_volume", "Include aggregate volume.")
  ], undefined, "object"),
  command(["events"], "List public events.", "/events", "events", [
    pageLimitOption("events", {min: 1, max: 200}),
    cursorOption,
    booleanOption("with-nested-markets", "with_nested_markets", "Include markets inside each event."),
    booleanOption("with-milestones", "with_milestones", "Include related milestones."),
    stringOption("status", "status", "Event status.", {enum: ["unopened", "open", "closed", "settled"]}),
    tickerOption("series-ticker", "series_ticker", "Filter by series ticker."),
    stringOption("tickers", "tickers", "Comma-separated event tickers.", {csv: true, maxItems: 100, csvTickers: true}),
    integerOption("min-close-ts", "min_close_ts", "Filter events with a market closing after this Unix timestamp.", {min: 0}),
    integerOption("min-updated-ts", "min_updated_ts", "Filter metadata updated after this Unix timestamp.", {min: 0})
  ]),
  command(["events", "get"], "Get one public event.", "/events/{event_ticker}", "event", [
    tickerOption("event-ticker", "event_ticker", "Event ticker.", {required: true, location: "path", pathName: "event_ticker"}),
    booleanOption("with-nested-markets", "with_nested_markets", "Include markets inside the event.")
  ], undefined, "object"),
  command(["events", "candlesticks"], "Get candles for every market in an event.", "/series/{series_ticker}/events/{ticker}/candlesticks", "market_tickers", [
    tickerOption("series-ticker", "series_ticker", "Series ticker.", {required: true, location: "path", pathName: "series_ticker"}),
    tickerOption("event-ticker", "event_ticker", "Event ticker.", {required: true, location: "path", pathName: "ticker"}),
    ...candleTimeOptions({enum: [1, 60, 1440]})
  ], validateTimeRange),
  command(["markets"], "List public markets.", "/markets", "markets", [
    pageLimitOption("markets", {min: 0, max: 1000}),
    cursorOption,
    tickerOption("event-ticker", "event_ticker", "Filter by one event ticker."),
    tickerOption("series-ticker", "series_ticker", "Filter by series ticker."),
    integerOption("min-created-ts", "min_created_ts", "Filter markets created after this Unix timestamp.", {min: 0}),
    integerOption("max-created-ts", "max_created_ts", "Filter markets created before this Unix timestamp.", {min: 0}),
    integerOption("min-updated-ts", "min_updated_ts", "Filter metadata updated after this Unix timestamp.", {min: 0}),
    integerOption("min-close-ts", "min_close_ts", "Filter markets closing after this Unix timestamp.", {min: 0}),
    integerOption("max-close-ts", "max_close_ts", "Filter markets closing before this Unix timestamp.", {min: 0}),
    integerOption("min-settled-ts", "min_settled_ts", "Filter markets settled after this Unix timestamp.", {min: 0}),
    integerOption("max-settled-ts", "max_settled_ts", "Filter markets settled before this Unix timestamp.", {min: 0}),
    stringOption("status", "status", "Market status.", {enum: ["unopened", "open", "paused", "closed", "settled"]}),
    stringOption("tickers", "tickers", "Comma-separated market tickers.", {csv: true, maxItems: 100, csvTickers: true}),
    stringOption("mve-filter", "mve_filter", "Include only or exclude multivariate markets.", {enum: ["only", "exclude"]})
  ], validateLiveMarketFilters),
  command(["markets", "get"], "Get one public market and its rules and quote fields.", "/markets/{ticker}", "market", [
    tickerOption("ticker", "ticker", "Market ticker.", {required: true, location: "path", pathName: "ticker"})
  ], undefined, "object"),
  command(["markets", "orderbook"], "Get the current public YES and NO bid levels.", "/markets/{ticker}/orderbook", "orderbook_fp", [
    tickerOption("ticker", "ticker", "Market ticker.", {required: true, location: "path", pathName: "ticker"}),
    integerOption("depth", "depth", "Orderbook depth (0-100; 0 returns all levels).", {min: 0, max: 100})
  ], undefined, "object"),
  command(["markets", "trades"], "List current public trades.", "/markets/trades", "trades", tradeOptions(), validateTimeRange),
  command(["markets", "candlesticks"], "Get candles for one active or recent market.", "/series/{series_ticker}/markets/{ticker}/candlesticks", "candlesticks", [
    tickerOption("series-ticker", "series_ticker", "Series ticker.", {required: true, location: "path", pathName: "series_ticker"}),
    tickerOption("ticker", "ticker", "Market ticker.", {required: true, location: "path", pathName: "ticker"}),
    ...candleTimeOptions({enum: [1, 60, 1440]}),
    booleanOption("include-latest-before-start", "include_latest_before_start", "Prepend Kalshi's synthetic continuity candle when available.")
  ], validateTimeRange),
  command(["markets", "candlesticks", "batch"], "Get candles for up to 100 active or recent markets.", "/markets/candlesticks", "markets", [
    stringOption("market-tickers", "market_tickers", "Comma-separated market tickers (maximum 100).", {required: true, csv: true, maxItems: 100, csvTickers: true}),
    ...candleTimeOptions({min: 1}),
    booleanOption("include-latest-before-start", "include_latest_before_start", "Prepend Kalshi's synthetic continuity candle when available.")
  ], validateTimeRange),
  command(["historical", "cutoff"], "Get Kalshi's current live-to-historical cutoff timestamps.", "/historical/cutoff", "market_settled_ts", [], undefined, "string"),
  command(["historical", "markets"], "List archived public markets.", "/historical/markets", "markets", [
    pageLimitOption("markets", {min: 0, max: 1000}),
    cursorOption,
    stringOption("tickers", "tickers", "Comma-separated market tickers.", {csv: true, maxItems: 100, csvTickers: true}),
    tickerOption("event-ticker", "event_ticker", "Filter by one event ticker."),
    tickerOption("series-ticker", "series_ticker", "Filter by one series ticker."),
    stringOption("mve-filter", "mve_filter", "Exclude multivariate markets.", {enum: ["exclude"]})
  ], validateHistoricalMarketFilters),
  command(["historical", "markets", "get"], "Get one archived public market.", "/historical/markets/{ticker}", "market", [
    tickerOption("ticker", "ticker", "Market ticker.", {required: true, location: "path", pathName: "ticker"})
  ], undefined, "object"),
  command(["historical", "markets", "candlesticks"], "Get candles for one archived market.", "/historical/markets/{ticker}/candlesticks", "candlesticks", [
    tickerOption("ticker", "ticker", "Market ticker.", {required: true, location: "path", pathName: "ticker"}),
    ...candleTimeOptions({enum: [1, 60, 1440]})
  ], validateTimeRange),
  command(["historical", "trades"], "List archived public trades.", "/historical/trades", "trades", tradeOptions(), validateTimeRange)
];

export function rootHelp(version) {
  const rows = COMMANDS.map((definition) => `  ${definition.name.padEnd(34)} ${definition.summary}`);
  return [
    `kalshi ${version}`,
    "",
    "Public, unauthenticated, read-only Kalshi market data.",
    "Deterministic YAML output; paginated lists default to 10 records and are capped at 64 KiB.",
    "",
    "Usage: kalshi <command> [options]",
    "",
    "Commands:",
    ...rows,
    "",
    "Run kalshi <command> --help for command options."
  ].join("\n");
}

export function commandHelp(definition) {
  const rows = definition.options.map((option) => {
    const value = option.type === "boolean" ? "" : ` <${option.type === "integer" ? "integer" : "value"}>`;
    const required = option.required ? " Required." : "";
    return `  --${option.flag}${value}`.padEnd(42) + option.description + required;
  });
  return [
    definition.summary,
    "",
    `Usage: kalshi ${definition.name}${definition.options.length ? " [options]" : ""}`,
    ...(rows.length ? ["", "Options:", ...rows] : []),
    ...(definition.helpNotes?.length ? ["", "Notes:", ...definition.helpNotes.map((note) => `  ${note}`)] : []),
    "",
    "  --help".padEnd(42) + "Show this help."
  ].join("\n");
}
