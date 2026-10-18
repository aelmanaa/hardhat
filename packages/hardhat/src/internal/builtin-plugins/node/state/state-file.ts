import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { gunzip as gunzipCallback } from "node:zlib";

import {
  move,
  readUtf8File,
  remove,
  writeUtf8File,
} from "@nomicfoundation/hardhat-utils/fs";

const gunzip = promisify(gunzipCallback);

/**
 * Converts the result of `hardhat_dumpState`, gzip-compressed JSON as hex, to
 * the JSON text that the state file stores.
 */
export async function dumpResultToJson(dumpResult: string): Promise<string> {
  const compressed = Buffer.from(dumpResult.replace(/^0x/, ""), "hex");
  return (await gunzip(compressed)).toString("utf8");
}

/**
 * Converts the JSON text of a state file to the parameter of
 * `hardhat_loadState`, which accepts plain JSON as hex.
 */
export function jsonToLoadParam(json: string): string {
  return `0x${Buffer.from(json, "utf8").toString("hex")}`;
}

export async function readStateFile(filePath: string): Promise<string> {
  return await readUtf8File(filePath);
}

/**
 * Writes the state file atomically: the JSON is written to a new temporary
 * file next to it, which then replaces the state file. A crash while writing
 * leaves the previous state file unchanged.
 */
export async function writeStateFile(
  filePath: string,
  json: string,
): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;

  try {
    await writeUtf8File(temporaryPath, json, "wx");
    await move(temporaryPath, filePath);
  } catch (error) {
    await remove(temporaryPath).catch(() => {});
    throw error;
  }
}
