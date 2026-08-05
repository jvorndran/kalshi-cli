import {Buffer} from "node:buffer";
import {createHash} from "node:crypto";
import {CliError} from "./errors.js";
import {VERSION} from "./version.js";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
export const RAW_DATA = Symbol("kalshi.rawData");

const MAX_ERROR_DETAIL_DEPTH = 5;
const MAX_ERROR_DETAIL_ENTRIES = 50;
const MAX_ERROR_DETAIL_STRING_LENGTH = 2000;

async function readResponseBytes(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new CliError("response_too_large", `Kalshi response exceeds the ${maxBytes}-byte safety limit.`, {exitCode: 1});
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new CliError("response_too_large", `Kalshi response exceeds the ${maxBytes}-byte safety limit.`, {exitCode: 1});
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function parseJson(bytes, response) {
  let text;
  try {
    text = new TextDecoder("utf-8", {fatal: true}).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new CliError("upstream_invalid_utf8", "Kalshi returned a response that is not valid UTF-8.", {exitCode: 1, status: response.status});
  }
  if (!text.trim()) throw new CliError("upstream_empty_response", "Kalshi returned an empty response.", {exitCode: 1, status: response.status});
  try {
    return {body: JSON.parse(text), text};
  } catch {
    throw new CliError("upstream_invalid_json", "Kalshi returned a response that is not valid JSON.", {exitCode: 1, status: response.status});
  }
}

function sanitizeErrorDetails(value, depth = 0) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, MAX_ERROR_DETAIL_STRING_LENGTH);
  if (value === undefined) return undefined;
  if (depth >= MAX_ERROR_DETAIL_DEPTH) return "[truncated]";

  if (Array.isArray(value)) {
    const entries = value
      .slice(0, MAX_ERROR_DETAIL_ENTRIES)
      .map((entry) => sanitizeErrorDetails(entry, depth + 1));
    if (value.length > MAX_ERROR_DETAIL_ENTRIES) entries.push("[truncated]");
    return entries;
  }

  if (typeof value === "object") {
    const result = Object.create(null);
    const entries = Object.entries(value);
    for (const [key, entry] of entries.slice(0, MAX_ERROR_DETAIL_ENTRIES)) {
      result[key] = sanitizeErrorDetails(entry, depth + 1);
    }
    if (entries.length > MAX_ERROR_DETAIL_ENTRIES) result._truncated = true;
    return result;
  }

  return String(value).slice(0, MAX_ERROR_DETAIL_STRING_LENGTH);
}

function providerError(body, status) {
  const candidate = body?.error ?? body;
  const message = candidate?.message ?? body?.msg ?? `Kalshi returned HTTP ${status}.`;
  const details = sanitizeErrorDetails(candidate?.details);
  const hint = status === 401
    ? "This CLI intentionally has no authentication support; verify that the endpoint remains public."
    : status === 429
      ? "Retry later with caller-controlled exponential backoff."
      : undefined;
  return {message: String(message).slice(0, 1000), details, hint};
}

function validateShape(definition, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new CliError("upstream_shape_error", "Kalshi returned a non-object JSON response.", {exitCode: 1});
  }
  const value = body[definition.resultKey];
  if (value === undefined) {
    throw new CliError("upstream_shape_error", `Kalshi response is missing the expected ${definition.resultKey} field.`, {exitCode: 1});
  }
  if (definition.resultType === "array" && !Array.isArray(value)) {
    throw new CliError("upstream_shape_error", `Kalshi response field ${definition.resultKey} is not an array.`, {exitCode: 1});
  }
  if (definition.resultType === "object" && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new CliError("upstream_shape_error", `Kalshi response field ${definition.resultKey} is not an object.`, {exitCode: 1});
  }
  if (definition.resultType === "string" && typeof value !== "string") {
    throw new CliError("upstream_shape_error", `Kalshi response field ${definition.resultKey} is not a string.`, {exitCode: 1});
  }
}

function countPrimary(definition, body) {
  const value = body[definition.resultKey];
  if (Array.isArray(value)) return value.length;
  return value === null || value === undefined ? 0 : 1;
}

function enrich(error, definition, request) {
  error.command ??= definition.name;
  error.endpoint ??= request.endpoint;
  error.query ??= request.query;
  return error;
}

export async function executeRequest(definition, request, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("The request timed out.", "TimeoutError")), timeoutMs);
  const requestedAt = now().toISOString();

  try {
    const response = await fetchImpl(request.url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": `@jvorndran/kalshi-cli/${VERSION}`
      },
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal
    });
    const bytes = await readResponseBytes(response, maxResponseBytes);
    const {body, text} = parseJson(bytes, response);
    if (!response.ok) {
      const normalized = providerError(body, response.status);
      throw new CliError("kalshi_http_error", normalized.message, {
        exitCode: 1,
        status: response.status,
        details: normalized.details,
        hint: normalized.hint
      });
    }
    validateShape(definition, body);
    const observedAt = now().toISOString();
    const responseHash = createHash("sha256").update(bytes).digest("hex");
    const result = {
      provider: "kalshi",
      command: definition.name,
      endpoint: request.endpoint,
      query: request.query,
      source_url: request.url,
      requested_at: requestedAt,
      observed_at: observedAt,
      response_sha256: `sha256:${responseHash}`,
      count: countPrimary(definition, body),
      data: body
    };
    Object.defineProperty(result, RAW_DATA, {value: text, enumerable: false});
    return result;
  } catch (error) {
    if (error instanceof CliError) throw enrich(error, definition, request);
    if (controller.signal.aborted || error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw enrich(new CliError("network_timeout", `Kalshi did not complete the response within ${timeoutMs}ms.`, {exitCode: 1}), definition, request);
    }
    throw enrich(new CliError("network_error", "Unable to retrieve public Kalshi market data.", {
      exitCode: 1,
      details: error?.cause?.code ?? error?.code
    }), definition, request);
  } finally {
    clearTimeout(timeout);
  }
}
