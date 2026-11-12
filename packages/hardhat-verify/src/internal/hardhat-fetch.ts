import type { Dispatcher } from "@nomicfoundation/hardhat-utils/request";

import {
  DEFAULT_USER_AGENT,
  getDispatcher,
} from "@nomicfoundation/hardhat-utils/request";

/**
 * A `fetch` for explorer-verify that keeps Hardhat's HTTP behaviour: the
 * `User-Agent: Hardhat` header, the proxy from `HTTP(S)_PROXY` and
 * `NO_PROXY`, and the request timeout of `hardhat-utils/request`.
 *
 * Tests pass an undici `MockAgent` as `dispatcher`, which then serves every
 * request.
 */
export function createHardhatFetch(dispatcher?: Dispatcher): typeof fetch {
  const dispatchers = new Map<string, Promise<Dispatcher>>();

  const dispatcherFor = (url: string): Promise<Dispatcher> => {
    if (dispatcher !== undefined) {
      return Promise.resolve(dispatcher);
    }

    // The proxy depends on the host, through NO_PROXY.
    const { origin } = new URL(url);
    let cached = dispatchers.get(origin);
    if (cached === undefined) {
      cached = getDispatcher(url);
      dispatchers.set(origin, cached);
    }
    return cached;
  };

  return async (input, init) => {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;

    const headers = new Headers(init?.headers);
    if (!headers.has("user-agent")) {
      headers.set("User-Agent", DEFAULT_USER_AGENT);
    }

    // Node's fetch takes an undici dispatcher in its init. Hardhat's undici
    // and the undici types of @types/node are separate copies, so the field
    // is set without the RequestInit type.
    const requestInit: RequestInit = { ...init, headers };
    Reflect.set(requestInit, "dispatcher", await dispatcherFor(url));

    // eslint-disable-next-line no-restricted-globals -- explorer-verify sends its requests through a fetch function; this one runs on Hardhat's dispatcher
    return await fetch(input, requestInit);
  };
}
