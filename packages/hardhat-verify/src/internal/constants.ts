import type { VerificationProvidersConfig } from "hardhat/types/config";

export type VerificationProviderName = keyof VerificationProvidersConfig;

export const VERIFICATION_PROVIDER_NAMES: readonly VerificationProviderName[] =
  ["etherscan", "blockscout", "sourcify"];

export const ETHERSCAN_PROVIDER_NAME: VerificationProviderName = "etherscan";
export const BLOCKSCOUT_PROVIDER_NAME: VerificationProviderName = "blockscout";
export const SOURCIFY_PROVIDER_NAME: VerificationProviderName = "sourcify";

export const ETHERSCAN_API_URL = "https://api.etherscan.io/v2/api";
export const SOURCIFY_API_URL = "https://sourcify.dev/server";
