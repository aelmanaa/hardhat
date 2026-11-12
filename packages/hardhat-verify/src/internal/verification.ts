import type { ContractInformation } from "./contract.js";
import type { ResolvedExplorer } from "./explorers.js";
import type { LibraryAddresses, SourceLibraries } from "./libraries.js";
import type { Dispatcher } from "@nomicfoundation/hardhat-utils/request";
import type {
  Hex,
  Logger,
  VerifyEvent,
  VerifyInput,
  VerifyOptions,
  VerifyResult,
} from "explorer-verify";
import type { VerificationProvidersConfig } from "hardhat/types/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import type { EthereumProvider } from "hardhat/types/providers";
import type { CompilerInput } from "hardhat/types/solidity";

import { HardhatError } from "@nomicfoundation/hardhat-errors";
import { ensureError } from "@nomicfoundation/hardhat-utils/error";
import { isAddress } from "@nomicfoundation/hardhat-utils/eth";
import { verify } from "explorer-verify";
import { isFullyQualifiedName } from "hardhat/utils/contract-names";

import { getCompilerInput } from "./artifacts.js";
import { Bytecode } from "./bytecode.js";
import { rejectLocalNetworks, getChainId } from "./chains.js";
import { encodeConstructorArgs } from "./constructor-args.js";
import { ContractInformationResolver } from "./contract.js";
import { toHardhatError } from "./explorer-errors.js";
import {
  ETHERSCAN_PROVIDER_NAME,
  VERIFICATION_PROVIDER_NAMES,
  resolveExplorer,
} from "./explorers.js";
import { createHardhatFetch } from "./hardhat-fetch.js";
import { resolveLibraryInformation } from "./libraries.js";
import { formatInferredSolcVersion } from "./metadata.js";
import {
  filterVersionsByInferred,
  resolveSupportedSolcVersions,
} from "./solc-versions.js";

export interface VerifyContractArgs {
  address: string;
  constructorArgs?: unknown[];
  libraries?: LibraryAddresses;
  /** The fully qualified name of the contract, in the format: `<source-name>:<contract-name>` */
  contract?: string;
  force?: boolean;
  provider?: keyof VerificationProvidersConfig;
  /** The hash of the contract creation transaction (Sourcify only) */
  creationTxHash?: string;
  /**
   * How long to wait for the explorer's result, in seconds. When it runs out,
   * the error carries a handle that `hardhat verify resume` accepts. Unset:
   * no limit, as before.
   */
  verificationTimeout?: number;
  /**
   * How long to resubmit while the explorer has not indexed the contract yet,
   * in seconds. Unset: explorer-verify's default of up to 10 submits.
   */
  indexWait?: number;
}

/**
 * Verifies a deployed smart contract on the specified block explorer (e.g.,
 * Etherscan).
 *
 * This function performs all required checks and attempts verification using
 * minimal and full compiler input, handling constructor arguments and linked
 * libraries as needed. On success, returns `true`. On failure, throws a
 * HardhatError.
 *
 * The requests to the explorer are sent by explorer-verify.
 *
 * @param {VerifyContractArgs} verifyContractArgs - Arguments for contract
 * verification, including address, constructor arguments, libraries, contract
 * FQN, and force flag.
 * @param {HardhatRuntimeEnvironment} hre - The Hardhat Runtime Environment.
 * @returns {Promise<boolean>} Resolves to `true` if the contract was
 * successfully verified, or was already verified.
 * @throws {HardhatError} On failure, throws a HardhatError.
 *
 * @example
 * import { verifyContract } from "hardhat-verify/verify";
 *
 * await verifyContract(
 *   {
 *     address: "0x...",
 *     constructorArgs: [/* ... *\/],
 *     libraries: { MyLibrary: "0x..." },
 *     contract: "contracts/MyContract.sol:MyContract",
 *   },
 *   hre
 * );
 */
