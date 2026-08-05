import {parseArguments} from "./args.js";
import {commandHelp, rootHelp} from "./commands.js";
import {CliError, errorDocument} from "./errors.js";
import {executeRequest, RAW_DATA} from "./execute.js";
import {buildRequest} from "./request.js";
import {VERSION} from "./version.js";

export {VERSION};

function write(stream, value) {
  try {
    stream.write(value);
  } catch (error) {
    if (error?.code !== "EPIPE") throw error;
  }
}

function writeJson(stream, value) {
  let serialized;
  try {
    serialized = JSON.stringify(value, null, 2);
  } catch {
    serialized = JSON.stringify({
      error: {
        code: "serialization_error",
        message: "Unable to serialize the CLI result safely."
      }
    }, null, 2);
  }
  write(stream, `${serialized}\n`);
}

function writeResultJson(stream, result) {
  const rawData = result[RAW_DATA];
  if (typeof rawData !== "string") {
    writeJson(stream, result);
    return;
  }

  const {data: _data, ...envelope} = result;
  const head = JSON.stringify(envelope, null, 2).slice(0, -1).trimEnd();
  const data = rawData
    .trim()
    .split(/\r?\n/)
    .map((line, index) => index === 0 ? line : `  ${line}`)
    .join("\n");
  write(stream, `${head},\n  "data": ${data}\n}\n`);
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
    writeResultJson(stdout, result);
    return 0;
  } catch (caught) {
    const error = caught instanceof CliError
      ? caught
      : new CliError("unexpected_error", "An unexpected error occurred.", {exitCode: 1});
    writeJson(stderr, errorDocument(error));
    return error.exitCode ?? 1;
  }
}
