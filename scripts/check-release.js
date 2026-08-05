import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const manifest = require("../package.json");
const releaseTag = process.argv[2] ?? process.env.RELEASE_TAG;
const expectedTag = `v${manifest.version}`;

if (!releaseTag) {
  console.error("A release tag is required. Pass v<version> or set RELEASE_TAG.");
  process.exitCode = 2;
} else if (releaseTag !== expectedTag) {
  console.error(`Release tag ${releaseTag} does not match package version ${expectedTag}.`);
  process.exitCode = 1;
} else {
  console.log(`Release tag ${releaseTag} matches package version ${manifest.version}.`);
}