export async function verifyContract(
  verifyContractArgs: VerifyContractArgs,
  hre: HardhatRuntimeEnvironment,
  consoleLog: (text: string) => void = console.log,
  dispatcher?: Dispatcher,
  provider?: EthereumProvider,
): Promise<boolean> {
  const {
    artifacts,
    config,
    globalOptions: { buildProfile: buildProfileName = "production" },
    network,
    solidity,
  } = hre;
  const { provider: verificationProviderName = ETHERSCAN_PROVIDER_NAME } =
    verifyContractArgs;
  validateVerificationProviderName(verificationProviderName);

  validateArgs(verifyContractArgs);

  const {
    address,
    constructorArgs = [],
    libraries = {},
    contract,
    creationTxHash,
  } = verifyContractArgs;

  const buildProfile = config.solidity.profiles[buildProfileName];
  // The "production" build profile is always present by default.
  // This check only fails if the user specifies a non-existent build profile name.
  if (buildProfile === undefined) {
    throw new HardhatError(
      HardhatError.ERRORS.CORE.SOLIDITY.BUILD_PROFILE_NOT_FOUND,
      {
        buildProfileName,
      },
    );
  }

  const connection = await network.create();
  const { networkName } = connection;
  const resolvedProvider = provider ?? connection.provider;

  const chainId = await getChainId(resolvedProvider);
  rejectLocalNetworks(networkName, chainId);

  const explorer = await resolveExplorer({
    provider: verificationProviderName,
    chainId,
    networkName,
    chainDescriptors: config.chainDescriptors,
    verificationProvidersConfig: config.verify,
  });

  const supportedSolcVersions = resolveSupportedSolcVersions(buildProfile);

  const deployedBytecode = await Bytecode.getDeployedContractBytecode(
    resolvedProvider,
    address,
    networkName,
  );

  const compatibleSolcVersions = filterVersionsByInferred(
    supportedSolcVersions,
    deployedBytecode.solcVersion,
  );
  if (compatibleSolcVersions.length === 0) {
    const configuredSolcVersionSummary =
      supportedSolcVersions.length > 1
        ? `versions are: ${supportedSolcVersions.join(", ")}`
        : `version is: ${supportedSolcVersions[0]}`;

    throw new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.SOLC_VERSION_MISMATCH,
      {
        configuredSolcVersionSummary,
        deployedSolcVersion: formatInferredSolcVersion(
          deployedBytecode.solcVersion,
        ),
        networkName,
      },
    );
  }

  const contractInformationResolver = new ContractInformationResolver(
    artifacts,
    compatibleSolcVersions,
    networkName,
  );
  const contractInformation = await contractInformationResolver.resolve(
    contract,
    deployedBytecode,
  );

  const libraryInformation = resolveLibraryInformation(
    contractInformation,
    libraries,
  );

  const encodedConstructorArgs = await encodeConstructorArgs(
    contractInformation.compilerOutputContract.abi,
    constructorArgs,
    contractInformation.userFqn,
  );

  const minimalCompilerInput = await getCompilerInput(
    solidity,
    config.paths.root,
    contractInformation.sourceName,
    contractInformation.inputFqn.startsWith("npm/"),
    buildProfileName,
  );

  const attempt = createAttempt({
    explorer,
    chainId,
    address: toHex(address),
    contractInformation,
    encodedConstructorArgs,
    creationTxHash,
    libraries: libraryInformation.libraries,
    verifyContractArgs,
    consoleLog,
    dispatcher,
  });

  // The minimal compiler input comes first. explorer-verify looks the
  // contract up before it submits, so a contract whose source the explorer
  // already holds ends here, with nothing submitted.
  const minimalResult = await attempt(minimalCompilerInput);
  if (minimalResult.status !== "failed") {
    printResult(
      minimalResult,
      explorer,
      address,
      contractInformation,
      consoleLog,
    );
    return true;
  }

  let failureReason = minimalResult.reason;

  if (isRetryable(minimalResult)) {
    consoleLog(`
The initial verification attempt for ${contractInformation.userFqn} failed using the minimal compiler input.

Trying again with the full solc input used to compile and deploy the contract.
Unrelated contracts may be displayed on ${explorer.name} as a result.
`);

    // If verifying with the minimal input failed, try again with the full compiler input
    const fullResult = await attempt(contractInformation.compilerInput);
    if (fullResult.status !== "failed") {
      printResult(
        fullResult,
        explorer,
        address,
        contractInformation,
        consoleLog,
      );
      return true;
    }

    failureReason = fullResult.reason;
  }

  const librariesWarning =
    libraryInformation.undetectableLibraries.length > 0
      ? `
This contract makes use of libraries whose addresses are undetectable by the plugin.
Keep in mind that this verification failure may be due to passing in the wrong
address for one of these libraries:
${libraryInformation.undetectableLibraries.map((x) => `  * ${x}`).join("\n")}`
      : "";

  throw new HardhatError(
    HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.CONTRACT_VERIFICATION_FAILED,
    {
      reason: failureReason,
      librariesWarning,
    },
  );
}

