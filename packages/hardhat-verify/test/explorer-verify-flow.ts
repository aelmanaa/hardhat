import type { Interceptable } from "@nomicfoundation/hardhat-utils/request";
import type { HardhatUserConfig } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { HardhatError } from "@nomicfoundation/hardhat-errors";
import { useEphemeralFixtureProject } from "@nomicfoundation/hardhat-test-utils";
import { createHardhatRuntimeEnvironment } from "hardhat/hre";

import { ETHERSCAN_API_URL } from "../src/internal/constants.js";
import { resumeVerification } from "../src/internal/tasks/verify/resume/task-action.js";
import { verifyContract } from "../src/internal/verification.js";

import { deployContract, initializeTestDispatcher } from "./utils.js";

const ETHERSCAN_PATH = /^\/v2\/api\?chainid=11155111$/;

function hasAction(action: string): (body: string | undefined) => boolean {
  return (body) =>
    typeof body === "string" &&
    new URLSearchParams(body).get("action") === action;
}

function mockLookup(
  interceptable: Interceptable,
  entry: Record<string, string>,
  times = 1,
) {
  interceptable
    .intercept({
      path: ETHERSCAN_PATH,
      method: "POST",
      body: hasAction("getsourcecode"),
    })
    .reply(200, { status: "1", message: "OK", result: [entry] })
    .times(times);
}

function mockSubmit(interceptable: Interceptable) {
  interceptable
    .intercept({
      path: ETHERSCAN_PATH,
      method: "POST",
      body: hasAction("verifysourcecode"),
    })
    .reply(200, { status: "1", message: "OK", result: "job-1234" });
}

function mockStatus(interceptable: Interceptable, result: string, times = 1) {
  interceptable
    .intercept({
      path: ETHERSCAN_PATH,
      method: "POST",
      body: hasAction("checkverifystatus"),
    })
    .reply(200, { status: "1", message: "OK", result })
    .times(times);
}

describe("verification through explorer-verify", () => {
  useEphemeralFixtureProject("integration");
  const testDispatcher = initializeTestDispatcher({
    url: new URL(ETHERSCAN_API_URL).origin,
  });

  let hre: HardhatRuntimeEnvironment;
  before(async () => {
    const hardhatUserConfig: HardhatUserConfig =
      // eslint-disable-next-line import/no-relative-packages -- allowed in test
      (await import("./fixture-projects/integration/hardhat.config.js"))
        .default;
    hre = await createHardhatRuntimeEnvironment(hardhatUserConfig);
    await hre.tasks.getTask("build").run();
  });

  it("should print the already-verified message and submit nothing when the explorer holds this source", async () => {
    const { provider } = await hre.network.create();
    const address = await deployContract("Counter", [], {}, hre, provider);
    mockLookup(testDispatcher.interceptable, {
      SourceCode: "contract Counter {}",
      ContractName: "Counter",
    });

    const lines: string[] = [];
    const result = await verifyContract(
      { address },
      hre,
      (line) => lines.push(line),
      testDispatcher.dispatcher,
      provider,
    );

    assert.equal(result, true);
    const output = lines.join("\n");
    assert.ok(
      output.includes(
        `The contract at ${address} has already been verified on Etherscan.`,
      ),
      "the output should match",
    );
    assert.ok(
      output.includes(
        `Explorer: https://sepolia.etherscan.io/address/${address}#code`,
      ),
      "the output should match",
    );
    assert.ok(
      !output.includes("Submitted source code"),
      "the output should match",
    );
  });

  it("should submit over another contract's source and say so", async () => {
    const { provider } = await hre.network.create();
    const address = await deployContract("Counter", [], {}, hre, provider);
    mockLookup(testDispatcher.interceptable, {
      SourceCode: "contract SomethingElse {}",
      ContractName: "SomethingElse",
    });
    mockSubmit(testDispatcher.interceptable);
    mockStatus(testDispatcher.interceptable, "Pass - Verified");

    const lines: string[] = [];
    const result = await verifyContract(
      { address },
      hre,
      (line) => lines.push(line),
      testDispatcher.dispatcher,
      provider,
    );

    assert.equal(result, true);
    const output = lines.join("\n");
    assert.ok(
      output.includes(
        "Etherscan holds another contract's source (SomethingElse); submitting this source.",
      ),
      output,
    );
    assert.ok(
      output.includes("Submitted source code for verification"),
      "the output should match",
    );
    assert.ok(
      output.includes("Contract verified successfully on Etherscan!"),
      "the output should match",
    );
  });

  it("should throw VERIFICATION_NOT_CONFIRMED with a handle that `verify resume` completes", async () => {
    const { provider } = await hre.network.create();
    const address = await deployContract("Counter", [], {}, hre, provider);
    // The first lookup, then the one explorer-verify sends when the time
    // limit runs out.
    mockLookup(testDispatcher.interceptable, { SourceCode: "" }, 2);
    mockSubmit(testDispatcher.interceptable);
    mockStatus(testDispatcher.interceptable, "Pending in queue");

    let handle: string | undefined;
    try {
      await verifyContract(
        { address, verificationTimeout: 1 },
        hre,
        () => {},
        testDispatcher.dispatcher,
        provider,
      );
      assert.fail("verifyContract should have thrown");
    } catch (error) {
      assert.ok(
        HardhatError.isHardhatError(
          error,
          HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.VERIFICATION_NOT_CONFIRMED,
        ),
        String(error),
      );
      handle = String(error.messageArguments.handle);
    }

    assert.equal(
      handle,
      `ev1:etherscan-v2:11155111:${address.toLowerCase()}:job-1234`,
    );

    mockStatus(testDispatcher.interceptable, "Pass - Verified");
    const lines: string[] = [];
    const resumed = await resumeVerification(
      { handle, verificationTimeout: 0 },
      hre,
      (line) => lines.push(line),
      testDispatcher.dispatcher,
    );

    assert.equal(resumed, true);
    assert.ok(
      lines.join("\n").includes("Contract verified successfully on Etherscan!"),
      "the output should match",
    );
  });
});
