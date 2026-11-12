import type { NewTaskDefinition } from "hardhat/types/tasks";

import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";

const verifyResumeTask: NewTaskDefinition = task(
  ["verify", "resume"],
  "Check the result of a verification that was submitted but not confirmed",
)
  .addPositionalArgument({
    name: "handle",
    description:
      "The resume handle printed when a verification was not confirmed",
  })
  .addOption({
    name: "verificationTimeout",
    type: ArgumentType.INT,
    description:
      "How long to wait for the explorer's result, in seconds (0: no limit)",
    defaultValue: 0,
  })
  .setAction(() => import("./task-action.js"))
  .build();

export default verifyResumeTask;