export function validateVerificationProviderName(provider: unknown): void {
  if (!VERIFICATION_PROVIDER_NAMES.some((name) => name === provider)) {
    throw new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.VALIDATION
        .INVALID_VERIFICATION_PROVIDER,
      {
        verificationProvider: String(provider),
        supportedVerificationProviders: VERIFICATION_PROVIDER_NAMES.join(", "),
      },
    );
  }
}

export function validateArgs({ address, contract }: VerifyContractArgs): void {
  if (!isAddress(address)) {
    throw new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.VALIDATION.INVALID_ADDRESS,
      {
        value: address,
      },
    );
  }

  // TODO: we could use a more sophisticated validation here, like
  // in #getFullyQualifiedName within the artifacts manager.
  // This would allow us to skip the validation in the
  // resolveContractInformation function.
  if (contract !== undefined && !isFullyQualifiedName(contract)) {
    throw new HardhatError(
      HardhatError.ERRORS.CORE.GENERAL.INVALID_FULLY_QUALIFIED_NAME,
      {
        name: contract,
      },
    );
  }
}

/**
 * The explorer-verify options shared by `verify()` and `checkStatus()`: the
 * route, the keys, Hardhat's `fetch`, the time limit, and the log lines a user
 * should see.
 */
export function createExplorerVerifyOptions({
  explorer,
  consoleLog,
  dispatcher,
  verificationTimeout,
  onEvent,
}: {
  explorer: ResolvedExplorer;
  consoleLog: (text: string) => void;
  dispatcher?: Dispatcher;
  verificationTimeout?: number;
  onEvent?: (event: VerifyEvent) => void;
}): VerifyOptions {
  return {
    route: explorer.route,
    apiKeys: explorer.apiKeys,
    fetch: createHardhatFetch(dispatcher),
    // Hardhat polled with no overall limit; --verification-timeout sets one.
    timeoutMs:
      verificationTimeout !== undefined && verificationTimeout > 0
        ? verificationTimeout * 1000
        : Infinity,
    // Tests inject a dispatcher and poll at the shortest interval
    // explorer-verify allows, as Hardhat's own clients did.
    pollIntervalMs: dispatcher !== undefined ? 1000 : undefined,
    logger: createConsoleLogger(explorer, consoleLog),
    onEvent,
  };
}

function createAttempt({
  explorer,
  chainId,
  address,
  contractInformation,
  encodedConstructorArgs,
  creationTxHash,
  libraries,
  verifyContractArgs,
  consoleLog,
  dispatcher,
}: {
  explorer: ResolvedExplorer;
  chainId: number;
  address: Hex;
  contractInformation: ContractInformation;
  encodedConstructorArgs: string;
  creationTxHash?: string;
  libraries: SourceLibraries;
  verifyContractArgs: VerifyContractArgs;
  consoleLog: (text: string) => void;
  dispatcher?: Dispatcher;
}): (compilerInput: CompilerInput) => Promise<VerifyResult> {
  const { force = false, verificationTimeout, indexWait } = verifyContractArgs;

  return async (compilerInput) => {
    const input: VerifyInput = {
      chainId,
      address,
      contractName: contractInformation.inputFqn,
      compiler: {
        kind: "solc",
        version: contractInformation.solcLongVersion,
        input: {
          language: "Solidity",
          sources: compilerInput.sources,
          // Hardhat links libraries after compiling. Etherscan and Blockscout
          // read the addresses from `settings.libraries`. Sourcify compiles
          // the input as it is, and gives an exact match only without them.
          settings:
            explorer.backend === "sourcify"
              ? compilerInput.settings
              : { ...compilerInput.settings, libraries },
        },
      },
      constructorArgs: toHex(`0x${encodedConstructorArgs}`),
      creationTxHash:
        creationTxHash !== undefined ? toHex(creationTxHash) : undefined,
    };

    const options: VerifyOptions = {
      ...createExplorerVerifyOptions({
        explorer,
        consoleLog,
        dispatcher,
        verificationTimeout,
        onEvent: (event) => {
          if (event.type === "verify.submitted") {
            consoleLog(`
📤 Submitted source code for verification on ${explorer.name}:

  ${contractInformation.userFqn}
  Address: ${address}

⏳ Waiting for verification result...
`);
          }
        },
      }),
      // A match of this source is never submitted again. --force submits
      // over a partial match, so the explorer can upgrade it to an exact one.
      submitOverPartial: force,
      indexWaitMs:
        indexWait !== undefined && indexWait > 0 ? indexWait * 1000 : undefined,
    };

    try {
      return await verify(input, options);
    } catch (error) {
      ensureError(error);
      const mapped = toHardhatError(error, {
        explorerName: explorer.name,
        apiUrl: explorer.apiUrl,
        address,
        contract: contractInformation.userFqn,
      });
      throw mapped;
    }
  };
}

