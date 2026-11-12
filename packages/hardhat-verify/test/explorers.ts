import type {
  ChainDescriptorsConfig,
  VerificationProvidersConfig,
} from "hardhat/types/config";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HardhatError } from "@nomicfoundation/hardhat-errors";
import {
  assertIsHardhatError,
  assertRejectsWithHardhatError,
} from "@nomicfoundation/hardhat-test-utils";
import { ExplorerVerifyError, formatHandle } from "explorer-verify";

import {
  ETHERSCAN_API_URL,
  SOURCIFY_API_URL,
} from "../src/internal/constants.js";
import { toHardhatError } from "../src/internal/explorer-errors.js";
import { resolveExplorer } from "../src/internal/explorers.js";
import { createHardhatFetch } from "../src/internal/hardhat-fetch.js";

import {
  initializeTestDispatcher,
  MockResolvedConfigurationVariable,
} from "./utils.js";

const ADDRESS = "0x1234567890123456789012345678901234567890";

// The keys to redact from an error; these tests have none.
const ERROR_OPTIONS = { secrets: [] };

function verifyConfig({
  etherscanApiKey = "etherscan-key",
  blockscoutApiKey,
  sourcifyApiUrl,
}: {
  etherscanApiKey?: string;
  blockscoutApiKey?: string;
  sourcifyApiUrl?: string;
} = {}): VerificationProvidersConfig {
  return {
    etherscan: {
      apiKey: new MockResolvedConfigurationVariable(etherscanApiKey),
      enabled: true,
    },
    blockscout: {
      apiKey:
        blockscoutApiKey !== undefined
          ? new MockResolvedConfigurationVariable(blockscoutApiKey)
          : undefined,
      enabled: true,
    },
    sourcify: { apiUrl: sourcifyApiUrl, enabled: true },
  };
}

const SEPOLIA_DESCRIPTORS: ChainDescriptorsConfig = new Map([
  [
    11_155_111n,
    {
      name: "Sepolia",
      chainType: "l1",
      blockExplorers: {
        etherscan: { url: "https://sepolia.etherscan.io" },
        blockscout: {
          name: "Sepolia Blockscout",
          url: "https://eth-sepolia.blockscout.com",
          apiUrl: "https://eth-sepolia.blockscout.com/api/",
        },
      },
    },
  ],
]);

