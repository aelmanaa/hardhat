import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import {
  onShutdownSignal,
  SHUTDOWN_SIGNALS,
} from "../../../../../src/internal/builtin-plugins/node/state/shutdown-signals.js";

describe("onShutdownSignal", () => {
  for (const signal of SHUTDOWN_SIGNALS) {
    it(`runs the shutdown once on ${signal}`, async () => {
      const emitter = new EventEmitter();
      const received: string[] = [];

      onShutdownSignal(
        async (s) => {
          received.push(s);
        },
        { emitter, onForcedExit: () => assert.fail("not a second signal") },
      );
      emitter.emit(signal, signal);

      assert.deepEqual(received, [signal]);
    });
  }

  it("forces the exit on a second signal", () => {
    const emitter = new EventEmitter();
    let forced = 0;
    let shutdowns = 0;

    onShutdownSignal(
      async () => {
        shutdowns++;
      },
      { emitter, onForcedExit: () => forced++ },
    );
    emitter.emit("SIGINT", "SIGINT");
    emitter.emit("SIGTERM", "SIGTERM");

    assert.equal(shutdowns, 1);
    assert.equal(forced, 1);
  });

  it("removes its listeners", () => {
    const emitter = new EventEmitter();
    const remove = onShutdownSignal(async () => {}, { emitter });

    remove();

    for (const signal of SHUTDOWN_SIGNALS) {
      assert.equal(emitter.listenerCount(signal), 0);
    }
  });
});
