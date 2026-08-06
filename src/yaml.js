const RAW_NUMBER = Symbol("yaml.rawNumber");

const JSON_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const AMBIGUOUS_WORD_PATTERN = /^(?:~|null|true|false|yes|no|on|off|\.nan|[+-]?\.inf)$/i;
const NUMBER_LIKE_PATTERN = /^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?|0x[\da-f]+|0o[0-7]+|0b[01]+)$/i;
const DATE_LIKE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[Tt ]|$)/;
const UNSAFE_START_PATTERN = /^[:!&*,'"%@`{}\[\],#|>?-]/;

function rawNumber(source) {
  if (!JSON_NUMBER_PATTERN.test(source)) throw new TypeError("Invalid raw JSON number.");
  return Object.freeze({[RAW_NUMBER]: source});
}

function isRawNumber(value) {
  return value !== null && typeof value === "object" && typeof value[RAW_NUMBER] === "string";
}

export function parseLosslessJson(text) {
  return JSON.parse(text, (_key, value, context) => {
    if (typeof value !== "number") return value;
    if (typeof context?.source !== "string") {
      throw new TypeError("This Node.js runtime cannot preserve JSON number lexemes.");
    }
    return rawNumber(context.source);
  });
}

function quoteString(value) {
  return JSON.stringify(value)
    .replaceAll("\u0085", "\\u0085")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function canUsePlainString(value) {
  if (!value || value.trim() !== value) return false;
  if (/[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(value)) return false;
  if (UNSAFE_START_PATTERN.test(value)) return false;
  if (/[:#](?:\s|$)/.test(value)) return false;
  if (AMBIGUOUS_WORD_PATTERN.test(value)) return false;
  if (NUMBER_LIKE_PATTERN.test(value)) return false;
  if (DATE_LIKE_PATTERN.test(value)) return false;
  if (value === "---" || value === "...") return false;
  return true;
}

function renderString(value) {
  return canUsePlainString(value) ? value : quoteString(value);
}

function renderKey(value) {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value) && !AMBIGUOUS_WORD_PATTERN.test(value)
    ? value
    : quoteString(value);
}

function isCollection(value) {
  return value !== null && typeof value === "object" && !isRawNumber(value);
}

function entriesOf(value) {
  return Object.entries(value).filter(([, entry]) => entry !== undefined);
}

function isEmptyCollection(value) {
  return Array.isArray(value) ? value.length === 0 : entriesOf(value).length === 0;
}

function renderScalar(value) {
  if (isRawNumber(value)) return value[RAW_NUMBER];
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return renderString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (isCollection(value) && isEmptyCollection(value)) return Array.isArray(value) ? "[]" : "{}";
  throw new TypeError(`Unsupported YAML value type: ${typeof value}.`);
}

function appendCollection(lines, value, indent) {
  if (Array.isArray(value)) appendSequence(lines, value, indent);
  else appendMapping(lines, value, indent);
}

function appendMapping(lines, value, indent, sequenceItem = false) {
  const entries = entriesOf(value);
  for (let index = 0; index < entries.length; index += 1) {
    const [key, entry] = entries[index];
    const firstSequenceEntry = sequenceItem && index === 0;
    const mappingIndent = indent + (sequenceItem && index > 0 ? 2 : 0);
    const prefix = firstSequenceEntry ? "- " : "";
    const head = `${" ".repeat(mappingIndent)}${prefix}${renderKey(key)}:`;

    if (!isCollection(entry) || isEmptyCollection(entry)) {
      lines.push(`${head} ${renderScalar(entry)}`);
      continue;
    }

    lines.push(head);
    appendCollection(lines, entry, mappingIndent + (firstSequenceEntry ? 4 : 2));
  }
}

function appendSequence(lines, value, indent) {
  for (const entry of value) {
    if (!isCollection(entry) || isEmptyCollection(entry)) {
      lines.push(`${" ".repeat(indent)}- ${renderScalar(entry)}`);
      continue;
    }
    if (Array.isArray(entry)) {
      lines.push(`${" ".repeat(indent)}-`);
      appendSequence(lines, entry, indent + 2);
      continue;
    }
    appendMapping(lines, entry, indent, true);
  }
}

export function renderYamlDocument(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isRawNumber(value)) {
    throw new TypeError("The YAML document root must be a mapping.");
  }
  const lines = [];
  appendMapping(lines, value, 0);
  if (!lines.length) return "{}\n";
  return `${lines.join("\n")}\n`;
}
