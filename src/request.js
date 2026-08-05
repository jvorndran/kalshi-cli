import {CliError} from "./errors.js";

export const BASE_URL = "https://external-api.kalshi.com/trade-api/v2";

export function buildRequest(definition, values) {
  let endpoint = definition.endpoint;
  const query = {};

  for (const option of definition.options) {
    const value = values[option.key];
    if (value === undefined) continue;
    if (option.location === "path") {
      endpoint = endpoint.replace(`{${option.pathName}}`, encodeURIComponent(String(value)));
    } else {
      query[option.query] = value;
    }
  }

  if (/\{[^}]+\}/.test(endpoint)) {
    throw new CliError("internal_contract_error", "A required path value was not resolved.", {
      exitCode: 1,
      command: definition.name
    });
  }

  const url = new URL(`${BASE_URL}${endpoint}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  return {endpoint, query, url: url.toString()};
}
