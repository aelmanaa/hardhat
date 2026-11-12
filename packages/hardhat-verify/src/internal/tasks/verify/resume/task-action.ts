import type { VerificationProviderName } from "../../../explorers.js";
import type { BackendName } from "explorer-verify";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import type { NewTaskActionFunction } from "hardhat/types/tasks";

import { HardhatError } from "@nomicfoundation/hardhat-errors";
import { ensureError } from "@nomicfoundation/hardhat-utils/error";
import { checkStatus, ExplorerVerifyError, parseHandle } from "explorer-verify";

import { toHardhatError } from "../../../explorer-errors.js";
import { resolveExplorer } from "../../../explorers.js";
import {
  createExplorerVerifyOptions,
  printResult,
} from "../../../verification.js";

interface VerifyResumeActionArgs {
  handle: string;
  verificationTimeout: number;
}

const PROVIDER_BY_BACKEND: Partial<
  Record<BackendName, VerificationProviderName>
> = {
  "etherscan-v2": "etherscan",
  blockscout: "blockscout",
  sourcify: "sourcify",
};

const verifyResumeAction: NewTaskActionFunction<
  VerifyResumeActionArgs
> = async (args, hre) => {
  await resumeVerification(args, hre);
};

/**
 * Polls a verification job that explorer-verify submitted, without
 * submitting the source code again, and prints the result as `verify` does.
 */
export async function resumeVerification(
  { handle, verificationTimeout }: VerifyResumeActionArgs,
  hre: HardhatRuntimeEnvironment,
  consoleLog: (text: string) => void = console.log,
  dispatcher?: Parameters<typeof createExplorerVerifyOptions>[0]["dispatcher"],
): Promise<boolean> {
  let parsed;
  try {
    parsed = parseHandle(handle);
  } catch (error) {
    ensureError(error);
    throw new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL
        .CONTRACT_VERIFICATION_REQUEST_FAILED,
      {
        message: ExplorerVerifyError.is(error)
          ? error.message
          : `"${handle}" is not a resume handle`,
      },
      error,
    );
  }

  const provider = PROVIDER_BY_BACKEND[parsed.backend];
  if (provider === undefined) {
    throw new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.VALIDATION
        .INVALID_VERIFICATION_PROVIDER,
      {
        verificationProvider: parsed.backend,
        supportedVerificationProviders:
          Object.keys(PROVIDER_BY_BACKEND).join(", "),
      },
    );
  }

  const explorer = await resolveExplorer({
    provider,
    chainId: parsed.chainId,
    networkName: hre.globalOptions.network ?? String(parsed.chainId),
    chainDescriptors: hre.config.chainDescriptors,
    verificationProvidersConfig: hre.config.verify,
  });

  consoleLog(`
⏳ Checking the verification of ${parsed.address} on ${explorer.name}...`);

  let result;
  try {
    result = await checkStatus(
      parsed,
      createExplorerVerifyOptions({
        explorer,
        consoleLog,
        dispatcher,
        verificationTimeout,
      }),
    );
  } catch (error) {
    ensureError(error);
    const mapped = toHardhatError(error, {
      explorerName: explorer.name,
      apiUrl: explorer.apiUrl,
      address: parsed.address,
      contract: parsed.address,
    });
    throw mapped;
  }

  if (result.status === "failed") {
    throw new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.CONTRACT_VERIFICATION_FAILED,
      { reason: result.reason, librariesWarning: "" },
    );
  }

  printResult(result, explorer, parsed.address, undefined, consoleLog);
  return true;
}

export default verifyResumeAction;