describe("explorers", () => {
  describe("resolveExplorer", () => {
    it("should route Etherscan to the descriptor's API with the key on the route", async () => {
      const explorer = await resolveExplorer({
        provider: "etherscan",
        chainId: 11155111,
        networkName: "sepolia",
        chainDescriptors: SEPOLIA_DESCRIPTORS,
        verificationProvidersConfig: verifyConfig(),
      });

      assert.equal(explorer.name, "Etherscan");
      assert.equal(explorer.backend, "etherscan-v2");
      assert.deepEqual(explorer.route, {
        backend: "etherscan-v2",
        apiUrl: ETHERSCAN_API_URL,
        apiKey: "etherscan-key",
      });
      assert.equal(
        explorer.getContractUrl(ADDRESS),
        `https://sepolia.etherscan.io/address/${ADDRESS}#code`,
      );
    });

    it("should strip the trailing slash of a Blockscout API URL", async () => {
      const explorer = await resolveExplorer({
        provider: "blockscout",
        chainId: 11155111,
        networkName: "sepolia",
        chainDescriptors: SEPOLIA_DESCRIPTORS,
        verificationProvidersConfig: verifyConfig({ blockscoutApiKey: "bk" }),
      });

      assert.equal(explorer.name, "Sepolia Blockscout");
      assert.deepEqual(explorer.route, {
        backend: "blockscout",
        apiUrl: "https://eth-sepolia.blockscout.com/api",
        apiKey: "bk",
      });
      assert.equal(
        explorer.getContractUrl(ADDRESS),
        `https://eth-sepolia.blockscout.com/address/${ADDRESS}#code`,
      );
    });

    it("should route Sourcify to the configured API on any chain", async () => {
      const explorer = await resolveExplorer({
        provider: "sourcify",
        chainId: 123456789,
        networkName: "custom",
        chainDescriptors: new Map(),
        verificationProvidersConfig: verifyConfig({
          sourcifyApiUrl: "https://sourcify.example.com/server/",
        }),
      });

      assert.deepEqual(explorer.route, {
        backend: "sourcify",
        apiUrl: "https://sourcify.example.com/server",
      });
      assert.equal(
        explorer.getContractUrl(ADDRESS),
        `https://sourcify.example.com/server/repo-ui/123456789/${ADDRESS}`,
      );
    });

    it("should default Sourcify to the public server", async () => {
      const explorer = await resolveExplorer({
        provider: "sourcify",
        chainId: 11155111,
        networkName: "sepolia",
        chainDescriptors: SEPOLIA_DESCRIPTORS,
        verificationProvidersConfig: verifyConfig(),
      });

      assert.equal(explorer.route.apiUrl, SOURCIFY_API_URL);
    });

    it("should fall back to explorer-verify's routing table for a chain without a descriptor", async () => {
      const explorer = await resolveExplorer({
        provider: "etherscan",
        chainId: 11155111,
        networkName: "sepolia",
        chainDescriptors: new Map(),
        verificationProvidersConfig: verifyConfig(),
      });

      assert.deepEqual(explorer.route, { backend: "etherscan-v2" });
      assert.deepEqual(explorer.apiKeys, { "etherscan-v2": "etherscan-key" });
      assert.equal(
        explorer.getContractUrl(ADDRESS, "https://page.example/x"),
        "https://page.example/x",
      );
    });

    it("should throw NETWORK_NOT_SUPPORTED for a chain neither the config nor the table lists", async () => {
      await assertRejectsWithHardhatError(
        resolveExplorer({
          provider: "blockscout",
          chainId: 999_999_999,
          networkName: "custom",
          chainDescriptors: new Map(),
          verificationProvidersConfig: verifyConfig(),
        }),
        HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.NETWORK_NOT_SUPPORTED,
        { networkName: "custom", chainId: 999_999_999 },
      );
    });

    it("should throw EXPLORER_API_KEY_EMPTY for an empty Etherscan key", async () => {
      await assertRejectsWithHardhatError(
        resolveExplorer({
          provider: "etherscan",
          chainId: 11155111,
          networkName: "sepolia",
          chainDescriptors: SEPOLIA_DESCRIPTORS,
          verificationProvidersConfig: verifyConfig({ etherscanApiKey: "" }),
        }),
        HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.EXPLORER_API_KEY_EMPTY,
        { verificationProvider: "Etherscan" },
      );
    });
  });

  describe("toHardhatError", () => {
    const context = {
      explorerName: "Etherscan",
      apiUrl: ETHERSCAN_API_URL,
      address: ADDRESS,
      contract: "contracts/Counter.sol:Counter",
    };

    it("should map not-confirmed to VERIFICATION_NOT_CONFIRMED with the resume handle", () => {
      const handle = {
        version: 1,
        backend: "etherscan-v2",
        chainId: 11155111,
        address: ADDRESS,
        jobId: "abc",
      } as const;
      const error = new ExplorerVerifyError(
        { code: "not-confirmed", handle },
        "Etherscan did not confirm the job in time.",
        ERROR_OPTIONS,
      );

      const mapped = toHardhatError(error, context);

      assertIsHardhatError(
        mapped,
        HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.VERIFICATION_NOT_CONFIRMED,
        {
          verificationProvider: "Etherscan",
          contract: "contracts/Counter.sol:Counter",
          reason: "Etherscan did not confirm the job in time.",
          handle: formatHandle(handle),
        },
      );
      assert.ok(
        mapped.message.includes("npx hardhat verify resume ev1:"),
        "the output should match",
      );
    });

    it("should map not-indexed to CONTRACT_VERIFICATION_MISSING_BYTECODE", () => {
      const error = new ExplorerVerifyError(
        {
          code: "not-indexed",
          backend: "etherscan-v2",
          submits: 10,
          elapsedMs: 1,
        },
        "not indexed",
        ERROR_OPTIONS,
      );

      assertIsHardhatError(
        toHardhatError(error, context),
        HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL
          .CONTRACT_VERIFICATION_MISSING_BYTECODE,
        { url: ETHERSCAN_API_URL, address: ADDRESS },
      );
    });

    it("should map a network error to EXPLORER_REQUEST_FAILED", () => {
      const error = new ExplorerVerifyError(
        { code: "network", backend: "etherscan-v2", attempts: 5 },
        "no response",
        ERROR_OPTIONS,
      );

      assertIsHardhatError(
        toHardhatError(error, context),
        HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.EXPLORER_REQUEST_FAILED,
        {
          name: "Etherscan",
          url: ETHERSCAN_API_URL,
          errorMessage: "no response",
        },
      );
    });

    it("should map an unexpected response to EXPLORER_REQUEST_STATUS_CODE_ERROR", () => {
      const error = new ExplorerVerifyError(
        {
          code: "unexpected-response",
          backend: "etherscan-v2",
          status: 502,
          excerpt: "Bad Gateway",
        },
        "bad gateway",
        ERROR_OPTIONS,
      );

      assertIsHardhatError(
        toHardhatError(error, context),
        HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL
          .EXPLORER_REQUEST_STATUS_CODE_ERROR,
        {
          name: "Etherscan",
          url: ETHERSCAN_API_URL,
          statusCode: 502,
          errorMessage: "Bad Gateway",
        },
      );
    });

    it("should map a rejected key to CONTRACT_VERIFICATION_REQUEST_FAILED", () => {
      const error = new ExplorerVerifyError(
        { code: "api-key-rejected", backend: "etherscan-v2" },
        "Etherscan rejected the API key.",
        ERROR_OPTIONS,
      );

      assertIsHardhatError(
        toHardhatError(error, context),
        HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL
          .CONTRACT_VERIFICATION_REQUEST_FAILED,
        { message: "Etherscan rejected the API key." },
      );
    });

    it("should return any other error unchanged", () => {
      const error = new Error("other");
      assert.equal(toHardhatError(error, context), error);
    });
  });

  describe("createHardhatFetch", () => {
    const testDispatcher = initializeTestDispatcher({
      url: "https://explorer.example",
    });

    it("should send Hardhat's User-Agent through the given dispatcher", async () => {
      let userAgent: string | undefined;
      testDispatcher.interceptable
        .intercept({
          path: "/api",
          method: "GET",
          headers: (headers: Record<string, string>) => {
            userAgent = headers["user-agent"];
            return true;
          },
        })
        .reply(200, "ok");

      const response = await createHardhatFetch(testDispatcher.dispatcher)(
        "https://explorer.example/api",
      );

      assert.equal(await response.text(), "ok");
      assert.equal(userAgent, "Hardhat");
    });

    it("should keep a User-Agent the caller set", async () => {
      let userAgent: string | undefined;
      testDispatcher.interceptable
        .intercept({
          path: "/api",
          method: "GET",
          headers: (headers: Record<string, string>) => {
            userAgent = headers["user-agent"];
            return true;
          },
        })
        .reply(200, "ok");

      await createHardhatFetch(testDispatcher.dispatcher)(
        new URL("https://explorer.example/api"),
        { headers: { "User-Agent": "custom" } },
      );

      assert.equal(userAgent, "custom");
    });
  });
});
