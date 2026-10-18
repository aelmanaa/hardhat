import type { NewTaskActionFunction } from "../../../types/tasks.js";

import path from "node:path";
import { styleText } from "node:util";

import {
  assertHardhatInvariant,
  HardhatError,
} from "@nomicfoundation/hardhat-errors";
import { createDebug } from "@nomicfoundation/hardhat-utils/debug";
import { ensureError } from "@nomicfoundation/hardhat-utils/error";
import { ensureDir, exists } from "@nomicfoundation/hardhat-utils/fs";

import { BUILD_INFO_DIR_NAME } from "../artifacts/artifact-manager.js";
import { EdrProvider } from "../network-manager/edr/edr-provider.js";

import { watchBuildInfo } from "./artifacts/build-info-watcher.js";
import {
  createBuildInfoUploadHandlerFrom,
  formatEdrNetworkConfigAccounts,
} from "./helpers.js";
import { JsonRpcServerImplementation } from "./json-rpc/server.js";
import { onShutdownSignal } from "./state/shutdown-signals.js";
import {
  dumpResultToJson,
  jsonToLoadParam,
  readStateFile,
  writeStateFile,
} from "./state/state-file.js";
import { resolveNodeConnectionParams } from "./utils/resolve-node-connection-params.js";
import { resolveNodeStateParams } from "./utils/resolve-node-state-params.js";

const log = createDebug("hardhat:core:tasks:node");

interface NodeActionArguments {
  hostname?: string;
  port: number;
  chainType?: string;
  chainId: number;
  fork?: string;
  forkBlockNumber: number;
  state?: string;
  loadState?: string;
  dumpState?: string;
}

const nodeAction: NewTaskActionFunction<NodeActionArguments> = async (
  args,
  hre,
) => {
  const network =
    hre.globalOptions.network !== undefined
      ? hre.globalOptions.network
      : "node";

  if (!(network in hre.config.networks)) {
    throw new HardhatError(HardhatError.ERRORS.CORE.NETWORK.NETWORK_NOT_FOUND, {
      networkName: network,
    });
  }

  if (hre.config.networks[network].type !== "edr-simulated") {
    throw new HardhatError(HardhatError.ERRORS.CORE.NODE.INVALID_NETWORK_TYPE, {
      networkType: hre.config.networks[network].type,
      networkName: network,
    });
  }

  const connectionParams = resolveNodeConnectionParams(network, args);
  const stateParams = await resolveNodeStateParams(args, process.cwd());

  // NOTE: This is where we initialize the network; the create method returns
  // a fully resolved networkConfig object which might be useful for display
  const { networkConfig, provider } =
    await hre.network.create(connectionParams);

  assertHardhatInvariant(
    provider instanceof EdrProvider,
    "Provider must be EdrProvider, since only edr networks are supported",
  );

  if (stateParams.loadPath !== undefined) {
    try {
      const json = await readStateFile(stateParams.loadPath);
      await provider.request({
        method: "hardhat_loadState",
        params: [jsonToLoadParam(json)],
      });
    } catch (error) {
      ensureError(error);
      throw new HardhatError(
        HardhatError.ERRORS.CORE.NODE.LOAD_STATE_FAILED,
        { path: stateParams.loadPath, reason: error.message },
        error,
      );
    }

    console.log(`Loaded the state from ${stateParams.loadPath}`);
  }

  // NOTE: We enable logging for the node
  await provider.request({
    method: "hardhat_setLoggingEnabled",
    params: [true],
  });

  // the default hostname is "127.0.0.1" unless we are inside a docker
  // container, in that case we use "0.0.0.0"
  let hostname = args.hostname;
  if (hostname === undefined) {
    const insideDocker = await exists("/.dockerenv");
    if (insideDocker) {
      hostname = "0.0.0.0";
    } else {
      hostname = "127.0.0.1";
    }
  }

  const server = new JsonRpcServerImplementation({
    hostname,
    port: args.port,
    provider,
  });

  const { port: actualPort, address: actualHostname } = await server.listen();

  console.log(
    styleText(
      "green",
      `Started HTTP and WebSocket JSON-RPC server at http://${actualHostname}:${actualPort}/`,
    ),
  );

  console.log();

  const buildInfoDirPath = path.join(
    hre.config.paths.artifacts,
    BUILD_INFO_DIR_NAME,
  );
  await ensureDir(buildInfoDirPath);

  const buildInfoWatcher = await watchBuildInfo(
    buildInfoDirPath,
    createBuildInfoUploadHandlerFrom(buildInfoDirPath, provider, log),
  );

  // NOTE: Before creating the node, we check if the input network config is of type edr.
  // We only proceed if it is. Hence, we can assume that the output network config is of type edr as well.
  assertHardhatInvariant(
    networkConfig.type === "edr-simulated",
    "Network config type should be edr",
  );

  console.log(await formatEdrNetworkConfigAccounts(networkConfig.accounts));

  let dumpError: Error | undefined;
  const dumpPath = stateParams.dumpPath;
  const removeShutdownListeners =
    dumpPath === undefined
      ? () => {}
      : onShutdownSignal(async () => {
          try {
            const dumpResult = await provider.request({
              method: "hardhat_dumpState",
            });
            assertHardhatInvariant(
              typeof dumpResult === "string",
              "hardhat_dumpState should return a string",
            );
            await writeStateFile(dumpPath, await dumpResultToJson(dumpResult));
            console.log(`Saved the state to ${dumpPath}`);
          } catch (error) {
            ensureError(error);
            dumpError = error;
          } finally {
            await server.close();
          }
        });

  await server.afterClosed();
  removeShutdownListeners();
  await buildInfoWatcher.close();

  if (dumpPath !== undefined && dumpError !== undefined) {
    throw new HardhatError(
      HardhatError.ERRORS.CORE.NODE.DUMP_STATE_FAILED,
      { path: dumpPath, reason: dumpError.message },
      dumpError,
    );
  }
};

export default nodeAction;
