import path from "node:path";

import { HardhatError } from "@nomicfoundation/hardhat-errors";
import { exists, isDirectory } from "@nomicfoundation/hardhat-utils/fs";

export interface NodeStateArguments {
  state?: string;
  loadState?: string;
  dumpState?: string;
}

export interface NodeStateParams {
  /** The file to load the state from when the node starts, if any. */
  loadPath?: string;
  /** The file to save the state to when the node stops, if any. */
  dumpPath?: string;
}

const STATE_FILE_NAME = "state.json";

/**
 * Resolves the `--state`, `--load-state` and `--dump-state` options of the
 * node task into the files to load from and save to.
 *
 * `--state` loads the file if it exists and always saves to it. A path to an
 * existing directory means the `state.json` file in it.
 */
export async function resolveNodeStateParams(
  args: NodeStateArguments,
  cwd: string,
): Promise<NodeStateParams> {
  if (args.state !== undefined) {
    if (args.loadState !== undefined) {
      throw new HardhatError(
        HardhatError.ERRORS.CORE.ARGUMENTS.MUTUALLY_EXCLUSIVE_OPTIONS,
        { optionA: "state", optionB: "load-state" },
      );
    }

    if (args.dumpState !== undefined) {
      throw new HardhatError(
        HardhatError.ERRORS.CORE.ARGUMENTS.MUTUALLY_EXCLUSIVE_OPTIONS,
        { optionA: "state", optionB: "dump-state" },
      );
    }

    const statePath = await resolveStatePath(args.state, cwd);

    return {
      loadPath: (await exists(statePath)) ? statePath : undefined,
      dumpPath: statePath,
    };
  }

  let loadPath: string | undefined;
  if (args.loadState !== undefined) {
    loadPath = await resolveStatePath(args.loadState, cwd);

    if (!(await exists(loadPath))) {
      throw new HardhatError(
        HardhatError.ERRORS.CORE.NODE.LOAD_STATE_FILE_NOT_FOUND,
        { path: loadPath },
      );
    }
  }

  const dumpPath =
    args.dumpState !== undefined
      ? await resolveStatePath(args.dumpState, cwd)
      : undefined;

  return { loadPath, dumpPath };
}

async function resolveStatePath(value: string, cwd: string): Promise<string> {
  const resolved = path.resolve(cwd, value);

  if ((await exists(resolved)) && (await isDirectory(resolved))) {
    return path.join(resolved, STATE_FILE_NAME);
  }

  return resolved;
}
