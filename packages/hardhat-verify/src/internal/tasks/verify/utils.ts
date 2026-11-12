import type { BaseVerifyActionArgs, VerifyActionArgs } from "./types.js";
import type { NewTaskDefinitionBuilder } from "hardhat/types/tasks";

import { ArgumentType } from "hardhat/types/arguments";

export function extendWithVerificationArgs(
  task: NewTaskDefinitionBuilder,
): NewTaskDefinitionBuilder<BaseVerifyActionArgs> {
  return task
    .addPositionalArgument({
      name: "address",
      description: "The address of the contract to verify",
    })
    .addVariadicArgument({
      name: "constructorArgs",
      description: "The constructor arguments",
      defaultValue: [],
    })
    .addOption({
      name: "constructorArgsPath",
      type: ArgumentType.FILE_WITHOUT_DEFAULT,
      description:
        "A relative path to a module that exports the constructor arguments",
      defaultValue: undefined,
    })
    .addOption({
      name: "contract",
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      description:
        "The name of the contract to verify, in the format <path>:<contractName>",
      defaultValue: undefined,
    })
    .addOption({
      name: "librariesPath",
      type: ArgumentType.FILE_WITHOUT_DEFAULT,
      description:
        "A relative path to a module that exports a mapping of library names to addresses",
      defaultValue: undefined,
    })
    .addFlag({
      name: "force",
      description:
        "Force the verification even if the contract is already verified",
    })
    .addOption({
      name: "verificationTimeout",
      type: ArgumentType.INT,
      description:
        "How long to wait for the explorer's result, in seconds (0: no limit)",
      defaultValue: 0,
    })
    .addOption({
      name: "indexWait",
      type: ArgumentType.INT,
      description:
        "How long to resubmit while the explorer has not indexed the contract, in seconds (0: the default)",
      defaultValue: 0,
    });
  /* TODO: M5
    .addFlag({
      name: "listNetworks",
      description: "List the networks that are supported by Etherscan",
    });
  */
}

export function extendWithSourcifyArgs(
  task: NewTaskDefinitionBuilder<BaseVerifyActionArgs>,
  isMainTask: boolean = true,
): NewTaskDefinitionBuilder<VerifyActionArgs> {
  return task.addOption({
    name: "creationTxHash",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    description:
      "The hash of the contract creation transaction" +
      (isMainTask ? " (Sourcify only)" : ""),
    defaultValue: undefined,
  });
}
