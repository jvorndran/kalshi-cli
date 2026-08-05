import {COMMANDS} from "./commands.js";
import {CliError} from "./errors.js";

const TICKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

function resolveCommand(argv) {
  const matches = COMMANDS
    .filter((definition) => definition.path.every((part, index) => argv[index] === part))
    .sort((left, right) => right.path.length - left.path.length);

  if (!matches.length) {
    throw new CliError("unknown_command", `Unknown command: ${argv.join(" ") || "(none)"}.`, {
      hint: "Run kalshi --help to list commands."
    });
  }

  return matches[0];
}

function parseBoolean(value, flag) {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CliError("invalid_argument", `--${flag} must be true or false.`);
}

function parseInteger(value, option) {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new CliError("invalid_argument", `--${option.flag} must be a non-negative integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new CliError("invalid_argument", `--${option.flag} exceeds JavaScript's safe integer range.`);
  }
  return parsed;
}

function normalizeString(value, option) {
  const normalized = value.trim();
  if (!normalized) throw new CliError("invalid_argument", `--${option.flag} cannot be empty.`);
  if (CONTROL_PATTERN.test(normalized)) throw new CliError("invalid_argument", `--${option.flag} contains a control character.`);
  if (option.maxLength && normalized.length > option.maxLength) {
    throw new CliError("invalid_argument", `--${option.flag} must be at most ${option.maxLength} characters.`);
  }
  if (option.ascii && !/^[\x20-\x7e]+$/.test(normalized)) {
    throw new CliError("invalid_argument", `--${option.flag} must contain printable ASCII characters only.`);
  }
  if (option.ticker && !TICKER_PATTERN.test(normalized)) {
    throw new CliError("invalid_argument", `--${option.flag} must be a 1-200 character ticker using letters, numbers, period, underscore, or hyphen.`);
  }
  if (option.csv) {
    const values = normalized.split(",").map((part) => part.trim());
    if (values.some((part) => !part)) throw new CliError("invalid_argument", `--${option.flag} contains an empty comma-separated value.`);
    if (option.maxItems && values.length > option.maxItems) {
      throw new CliError("invalid_argument", `--${option.flag} accepts at most ${option.maxItems} values.`);
    }
    if (option.csvTickers && values.some((part) => !TICKER_PATTERN.test(part))) {
      throw new CliError("invalid_argument", `--${option.flag} contains an invalid ticker.`);
    }
    return values.join(",");
  }
  return normalized;
}

function validateValue(value, option) {
  if (option.type === "boolean") return parseBoolean(value, option.flag);
  const normalized = option.type === "integer" ? parseInteger(value, option) : normalizeString(value, option);

  if (option.min !== undefined && normalized < option.min) {
    throw new CliError("invalid_argument", `--${option.flag} must be at least ${option.min}.`);
  }
  if (option.max !== undefined && normalized > option.max) {
    throw new CliError("invalid_argument", `--${option.flag} must be at most ${option.max}.`);
  }
  if (option.enum && !option.enum.includes(normalized)) {
    const hint = option.flag === "status" && normalized === "all" ? "Omit --status to request every status." : undefined;
    throw new CliError("invalid_argument", `--${option.flag} must be one of: ${option.enum.join(", ")}.`, {hint});
  }
  return normalized;
}

function parseOptions(definition, args) {
  const byFlag = new Map(definition.options.map((option) => [option.flag, option]));
  const values = {};
  const seen = new Set();
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--help") {
      help = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new CliError("unexpected_argument", `Unexpected positional argument: ${token}.`, {
        command: definition.name,
        hint: `Run kalshi ${definition.name} --help.`
      });
    }

    let raw = token.slice(2);
    let explicitValue;
    const equalsIndex = raw.indexOf("=");
    if (equalsIndex >= 0) {
      explicitValue = raw.slice(equalsIndex + 1);
      raw = raw.slice(0, equalsIndex);
    }

    const negated = raw.startsWith("no-");
    const flag = negated ? raw.slice(3) : raw;
    const option = byFlag.get(flag);
    if (!option) {
      throw new CliError("unknown_option", `Unknown option for ${definition.name}: --${raw}.`, {
        command: definition.name,
        hint: `Run kalshi ${definition.name} --help.`
      });
    }
    if (seen.has(option.key)) throw new CliError("duplicate_option", `--${flag} was supplied more than once.`, {command: definition.name});
    seen.add(option.key);

    let rawValue;
    if (option.type === "boolean") {
      if (negated && explicitValue !== undefined) throw new CliError("invalid_argument", `--no-${flag} does not accept a value.`);
      if (negated) rawValue = false;
      else if (explicitValue !== undefined) rawValue = explicitValue;
      else if (["true", "false"].includes(args[index + 1])) rawValue = args[index += 1];
      else rawValue = true;
    } else {
      if (negated) throw new CliError("invalid_argument", `--no-${flag} is valid only for boolean options.`);
      if (explicitValue !== undefined) rawValue = explicitValue;
      else {
        const next = args[index + 1];
        if (next === undefined || next.startsWith("--")) throw new CliError("missing_option_value", `--${flag} requires a value.`);
        rawValue = next;
        index += 1;
      }
    }

    values[option.key] = validateValue(rawValue, option);
  }

  if (!help) {
    for (const option of definition.options) {
      if (option.required && values[option.key] === undefined) {
        throw new CliError("missing_required_option", `--${option.flag} is required.`, {
          command: definition.name,
          hint: `Run kalshi ${definition.name} --help.`
        });
      }
    }
    const validationMessage = definition.validate?.(values);
    if (validationMessage) throw new CliError("invalid_query", validationMessage, {command: definition.name});
  }

  return {values, help};
}

export function parseArguments(argv) {
  if (!argv.length || argv[0] === "--help") return {kind: "root_help"};
  if (argv[0] === "--version") {
    if (argv.length > 1) throw new CliError("unexpected_argument", "--version does not accept additional arguments.");
    return {kind: "version"};
  }

  const definition = resolveCommand(argv);
  const {values, help} = parseOptions(definition, argv.slice(definition.path.length));
  return {kind: help ? "command_help" : "request", definition, values};
}
