import type { ErrorCode } from "explorer-verify";

import { HardhatError } from "@nomicfoundation/hardhat-errors";
import { ExplorerVerifyError, formatHandle } from "explorer-verify";

type HardhatErrorKind =
  | "request-failed"
  | "status-code"
  | "missing-bytecode"
  | "not-confirmed"
  | "polling-failed"
  | "verification-request-failed";

/**
 * The HHE error each explorer-verify code becomes. The type lists every code,
 * so a release of explorer-verify that adds one fails to compile here.
 */
const KIND_BY_CODE: Readonly<Record<ErrorCode, HardhatErrorKind>> = {
  network: "request-failed",
  timeout: "request-failed",
  "unexpected-response": "status-code",
  "not-indexed": "missing-bytecode",
  "not-confirmed": "not-confirmed",
  "job-not-found": "polling-failed",
  "unknown-state": "polling-failed",
  "verification-inconclusive": "polling-failed",
  "in-progress": "polling-failed",
  "rate-limited": "verification-request-failed",
  "missing-api-key": "verification-request-failed",
  "api-key-rejected": "verification-request-failed",
  "quota-exceeded": "verification-request-failed",
  "handler-refused": "verification-request-failed",
  "invalid-input": "verification-request-failed",
  "unsupported-chain": "verification-request-failed",
  "unsupported-compiler": "verification-request-failed",
  "constructor-args-unavailable": "verification-request-failed",
  cancelled: "verification-request-failed",
  "incomplete-input": "verification-request-failed",
  "insufficient-artifact": "verification-request-failed",
  "source-mismatch": "verification-request-failed",
  "internal-error": "verification-request-failed",
  "no-metadata-hash": "verification-request-failed",
  "metadata-unavailable": "verification-request-failed",
  "proxy-link-pending": "verification-request-failed",
  "proxy-link-unknown-state": "verification-request-failed",
};

/**
 * Maps an error thrown by explorer-verify onto the HHE error that Hardhat
 * threw for the same failure before. Any other error is returned unchanged.
 */
export function toHardhatError(
  error: Error,
  {
    explorerName,
    apiUrl,
    address,
    contract,
  }: {
    explorerName: string;
    apiUrl: string;
    address: string;
    contract: string;
  },
): Error {
  if (!ExplorerVerifyError.is(error)) {
    return error;
  }

  const { details } = error;
  const kind = KIND_BY_CODE[details.code];

  if (kind === "status-code" && details.code === "unexpected-response") {
    return new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL
        .EXPLORER_REQUEST_STATUS_CODE_ERROR,
      {
        name: explorerName,
        url: apiUrl,
        statusCode: details.status,
        errorMessage: details.excerpt,
      },
      error,
    );
  }

  if (kind === "not-confirmed" && details.code === "not-confirmed") {
    return new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.VERIFICATION_NOT_CONFIRMED,
      {
        verificationProvider: explorerName,
        contract,
        reason: error.message,
        handle: formatHandle(details.handle),
      },
      error,
    );
  }

  if (kind === "request-failed") {
    return new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL.EXPLORER_REQUEST_FAILED,
      { name: explorerName, url: apiUrl, errorMessage: error.message },
      error,
    );
  }

  if (kind === "missing-bytecode") {
    return new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL
        .CONTRACT_VERIFICATION_MISSING_BYTECODE,
      { url: apiUrl, address },
      error,
    );
  }

  if (kind === "polling-failed") {
    return new HardhatError(
      HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL
        .CONTRACT_VERIFICATION_STATUS_POLLING_FAILED,
      { message: error.message },
      error,
    );
  }

  return new HardhatError(
    HardhatError.ERRORS.HARDHAT_VERIFY.GENERAL
      .CONTRACT_VERIFICATION_REQUEST_FAILED,
    { message: error.message },
    error,
  );
}
