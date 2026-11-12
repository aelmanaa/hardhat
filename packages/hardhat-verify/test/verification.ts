import type { Interceptable } from "@nomicfoundation/hardhat-utils/request";
import type { HardhatUserConfig } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { HardhatError } from "@nomicfoundation/hardhat-errors";
import {
  assertRejectsWithHardhatError,
  assertThrowsHardhatError,
  useEphemeralFixtureProject,
} from "@nomicfoundation/hardhat-test-utils";
import { createHardhatRuntimeEnvironment } from "hardhat/hre";

import {
  ETHERSCAN_API_URL,
  VERIFICATION_PROVIDER_NAMES,
} from "../src/internal/constants.js";
import {
  verifyContract,
  validateArgs,
  validateVerificationProviderName,
} from "../src/internal/verification.js";
import { deployContract, initializeTestDispatcher } from "../test/utils.js";

describe("verification", () => {
  describe("verifyContract", () => {
    describe("base cases", () => {
      useEphemeralFixtureProject("integration");
      const etherscanApiUrl = new URL(ETHERSCAN_API_URL).origin;
      const testDispatcher = initializeTestDispatcher({
        url: etherscanApiUrl,
      });

      let hardhatUserConfig: HardhatUserConfig;
      let hre: HardhatRuntimeEnvironment;
      before(async () => {
        hardhatUserConfig =
          // eslint-disable-next-line import/no-relative-packages -- allowed in test
          (await import("./fixture-projects/integration/hardhat.config.js"))
            .default;
        hre = await createHardhatRuntimeEnvironment(hardhatUserConfig);
        await hre.tasks.getTask("build").run();
      });

      let etherscanMock: ReturnType<typeof mockEtherscanRequests>;
      beforeEach(() => {
        etherscanMock = mockEtherscanRequests(testDispatcher.interceptable);
      });

      it("should verify a contract with no constructor arguments or libraries", async () => {
        const { provider } = await hre.network.create();
        const address = await deployContract("Counter", [], {}, hre, provider);

        const result = await verifyContract(
          {
            address,
          },
          hre,
          () => {},
          testDispatcher.dispatcher,
          provider,
        );

        assert.ok(result, "Verification should return true");
      });

      it("should verify a contract with constructor arguments", async () => {
        const constructorArgs = [0, true];
        const { provider } = await hre.network.create();
        const address = await deployContract(
          "CounterWithArgs",
          [0, true],
          {},
          hre,
          provider,
        );

        const result = await verifyContract(
          {
            address,
            constructorArgs,
          },
          hre,
          () => {},
          testDispatcher.dispatcher,
          provider,
        );

        assert.ok(result, "Verification should return true");

        // The encoded arguments are what the explorer matches the creation
        // transaction against, so assert the payload and not just the outcome.
        assert.equal(
          etherscanMock.verifyRequestBody?.get("constructorArguments"),
          [
            // _initialX: uint256 (0)
            "0000000000000000000000000000000000000000000000000000000000000000",
            // _enabled: bool (true)
            "0000000000000000000000000000000000000000000000000000000000000001",
          ].join(""),
        );
      });

      it("should verify a contract with libraries", async () => {
        const { provider } = await hre.network.create();
        const libAddress = await deployContract(
          "CounterLib",
          [],
          {},
          hre,
          provider,
        );
        const libraries = { CounterLib: libAddress };
        const address = await deployContract(
          "CounterWithLib",
          [],
          libraries,
          hre,
          provider,
        );

        const result = await verifyContract(
          {
            address,
            libraries,
          },
          hre,
          () => {},
          testDispatcher.dispatcher,
          provider,
        );

        assert.ok(result, "Verification should return true");
      });

      it("should verify a contract with constructor arguments and libraries", async () => {
        const constructorArgs = [0, true];
        const { provider } = await hre.network.create();
        const libAddress = await deployContract(
          "CounterLib",
          [],
          {},
          hre,
          provider,
        );
        const libraries = { CounterLib: libAddress };
        const address = await deployContract(
          "CounterWithArgsAndLib",
          constructorArgs,
          libraries,
          hre,
          provider,
        );

        const result = await verifyContract(
          {
            address,
            constructorArgs,
            libraries,
          },
          hre,
          () => {},
          testDispatcher.dispatcher,
          provider,
        );

        assert.ok(result, "Verification should return true");
      });

      it("should verify a contract on a disabled provider", async () => {
        const localHre = await createHardhatRuntimeEnvironment({
          ...hardhatUserConfig,
          verify: {
            etherscan: {
              enabled: false,
              apiKey: "someApiKey",
            },
          },
        });
        const { provider } = await localHre.network.create();
        const address = await deployContract(
          "Counter",
          [],
          {},
          localHre,
          provider,
        );

        const result = await verifyContract(
          {
            address,
          },
          localHre,
          () => {},
          testDispatcher.dispatcher,
          provider,
        );

        assert.ok(
          !localHre.config.verify.etherscan.enabled,
          "Etherscan verification should be disabled",
        );
        assert.ok(result, "Verification should return true");
      });
    });

    describe("retry behavior", () => {
      useEphemeralFixtureProject("integration");
      const etherscanApiUrl = new URL(ETHERSCAN_API_URL).origin;
      const testDispatcher = initializeTestDispatcher({
        url: etherscanApiUrl,
      });

      let hre: HardhatRuntimeEnvironment;
      before(async () => {
        const hardhatUserConfig =
          // eslint-disable-next-line import/no-relative-packages -- allowed in test
          (await import("./fixture-projects/integration/hardhat.config.js"))
            .default;
        hre = await createHardhatRuntimeEnvironment(hardhatUserConfig);
        await hre.tasks.getTask("build").run();
      });

      it("should skip the full-input retry when the explorer rejects the constructor arguments", async () => {
        const { provider } = await hre.network.create();
        const address = await deployContract("Counter", [], {}, hre, provider);

        // Only a single verification attempt is mocked. If the code retried with
        // the full input it would issue a second verifysourcecode request with no
        // interceptor, which disableNetConnect() rejects, and the dispatcher's
        // afterEach pending-interceptor check would also fail.
        mockEtherscanVerificationFlow(testDispatcher.interceptable, [
          "Fail - Unable to verify. Please check if the correct constructor argument was entered.",
        ]);

        await assertRejectsWithHardhatError(
          verifyContract(
            { address },
            hre,
            () => {},
            testDispatcher.dispatcher,
            provider,
          ),
          HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL
            .CONTRACT_VERIFICATION_FAILED,
          {
            reason:
              "Fail - Unable to verify. Please check if the correct constructor argument was entered.",
            librariesWarning: "",
          },
        );
      });

      it("should retry with the full input when the minimal attempt fails with a bytecode mismatch", async () => {
        const { provider } = await hre.network.create();
        const address = await deployContract("Counter", [], {}, hre, provider);

        // Two attempts: the minimal input fails with a bytecode mismatch (which
        // the retry can fix by resubmitting with the artifact's settings), then
        // the full input succeeds.
        mockEtherscanVerificationFlow(testDispatcher.interceptable, [
          "Fail - Unable to verify. Compiled contract deployment bytecode does NOT match the transaction deployment bytecode.",
          "Pass - Verified",
        ]);

        const result = await verifyContract(
          { address },
          hre,
          () => {},
          testDispatcher.dispatcher,
          provider,
        );

        assert.ok(result, "Verification should return true after the retry");
      });
    });

    // TODO: Include remaining `hardhat-verify` verification test cases
    describe.todo("all cases", () => {
      it("should throw an error when etherscan is not enabled in the hardhat config", async () => {});

      it("should throw an error when the selected build profile does not exist", async () => {});

      it("should throw an error when etherscan is not configured for the current network", async () => {});

      it("should throw an error when the verification status endpoint returns a 3xx response and the force flag is not set", async () => {});

      it("should return true when the contract is already verified and the force flag is not set", async () => {});

      it("should log a message when the contract is already verified and the force flag is not set", async () => {});

      it("should throw an error when the deployed contract solc version does not match the configured solc version", async () => {});

      it("should log a message when the contract is sent for verification (with the minimal compiler input)", async () => {});

      it("should return true when the contract is verified successfully (with the minimal compiler input)", async () => {});

      it("should log a message when the contract is verified successfully (with the minimal compiler input)", async () => {});

      it("should log a message when the verification fails (with the minimal compiler input)", async () => {});

      it("should log a message when the contract is sent for verification (with the full compiler input)", async () => {});

      it("should return true when the contract is verified successfully (with the full compiler input)", async () => {});

      it("should throw an error when the contract verification fails (with the full compiler input)", async () => {});
    });
  });

  describe("validateArgs", () => {
    const validAddress = "0xabc1234567890abcdef1234567890abcdef12345";
    const invalidAddress = "not-an-address";
    const validFqn = "contracts/Token.sol:Token";
    const invalidFqn = "Token";

    it("should not throw for a valid address and no contract", () => {
      validateArgs({ address: validAddress, contract: undefined });
    });

    it("should not throw for a valid address and valid fqn", () => {
      validateArgs({ address: validAddress, contract: validFqn });
    });

    it("should throw an error for an invalid address", () => {
      assertThrowsHardhatError(
        () =>
          validateArgs({
            address: invalidAddress,
            contract: undefined,
          }),
        HardhatError.ERRORS.HARDHAT_VERIFY.VALIDATION.INVALID_ADDRESS,
        { value: invalidAddress },
      );
    });

    it("should throw an error for an invalid contract name", () => {
      assertThrowsHardhatError(
        () =>
          validateArgs({
            address: validAddress,
            contract: invalidFqn,
          }),
        HardhatError.ERRORS.CORE.GENERAL.INVALID_FULLY_QUALIFIED_NAME,
        { name: invalidFqn },
      );
    });
  });

  describe("VERIFICATION_PROVIDER_NAMES", () => {
    it("should list the three providers in the order the verify task runs them", () => {
      assert.deepEqual(VERIFICATION_PROVIDER_NAMES, [
        "etherscan",
        "blockscout",
        "sourcify",
      ]);
    });
  });

  describe("validateVerificationProviderName", () => {
    it("should accept valid provider names", () => {
      validateVerificationProviderName("etherscan");
      validateVerificationProviderName("blockscout");
      validateVerificationProviderName("sourcify");
    });

    it("should throw error for invalid provider names", () => {
      assertThrowsHardhatError(
        () => {
          validateVerificationProviderName("invalid");
        },
        HardhatError.ERRORS.HARDHAT_VERIFY.VALIDATION
          .INVALID_VERIFICATION_PROVIDER,
        {
          verificationProvider: "invalid",
          supportedVerificationProviders:
            VERIFICATION_PROVIDER_NAMES.join(", "),
        },
      );

      assertThrowsHardhatError(
        () => {
          validateVerificationProviderName("ethscan");
        },
        HardhatError.ERRORS.HARDHAT_VERIFY.VALIDATION
          .INVALID_VERIFICATION_PROVIDER,
        {
          verificationProvider: "ethscan",
          supportedVerificationProviders:
            VERIFICATION_PROVIDER_NAMES.join(", "),
        },
      );
    });
  });
});

