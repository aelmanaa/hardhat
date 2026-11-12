import type { VerificationProviderName } from "./constants.js";
import type { ApiKeys, BackendName, RouteOverride } from "explorer-verify";
import type {
  ChainDescriptorsConfig,
  VerificationProvidersConfig,
} from "hardhat/types/config";

import { HardhatError } from "@nomicfoundation/hardhat-errors";
import { toBigInt } from "@nomicfoundation/hardhat-utils/bigint";
import { routesFor } from "explorer-verify";

import { ETHERSCAN_API_URL, SOURCIFY_API_URL } from "./constants.js";
export {
  BLOCKSCOUT_PROVIDER_NAME,
  ETHERSCAN_API_URL,
  ETHERSCAN_PROVIDER_NAME,
  SOURCIFY_API_URL,
  SOURCIFY_PROVIDER_NAME,
  VERIFICATION_PROVIDER_NAMES,
} from "./constants.js";
export type { VerificationProviderName } from "./constants.js";

/**
 * Where one verification provider sends its requests, as explorer-verify
 * options, and how Hardhat names it and links to the verified contract.
 */
export interface ResolvedExplorer {
  /** The explorer name printed in the console messages, e.g. "Etherscan". */
  name: string;
  /** The API URL printed in error messages. */
  apiUrl: string;
  /** The explorer-verify backend. */
  backend: BackendName;
  /** The explorer-verify route for this explorer. */
  route: RouteOverride;
  /** The keys for a backend routed by the explorer-verify routing table. */
  apiKeys?: ApiKeys;
  /**
   * The contract's page on the explorer. `explorerUrl` is the page that
   * explorer-verify returned, used when Hardhat has no explorer URL itself.
   */
  getContractUrl(address: string, explorerUrl?: string): string;
}

/**
 * Resolves a verification provider for a chain. The chain descriptors in the
 * Hardhat config come first. A chain without a descriptor for the provider
 * falls back to the routing table that ships with explorer-verify.
 */
export async function resolveExplorer({
  provider,
  chainId,
  networkName,
  chainDescriptors,
  verificationProvidersConfig,
}: {
  provider: VerificationProviderName;
  chainId: number;
  networkName: string;
  chainDescriptors: ChainDescriptorsConfig;
  verificationProvidersConfig: VerificationProvidersConfig;
}): Promise<ResolvedExplorer> {
  if (provider === "sourcify") {
    const apiUrl = stripTrailingSlash(
      verificationProvidersConfig.sourcify.apiUrl ?? SOURCIFY_API_URL,
    );
    return {
      name: "Sourcify",
      apiUrl,
      backend: "sourcify",
      // Sourcify verifies any chain, so the route always names its API.
      route: { backend: "sourcify", apiUrl },
      getContractUrl: (address) =>
        `${apiUrl}/repo-ui/${String(chainId)}/${address}`,
    };
  }

  const chainDescriptor = chainDescriptors.get(toBigInt(chainId));

  if (provider === "etherscan") {
    const apiKey = await verificationProvidersConfig.etherscan.apiKey.get();
    const etherscanName =
      chainDescriptor?.blockExplorers.etherscan?.name ?? "Etherscan";
    if (apiKey === "") {
      throw new HardhatError(
        HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.EXPLORER_API_KEY_EMPTY,
        { verificationProvider: etherscanName },
      );
    }

    const etherscanExplorer = chainDescriptor?.blockExplorers.etherscan;
    if (etherscanExplorer !== undefined) {
      const apiUrl = etherscanExplorer.apiUrl ?? ETHERSCAN_API_URL;
      return {
        name: etherscanName,
        apiUrl,
        backend: "etherscan-v2",
        // etherscan-v2 adds the chainid parameter to any API URL, as Hardhat
        // did before.
        route: { backend: "etherscan-v2", apiUrl, apiKey },
        getContractUrl: (address) =>
          `${etherscanExplorer.url}/address/${address}#code`,
      };
    }

    await assertListed("etherscan-v2", "Etherscan", {
      chainId,
      networkName,
      hasDescriptor: chainDescriptor !== undefined,
    });
    return {
      name: etherscanName,
      apiUrl: ETHERSCAN_API_URL,
      backend: "etherscan-v2",
      route: { backend: "etherscan-v2" },
      apiKeys: { "etherscan-v2": apiKey },
      getContractUrl: (address, explorerUrl) => explorerUrl ?? address,
    };
  }

  const blockscoutApiKey =
    await verificationProvidersConfig.blockscout.apiKey?.get();
  const name = chainDescriptor?.blockExplorers.blockscout?.name ?? "Blockscout";
  // The API key is optional, as most Blockscout instances don't require one,
  // but an explicitly configured empty key is always a misconfiguration.
  if (blockscoutApiKey === "") {
    throw new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.EXPLORER_API_KEY_EMPTY,
      { verificationProvider: name },
    );
  }

  const explorer = chainDescriptor?.blockExplorers.blockscout;
  if (explorer !== undefined) {
    const apiUrl = stripTrailingSlash(explorer.apiUrl);
    return {
      name,
      apiUrl: explorer.apiUrl,
      backend: "blockscout",
      route: { backend: "blockscout", apiUrl, apiKey: blockscoutApiKey },
      getContractUrl: (address) => `${explorer.url}/address/${address}#code`,
    };
  }

  await assertListed("blockscout", "Blockscout", {
    chainId,
    networkName,
    hasDescriptor: chainDescriptor !== undefined,
  });
  return {
    name,
    apiUrl: "",
    backend: "blockscout",
    route: { backend: "blockscout" },
    getContractUrl: (address, explorerUrl) => explorerUrl ?? address,
  };
}

async function assertListed(
  backend: BackendName,
  verificationProvider: string,
  {
    chainId,
    networkName,
    hasDescriptor,
  }: { chainId: number; networkName: string; hasDescriptor: boolean },
): Promise<void> {
  const { listed } = await routesFor(chainId);
  if (listed.includes(backend)) {
    return;
  }

  if (!hasDescriptor) {
    throw new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.NETWORK_NOT_SUPPORTED,
      { networkName, chainId },
    );
  }

  throw new HardhatError(
    HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.BLOCK_EXPLORER_NOT_CONFIGURED,
    { verificationProvider, chainId },
  );
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
