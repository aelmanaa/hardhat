import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";

import {
  assertRejects,
  createTmpDir,
} from "@nomicfoundation/hardhat-test-utils";
import {
  readdir,
  readUtf8File,
  writeUtf8File,
} from "@nomicfoundation/hardhat-utils/fs";

import {
  dumpResultToJson,
  jsonToLoadParam,
  writeStateFile,
} from "../../../../../src/internal/builtin-plugins/node/state/state-file.js";

describe("state file", () => {
  const tmp = createTmpDir("node-state-file", "test");

  it("converts a dump result to JSON", async () => {
    const json = '{"accounts":{}}';
    const dumpResult = `0x${gzipSync(Buffer.from(json)).toString("hex")}`;

    assert.equal(await dumpResultToJson(dumpResult), json);
  });

  it("converts JSON to a load parameter", () => {
    assert.equal(jsonToLoadParam("{}"), "0x7b7d");
  });

  it("writes the file and leaves no temporary file", async () => {
    const filePath = path.join(tmp.path, "state.json");

    await writeStateFile(filePath, '{"a":1}');

    assert.equal(await readUtf8File(filePath), '{"a":1}');
    assert.deepEqual(await readdir(tmp.path), ["state.json"]);
  });

  it("replaces an existing file", async () => {
    const filePath = path.join(tmp.path, "state.json");
    await writeUtf8File(filePath, "old");

    await writeStateFile(filePath, "new");

    assert.equal(await readUtf8File(filePath), "new");
  });

  it("keeps the previous file and removes the temporary file when the write fails", async () => {
    const filePath = path.join(tmp.path, "state.json");
    await writeUtf8File(filePath, "old");
    // Renaming a file over a non-empty directory fails, which stands in for a
    // failure between writing the temporary file and replacing the state file.
    const blockedPath = path.join(tmp.path, "blocked");
    await writeUtf8File(path.join(blockedPath, "child"), "");

    await assertRejects(writeStateFile(blockedPath, "new"));

    assert.equal(await readUtf8File(filePath), "old");
    assert.deepEqual((await readdir(tmp.path)).sort(), [
      "blocked",
      "state.json",
    ]);
  });
});