// explorer-verify sends every Etherscan request as a form POST to
// `/v2/api?chainid=<id>`, with the action in the body. The interceptors below
// match on that action.
const ETHERSCAN_PATH = /^\/v2\/api\?chainid=\d+$/;

function hasAction(action: string): (body: string | undefined) => boolean {
  return (body) =>
    typeof body === "string" &&
    new URLSearchParams(body).get("action") === action;
}

/**
 * Mocks a successful Etherscan verification flow.
 *
 * @returns An accessor for the body sent to `verifysourcecode`, so that tests
 * can assert on the payload and not just on the outcome.
 */
function mockEtherscanRequests(interceptable: Interceptable): {
  readonly verifyRequestBody: URLSearchParams | undefined;
} {
  let verifyRequestBody: URLSearchParams | undefined;

  interceptable
    .intercept({
      path: ETHERSCAN_PATH,
      method: "POST",
      body: hasAction("getsourcecode"),
    })
    .reply(200, { status: "1", message: "OK", result: [{ SourceCode: "" }] });

  interceptable
    .intercept({
      path: ETHERSCAN_PATH,
      method: "POST",
      body: (body: string | undefined) => {
        if (!hasAction("verifysourcecode")(body)) {
          return false;
        }
        verifyRequestBody = new URLSearchParams(body);
        return true;
      },
    })
    .reply(200, {
      status: "1",
      message: "OK",
      result: "1234",
    });

  interceptable
    .intercept({
      path: ETHERSCAN_PATH,
      method: "POST",
      body: hasAction("checkverifystatus"),
    })
    .reply(200, {
      status: "1",
      message: "OK",
      result: "Pass - Verified",
    });

  return {
    get verifyRequestBody() {
      return verifyRequestBody;
    },
  };
}

