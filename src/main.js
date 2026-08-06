import {Buffer} from "node:buffer";
import {parseArguments} from "./args.js";
import {commandHelp, rootHelp} from "./commands.js";
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

function renderResultYaml(result) {
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
      hint: "Use a smaller --limit, narrower filter, or shorter candle range."
    });
  }
  return rendered;
}

function writeResultYaml(stream, result) {
  write(stream, renderResultYaml(result));
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
      write(stdout, `${commandHelp(parsed.definition)}\n`);
      return 0;
    }

    const request = buildRequest(parsed.definition, parsed.values);
    const result = await executeRequest(parsed.definition, request, options);
    try {
      writeResultYaml(stdout, result);
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
