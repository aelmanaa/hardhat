import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { HardhatError } from "@nomicfoundation/hardhat-errors";
import {
  assertRejectsWithHardhatError,
  createTmpDir,
} from "@nomicfoundation/hardhat-test-utils";
import { mkdir, writeUtf8File } from "@nomicfoundation/hardhat-utils/fs";

import { resolveNodeStateParams } from "../../../../../src/internal/builtin-plugins/node/utils/resolve-node-state-params.js";

describe("resolveNodeStateParams", () => {
  const tmp = createTmpDir("resolve-node-state-params", "test");

  it("returns nothing without state options", async () => {
    assert.deepEqual(await resolveNodeStateParams({}, tmp.path), {
      loadPath: undefined,
      dumpPath: undefined,
    });
  });

  it("loads and saves the --state file when it exists", async () => {
    await writeUtf8File(path.join(tmp.path, "chain.json"), "{}");

    assert.deepEqual(
      await resolveNodeStateParams({ state: "chain.json" }, tmp.path),
      {
        loadPath: path.join(tmp.path, "chain.json"),
        dumpPath: path.join(tmp.path, "chain.json"),
      },
    );
  });

  it("only saves the --state file when it doesn't exist yet", async () => {
    assert.deepEqual(
      await resolveNodeStateParams({ state: "new.json" }, tmp.path),
      { loadPath: undefined, dumpPath: path.join(tmp.path, "new.json") },
    );
  });

  it("uses state.json inside a directory", async () => {
    await mkdir(path.join(tmp.path, "states"));

    assert.deepEqual(
      await resolveNodeStateParams(
        { loadState: undefined, dumpState: "states" },
        tmp.path,
      ),
      {
        loadPath: undefined,
        dumpPath: path.join(tmp.path, "states", "state.json"),
      },
    );
  });

  it("accepts --load-state and --dump-state together", async () => {
    await writeUtf8File(path.join(tmp.path, "in.json"), "{}");

    assert.deepEqual(
      await resolveNodeStateParams(
        { loadState: "in.json", dumpState: "out.json" },
        tmp.path,
      ),
      {
        loadPath: path.join(tmp.path, "in.json"),
        dumpPath: path.join(tmp.path, "out.json"),
      },
    );
  });

  it("fails when the --load-state file doesn't exist", async () => {
    await assertRejectsWithHardhatError(
      resolveNodeStateParams({ loadState: "missing.json" }, tmp.path),
      HardhatError.ERRORS.CORE.NODE.LOAD_STATE_FILE_NOT_FOUND,
      { path: path.join(tmp.path, "missing.json") },
    );
  });

  it("rejects --state with --load-state or --dump-state", async () => {
    await assertRejectsWithHardhatError(
      resolveNodeStateParams({ state: "a.json", loadState: "b.json" }, tmp.path),
      HardhatError.ERRORS.CORE.ARGUMENTS.MUTUALLY_EXCLUSIVE_OPTIONS,
      { optionA: "state", optionB: "load-state" },
    );
    await assertRejectsWithHardhatError(
      resolveNodeStateParams({ state: "a.json", dumpState: "b.json" }, tmp.path),
      HardhatError.ERRORS.CORE.ARGUMENTS.MUTUALLY_EXCLUSIVE_OPTIONS,
      { optionA: "state", optionB: "dump-state" },
    );
  });
});