// Mocks a full Etherscan verification flow. For each entry in `statusResults`
// (one per verification attempt): the lookup that explorer-verify sends first
// (reported as not verified), one verifysourcecode + checkverifystatus pair,
// and, after a failure, the lookup that confirms it.
function mockEtherscanVerificationFlow(
  interceptable: Interceptable,
  statusResults: string[],
) {
  for (const result of statusResults) {
    interceptable
      .intercept({
        path: ETHERSCAN_PATH,
        method: "POST",
        body: hasAction("getsourcecode"),
      })
      .reply(200, {
        status: "1",
        message: "OK",
        result: [{ SourceCode: "" }],
      });

    interceptable
      .intercept({
        path: ETHERSCAN_PATH,
        method: "POST",
        body: hasAction("verifysourcecode"),
      })
      .reply(200, { status: "1", message: "OK", result: "1234" });

    const passed = result.startsWith("Pass");
    interceptable
      .intercept({
        path: ETHERSCAN_PATH,
        method: "POST",
        body: hasAction("checkverifystatus"),
      })
      .reply(200, {
        status: passed ? "1" : "0",
        message: passed ? "OK" : "NOTOK",
        result,
      });

    if (!passed) {
      // explorer-verify checks a "Fail - Unable to verify" status with one
      // more lookup before it reports the failure.
      interceptable
        .intercept({
          path: ETHERSCAN_PATH,
          method: "POST",
          body: hasAction("getsourcecode"),
        })
        .reply(200, {
          status: "1",
          message: "OK",
          result: [{ SourceCode: "" }],
        });
    }
  }
}