export function printResult(
  result: Exclude<VerifyResult, { status: "failed" }>,
  explorer: ResolvedExplorer,
  address: string,
  contractInformation: Pick<ContractInformation, "userFqn"> | undefined,
  consoleLog: (text: string) => void,
): void {
  const explorerLine = `Explorer: ${explorer.getContractUrl(address, result.explorerUrl)}`;
  const matchLine = result.match === "partial" ? "\n  Match: partial" : "";

  if (result.status === "already-verified") {
    const stored =
      "storedContract" in result && result.storedContract !== undefined
        ? `
${explorer.name} holds the source of another contract at this address (${describeStored(result.storedContract)}).
It did not accept the source of ${contractInformation?.userFqn ?? "this contract"}.
`
        : "";
    consoleLog(`
The contract at ${address} has already been verified on ${explorer.name}.
${stored}
If you need to verify a partially verified contract, please use the --force flag.

${explorerLine}${matchLine}`);
    return;
  }

  consoleLog(`
✅ Contract verified successfully on ${explorer.name}!

  ${contractInformation?.userFqn ?? address}
  ${explorerLine}${matchLine}`);
}

function describeStored({
  name,
  compilerVersion,
}: {
  name?: string;
  compilerVersion?: string;
}): string {
  return [name, compilerVersion]
    .filter((part) => part !== undefined)
    .join(", ");
}

/**
 * Hardhat retries with the full compiler input unless the failure cannot be
 * fixed by other sources or settings. explorer-verify gives the explorer's
 * message as text, so the check reads it, as Hardhat's Etherscan client did.
 * Blockscout and Sourcify failures are always retried.
 */
function isRetryable(
  result: Extract<VerifyResult, { status: "failed" }>,
): boolean {
  if (result.backend !== "etherscan-v2") {
    return true;
  }

  return !result.reason.toLowerCase().includes("correct constructor argument");
}

/**
 * The explorer-verify log lines a user should see: a match of another
 * contract's source, and what happens to a partial match. Every other line is
 * left out, as Hardhat printed nothing for those steps before.
 */
function createConsoleLogger(
  explorer: ResolvedExplorer,
  consoleLog: (text: string) => void,
): Logger {
  const print = (message: string) => {
    if (
      message.includes("another contract's source") ||
      message.includes("partial match") ||
      message.includes("up to an hour old")
    ) {
      // explorer-verify names the backend, e.g. "etherscan-v2"; Hardhat's
      // messages name the explorer.
      const text = message.startsWith(explorer.backend)
        ? `${explorer.name}${message.slice(explorer.backend.length)}`
        : message;
      consoleLog(`\nℹ️  ${text}`);
    }
  };

  return {
    debug: () => {},
    info: print,
    warn: print,
    error: () => {},
  };
}

function toHex(value: string): Hex {
  if (!isHexPrefixed(value)) {
    throw new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.VALIDATION.INVALID_ADDRESS,
      { value },
    );
  }
  return value;
}

function isHexPrefixed(value: string): value is Hex {
  return value.startsWith("0x");
}
