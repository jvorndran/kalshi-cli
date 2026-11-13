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

function validateWeatherWindow(values) {
  if (values.last_sec !== undefined) {
    if (values.from !== undefined || values.to !== undefined) {
      return "--last-sec cannot be combined with --from or --to.";
    }
    return;
  }
  if (values.from === undefined || values.to === undefined) {
    return "Weather history requires --last-sec or paired --from and --to (Unix milliseconds).";
  }
  if (values.from > values.to) return "--from must be less than or equal to --to.";
}

function validateLiveMarketFilters(values) {
  for (const [minimum, maximum, label] of [
    ["min_created_ts", "max_created_ts", "created"],
    ["min_close_ts", "max_close_ts", "close"],
    ["min_settled_ts", "max_settled_ts", "settled"],
    ["min_updated_ts", "max_updated_ts", "updated"]
  ]) {
    if (values[minimum] !== undefined && values[maximum] !== undefined && values[minimum] > values[maximum]) {
      return `The minimum ${label} timestamp must be less than or equal to the maximum ${label} timestamp.`;
    }
  }

  const groups = [
    ["min_created_ts", "max_created_ts"],
    ["min_close_ts", "max_close_ts"],
    ["min_settled_ts", "max_settled_ts"],
    ["min_updated_ts", "max_updated_ts"]
  ].filter((group) => group.some((key) => values[key] !== undefined));

  if (groups.length > 1) return "Use only one market timestamp-filter family per request.";

  if (values.min_updated_ts !== undefined || values.max_updated_ts !== undefined) {
    const incompatible = [
      "event_ticker", "min_created_ts", "max_created_ts", "max_close_ts", "min_close_ts",
      "min_settled_ts", "max_settled_ts", "status", "tickers"
    ].some((key) => values[key] !== undefined);
    if (incompatible) return "--min-updated-ts/--max-updated-ts cannot be combined with other market filters except --series-ticker and --mve-filter exclude.";
    if (values.series_ticker !== undefined && values.mve_filter !== "exclude") {
      return "Combining --min-updated-ts/--max-updated-ts with --series-ticker requires --mve-filter exclude.";
    }
    if (values.mve_filter !== undefined && values.mve_filter !== "exclude") {
      return "--min-updated-ts/--max-updated-ts permits only --mve-filter exclude.";
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

function validateMultivariateEventFilters(values) {
  if (values.series_ticker !== undefined && values.collection_ticker !== undefined) {
    return "Cannot combine --series-ticker and --collection-ticker.";
  }
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
  command(["exchange", "status"], "Get public exchange and trading availability.", "/exchange/status", "exchange_active", [], undefined, "boolean"),
  command(["exchange", "schedule"], "Get public trading hours and maintenance windows.", "/exchange/schedule", "schedule", [], undefined, "object"),
  command(["weather"], "Inspect a city's public Kalshi temperature index.", "/live_data/weather/{city}", "timeseries", [
    tickerOption("city", "city", "Weather index city ID, for example miami.", {required: true, location: "path", pathName: "city"}),
    integerOption("from", "from", "Inclusive start in Unix milliseconds; pair with --to.", {min: 0}),
    integerOption("to", "to", "Inclusive end in Unix milliseconds; pair with --from.", {min: 0}),
    integerOption("last-sec", "last_sec", "Trailing window in seconds; excludes --from and --to.", {min: 1}),
    booleanOption("detailed", "detailed", "Include raw per-station quality-control readings.")
  ], validateWeatherWindow, "array", {
    outputTooLargeHint: "Use a smaller --last-sec or --from/--to window, or omit --detailed.",
    helpNotes: ["Supply --last-sec or paired --from/--to to bound history. Published values are Fahrenheit; missing minutes remain gaps. Incomplete points and historical backfills are not canonical settlement values."]
  }),
  command(["weather", "calibrations"], "Inspect a city's published weather-index configuration timeline.", "/live_data/weather/{city}/calibrations", "calibrations", [
    tickerOption("city", "city", "Weather index city ID, for example miami.", {required: true, location: "path", pathName: "city"})
  ], undefined, "array", {
    outputTooLargeHint: "Weather calibration timelines have no narrowing options; the complete timeline exceeds the output cap.",
    helpNotes: ["One public GET returns the complete provider timeline. Station offsets and city references are Celsius; published index temperatures are Fahrenheit. No pagination, polling, or automatic index request."]
  }),
  command(["structured-targets"], "Discover public structured targets and source identifiers.", "/structured_targets", "structured_targets", [
    stringOption("ids", "ids", "Comma-separated structured target IDs (1-2000).", {csv: true, maxItems: 2000, csvTickers: true, repeatedQuery: true}),
    stringOption("type", "type", "Filter by provider target type."),
    stringOption("competition", "competition", "Filter by league, conference, division, tour, or leagues entry."),
    integerOption("page-size", "page_size", "Maximum targets per page (1-2000; default 10).", {min: 1, max: 2000, defaultValue: DEFAULT_PAGE_LIMIT}),
    cursorOption
  ], undefined, "array", {
    outputTooLargeHint: "Use a smaller --page-size or narrow --ids, --type, or --competition.",
    helpNotes: ["One public GET per page; continue only by passing data.cursor explicitly with --cursor."]
  }),
  command(["structured-targets", "get"], "Inspect one discovered public structured target.", "/structured_targets/{structured_target_id}", "structured_target", [
    tickerOption("structured-target-id", "structured_target_id", "Structured target ID returned by discovery.", {required: true, location: "path", pathName: "structured_target_id"})
  ], undefined, "object"),
  command(["incentives"], "Discover public market incentive programs.", "/incentive_programs", "incentive_programs", [
    pageLimitOption("incentive programs", {min: 1, max: 10000}),
    cursorOption,
    stringOption("status", "status", "Filter by program status.", {enum: ["all", "active", "upcoming", "closed", "paid_out"]}),
    stringOption("type", "type", "Filter by incentive type.", {enum: ["all", "liquidity", "volume", "margin_maker_volume", "margin_taker_volume"]}),
    stringOption("incentive-description", "incentive_description", "Filter by exact incentive description.")
  ], undefined, "array", {
    helpNotes: ["One public GET per page; pass data.next_cursor explicitly with --cursor to continue."]
  }),
  command(["milestones"], "Discover public milestones and their related events.", "/milestones", "milestones", [
    pageLimitOption("milestones", {min: 1, max: 200}),
    cursorOption,
    stringOption("minimum-start-date", "minimum_start_date", "Filter by minimum scheduled start time (RFC3339, validated by Kalshi)."),
    stringOption("category", "category", "Filter by milestone category."),
    stringOption("competition", "competition", "Filter by competition, using the provider's exact name."),
    stringOption("type", "type", "Filter by milestone type (for example football_game)."),
    stringOption("source-id", "source_id", "Filter by provider source ID."),
    tickerOption("related-event-ticker", "related_event_ticker", "Filter by a related event ticker."),
    integerOption("min-updated-ts", "min_updated_ts", "Filter metadata updated after this Unix timestamp.", {min: 0})
  ]),
  command(["milestones", "get"], "Inspect one public milestone by its discovered ID.", "/milestones/{milestone_id}", "milestone", [
    tickerOption("milestone-id", "milestone_id", "Milestone ID returned by discovery.", {required: true, location: "path", pathName: "milestone_id"})
  ], undefined, "object"),
  command(["milestones", "game-stats"], "Inspect public play-by-play game statistics for a milestone.", "/live_data/milestone/{milestone_id}/game_stats", "pbp", [
    tickerOption("milestone-id", "milestone_id", "Milestone ID returned by discovery.", {required: true, location: "path", pathName: "milestone_id"})
  ], undefined, "object", {
    nullableResult: true,
    outputTooLargeHint: "Game stats have no narrowing options. Use milestones live for a compact snapshot or inspect another milestone.",
    helpNotes: [
      "One public GET; pbp may be null for unsupported milestones or missing provider mappings (count zero).",
      "This endpoint has no pagination or narrowing options; oversized responses fail before stdout is written.",
      "Preserve period and event data as reported. Cached or delayed play-by-play does not establish freshness."
    ]
  }),
  command(["milestones", "live"], "Inspect public live data for a discovered milestone.", "/live_data/milestone/{milestone_id}", "live_data", [
    tickerOption("milestone-id", "milestone_id", "Milestone ID returned by discovery.", {required: true, location: "path", pathName: "milestone_id"}),
    booleanOption("include-player-stats", "include_player_stats", "Include available player statistics explicitly with true or false.")
  ], undefined, "object", {
    helpNotes: [
      "One public GET; player statistics are supported only for some sports and mapped milestones.",
      "Live data may be cached or delayed. A missing live_data_delayed flag does not prove freshness."
    ]
  }),
  command(["milestones", "live", "batch"], "Inspect public live data for up to 100 discovered milestones.", "/live_data/batch", "live_datas", [
    stringOption("milestone-ids", "milestone_ids", "Comma-separated milestone IDs (1-100).", {required: true, csv: true, maxItems: 100, csvTickers: true, repeatedQuery: true}),
    booleanOption("include-player-stats", "include_player_stats", "Include available player statistics explicitly with true or false.")
  ], undefined, "array", {
    helpNotes: [
      "One public GET with repeated milestone_ids query parameters; no polling or follow-up calls.",
      "Live data may be cached or delayed. A missing live_data_delayed flag does not prove freshness."
    ]
  }),
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
  command(["series", "sports"], "Discover official sport scopes, competitions, and sport ordering.", "/search/filters_by_sport", "filters_by_sports", [], undefined, "object"),
  command(["series", "fee-changes"], "Inspect scheduled fee changes for one public series.", "/series/fee_changes", "series_fee_change_arr", [
    tickerOption("series-ticker", "series_ticker", "Series ticker (required to bound this unpaginated endpoint).", {required: true}),
    booleanOption("show-historical", "show_historical", "Include historical changes explicitly with true or false.")
  ], undefined, "array", {
    maxResponseBytes: SERIES_MAX_RESPONSE_BYTES,
    responseTooLargeHint: "Omit --show-historical true to narrow this unpaginated fee-change response.",
    helpNotes: ["Requires --series-ticker; this endpoint has no pagination. Responses over 64 KiB are rejected."]
  }),
  command(["series", "get"], "Get one public market series.", "/series/{series_ticker}", "series", [
    tickerOption("series-ticker", "series_ticker", "Series ticker.", {required: true, location: "path", pathName: "series_ticker"}),
    booleanOption("include-volume", "include_volume", "Include aggregate volume.")
  ], undefined, "object"),
  command(["collections"], "Discover public multivariate event collections.", "/multivariate_event_collections", "multivariate_contracts", [
    pageLimitOption("collections", {min: 1, max: 200}),
    cursorOption,
    stringOption("status", "status", "Collection status.", {enum: ["unopened", "open", "closed"]}),
    tickerOption("associated-event-ticker", "associated_event_ticker", "Filter by an associated event ticker."),
    tickerOption("series-ticker", "series_ticker", "Filter by series ticker.")
  ]),
  command(["collections", "get"], "Inspect one public multivariate event collection.", "/multivariate_event_collections/{collection_ticker}", "multivariate_contract", [
    tickerOption("collection-ticker", "collection_ticker", "Collection ticker returned by discovery.", {required: true, location: "path", pathName: "collection_ticker"})
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
  command(["events", "multivariate"], "Discover existing public multivariate events.", "/events/multivariate", "events", [
    pageLimitOption("events", {min: 1, max: 200}),
    cursorOption,
    tickerOption("series-ticker", "series_ticker", "Filter by series ticker."),
    tickerOption("collection-ticker", "collection_ticker", "Filter by collection ticker."),
    stringOption("tickers", "tickers", "Comma-separated event tickers (maximum 100).", {csv: true, maxItems: 100, csvTickers: true}),
    booleanOption("with-nested-markets", "with_nested_markets", "Include markets inside each event.")
  ], validateMultivariateEventFilters, "array", {
    helpNotes: ["Cannot combine --series-ticker and --collection-ticker. This command only reads existing events."]
  }),
  command(["events", "get"], "Get one public event.", "/events/{event_ticker}", "event", [
    tickerOption("event-ticker", "event_ticker", "Event ticker.", {required: true, location: "path", pathName: "event_ticker"}),
    booleanOption("with-nested-markets", "with_nested_markets", "Include markets inside the event.")
  ], undefined, "object"),
  command(["events", "live"], "Inspect public event-keyed live data and chart observations.", "/live_data/events/{event_ticker}", "live_data", [
    tickerOption("event-ticker", "event_ticker", "Event ticker returned by discovery.", {required: true, location: "path", pathName: "event_ticker"}),
    stringOption("range", "range", "Optional chart range hint (for example 15min, 1h, or 1d); supported windows depend on the data type.")
  ], undefined, "object", {
    helpNotes: [
      "One public GET; range is a provider hint and may not apply to every live data type.",
      "Preserves type, details and historical flags. Live data may be cached or delayed; no polling or follow-up calls."
    ]
  }),
  command(["events", "metadata"], "Inspect event settlement sources, competition, and market metadata.", "/events/{event_ticker}/metadata", "image_url", [
    tickerOption("event-ticker", "event_ticker", "Event ticker returned by discovery.", {required: true, location: "path", pathName: "event_ticker"})
  ], undefined, "string"),
  command(["events", "fee-changes"], "Inspect public event fee overrides and scheduled resets.", "/events/fee_changes", "event_fee_changes", [
    tickerOption("event-ticker", "event_ticker", "Filter by one event ticker."),
    pageLimitOption("fee changes", {min: 1, max: 1000}),
    cursorOption
  ]),
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
    integerOption("min-updated-ts", "min_updated_ts", "Filter non-trading metadata updated after this Unix timestamp in seconds.", {min: 0}),
    integerOption("max-updated-ts", "max_updated_ts", "Filter non-trading metadata updated at or before this Unix timestamp in seconds.", {min: 0}),
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
  command(["markets", "orderbooks"], "Get public bid-side orderbooks for up to 100 markets in one request.", "/markets/orderbooks", "orderbooks", [
    stringOption("tickers", "tickers", "Comma-separated market tickers (1-100); sent as repeated query parameters.", {
      required: true, csv: true, maxItems: 100, csvTickers: true, repeatedQuery: true
    })
  ], undefined, "array", {
    helpNotes: ["One public GET, no automatic follow-up. Use markets orderbook for a single market with --depth."]
  }),
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

const commandGroups = [...new Set(COMMANDS.map(({path}) => path[0]))];

export const CATALOG_DEFINITION = {
  name: "commands",
  summary: "List or filter the installed public GET commands as YAML without a request.",
  options: [
    stringOption("group", "group", `Keep one exact top-level command group: ${commandGroups.join(", ")}.`, {
      enum: commandGroups
    }),
    stringOption("search", "search", "Case-insensitive literal substring in command names, summaries or endpoint templates (maximum 200 characters).", {maxLength: 200}),
    stringOption("pagination", "pagination", "Keep commands with cursor pagination (cursor) or without a cursor option (none).", {
      enum: ["cursor", "none"]
    }),
    stringOption("option", "option", "Keep commands supporting this exact bare option name, such as ticker or cursor.", {
      enum: [...new Set(COMMANDS.flatMap(({options}) => options.map(({flag}) => flag)))]
    })
  ]
};

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
    "  commands                           List or filter the installed public commands as YAML.",
    "  describe <command>                 Describe a command as YAML without a request.",
    "  plan <command> [options]           Validate and preview a request without fetching.",
    ...rows,
    "",
    "Run kalshi <command> --help for command options."
  ].join("\n");
}

export function commandCatalog({group, search, option, pagination} = {}) {
  const needle = search?.toLowerCase();
  const definitions = COMMANDS.filter(({path, name, summary, endpoint, options}) =>
    (group === undefined || path[0] === group) &&
    (needle === undefined || [name, summary, endpoint].some((value) => value.toLowerCase().includes(needle))) &&
    (option === undefined || options.some(({flag}) => flag === option)) &&
    (pagination === undefined || options.some(({flag}) => flag === "cursor") === (pagination === "cursor"))
  );
  return {
    schema_version: 1,
    command: "commands",
    ...(group === undefined && search === undefined && option === undefined && pagination === undefined ? {} : {filters: {
      ...(group === undefined ? {} : {group}),
      ...(search === undefined ? {} : {search}),
      ...(option === undefined ? {} : {option}),
      ...(pagination === undefined ? {} : {pagination})
    }}),
    count: definitions.length,
    commands: definitions.map(({name, summary, endpoint}) => ({command: name, summary, endpoint})),
  };
}

export function describeCommand(definition) {
  return {
    schema_version: 1,
    command: definition.name,
    summary: definition.summary,
    method: "GET",
    endpoint: definition.endpoint,
    result_key: definition.resultKey,
    result_type: definition.resultType,
    options: definition.options.map((option) => ({
      flag: `--${option.flag}`,
      type: option.type,
      required: option.required === true,
      location: option.location ?? "query",
      parameter: option.pathName ?? option.query,
      description: option.description,
      ...(option.defaultValue === undefined ? {} : {default: option.defaultValue}),
      ...(option.min === undefined ? {} : {minimum: option.min}),
      ...(option.max === undefined ? {} : {maximum: option.max}),
      ...(option.enum === undefined ? {} : {choices: option.enum}),
      ...(option.csv ? {comma_separated: true} : {}),
      ...(option.maxItems === undefined ? {} : {maximum_items: option.maxItems}),
      ...(option.repeatedQuery ? {repeated_query: true} : {}),
      ...(option.ticker ? {ticker: true} : {}),
      ...(option.maxLength === undefined ? {} : {maximum_length: option.maxLength}),
      ...(option.ascii ? {printable_ascii: true} : {}),
      ...(option.csvTickers ? {ticker_items: true} : {}),
    })),
    notes: definition.helpNotes ?? [],
  };
}

export function commandHelp(definition, planning = false) {
  const rows = definition.options.map((option) => {
    const value = option.type === "boolean" ? "" : ` <${option.type === "integer" ? "integer" : "value"}>`;
    const required = option.required ? " Required." : "";
    return `  --${option.flag}${value}`.padEnd(42) + option.description + required;
  });
  return [
    definition.summary,
    "",
    `Usage: kalshi ${planning ? "plan " : ""}${definition.name}${definition.options.length ? " [options]" : ""}`,
    ...(rows.length ? ["", "Options:", ...rows] : []),
    ...(definition.helpNotes?.length ? ["", "Notes:", ...definition.helpNotes.map((note) => `  ${note}`)] : []),
    "",
    "  --help".padEnd(42) + "Show this help."
  ].join("\n");
}
