import type { EventEmitter } from "node:events";

export const SHUTDOWN_SIGNALS: NodeJS.Signals[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
];

/**
 * Runs `onShutdown` once, on the first of the shutdown signals. Another
 * signal while it's running calls `onForcedExit`.
 *
 * Returns a function that removes the listeners.
 */
export function onShutdownSignal(
  onShutdown: (signal: NodeJS.Signals) => Promise<void>,
  {
    emitter = process,
    onForcedExit = () => process.exit(130),
  }: {
    emitter?: EventEmitter;
    onForcedExit?: () => void;
  } = {},
): () => void {
  let shuttingDown = false;

  const listener = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      onForcedExit();
      return;
    }

    shuttingDown = true;
    void onShutdown(signal);
  };

  for (const signal of SHUTDOWN_SIGNALS) {
    emitter.on(signal, listener);
  }

  return () => {
    for (const signal of SHUTDOWN_SIGNALS) {
      emitter.off(signal, listener);
    }
  };
}
