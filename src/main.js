import {Buffer} from "node:buffer";
import {parseArguments} from "./args.js";
import {commandCatalog, commandHelp, describeCommand, rootHelp} from "./commands.js";
import {CliError, errorDocument} from "./errors.js";
import {executeRequest, RAW_DATA} from "./execute.js";
import {buildRequest} from "./request.js";
import {VERSION} from "./version.js";
import {parseLosslessJson, renderYamlDocument} from "./yaml.js";

export {VERSION};

export const MAX_OUTPUT_BYTES = 64 * 1024;

function write(stream, value) {
  try {
    stream.write(value);
  } catch (error) {
    if (error?.code !== "EPIPE") throw error;
  }
}

function writeYaml(stream, value) {
  write(stream, renderYamlDocument(value));
}

function renderResultYaml(result, definition) {
  const rawData = result[RAW_DATA];
  const rendered = renderYamlDocument(
    typeof rawData === "string" ? {...result, data: parseLosslessJson(rawData)} : result
  );
  if (Buffer.byteLength(rendered, "utf8") > MAX_OUTPUT_BYTES) {
    throw new CliError("output_too_large", `Formatted YAML output exceeds the ${MAX_OUTPUT_BYTES}-byte safety limit.`, {
      exitCode: 1,
      command: result.command,
      endpoint: result.endpoint,
      query: result.query,
      hint: definition.outputTooLargeHint ?? "Use a smaller --limit, narrower filter, or shorter candle range."
    });
  }
  return rendered;
}

function writeResultYaml(stream, result, definition) {
  write(stream, renderResultYaml(result, definition));
}

export async function runCli(argv, options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  try {
    const parsed = parseArguments(argv);
    if (parsed.kind === "root_help") {
      write(stdout, `${rootHelp(VERSION)}\n`);
      return 0;
    }
    if (parsed.kind === "version") {
      write(stdout, `${VERSION}\n`);
      return 0;
    }
    if (parsed.kind === "command_help") {
      write(stdout, `${commandHelp(parsed.definition, parsed.planning)}\n`);
      return 0;
    }
    if (parsed.kind === "plan_help") {
      write(stdout, "Usage: kalshi plan <command> [options]\n\nValidate and preview a public GET request as YAML without fetching it.\nUse the same command path and options as execution; all local validation applies.\nRun kalshi plan <command> --help for options.\n");
      return 0;
    }
    if (parsed.kind === "command_description") {
      writeYaml(stdout, describeCommand(parsed.definition));
      return 0;
    }
    if (parsed.kind === "catalog_help") {
      write(stdout, "Usage: kalshi commands\n\nList the installed public GET commands as YAML.\n");
      return 0;
    }
    if (parsed.kind === "command_catalog") {
      writeYaml(stdout, commandCatalog());
      return 0;
    }

    const request = buildRequest(parsed.definition, parsed.values);
    if (parsed.kind === "request_plan") {
      writeResultYaml(stdout, {
        schema_version: 1,
        command: "plan",
        request: {
          command: parsed.definition.name,
          method: "GET",
          endpoint: request.endpoint,
          query: request.query,
          source_url: request.url
        }
      }, parsed.definition);
      return 0;
    }
    const result = await executeRequest(parsed.definition, request, options);
    try {
      writeResultYaml(stdout, result, parsed.definition);
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError("serialization_error", "Unable to serialize the CLI result safely.", {exitCode: 1});
    }
    return 0;
  } catch (caught) {
    const error = caught instanceof CliError
      ? caught
      : new CliError("unexpected_error", "An unexpected error occurred.", {exitCode: 1});
    try {
      writeYaml(stderr, errorDocument(error));
    } catch {
      write(stderr, "error:\n  code: serialization_error\n  message: Unable to serialize the CLI error safely.\n");
    }
    return error.exitCode ?? 1;
  }
}
