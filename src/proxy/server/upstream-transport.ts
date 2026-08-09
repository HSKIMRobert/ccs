import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';
import type { LogErrorInfo } from '../../services/logging';
import {
  createGlobalFetchProxyDispatcher,
  type UpstreamAgentTimeoutOptions,
} from '../../utils/fetch-proxy-setup';
import { getProxyResolution, shouldBypassProxy } from '../../utils/proxy-env';

type BunRequestInit = RequestInit & {
  proxy?: string;
  tls?: { rejectUnauthorized: boolean };
};

const dispatcherClosePromises = new WeakMap<object, Promise<void>>();

export function isBunRuntime(): boolean {
  return typeof process.versions.bun === 'string';
}

export function createUpstreamDispatcher(
  options: UpstreamAgentTimeoutOptions,
  insecure = false
): Dispatcher | undefined {
  if (isBunRuntime()) {
    return undefined;
  }
  if (insecure) {
    return new Agent({ connect: { rejectUnauthorized: false }, ...options });
  }
  return createGlobalFetchProxyDispatcher(options) ?? new Agent(options);
}

export function closeUpstreamDispatcher(dispatcher?: Dispatcher): Promise<void> {
  if (!dispatcher) {
    return Promise.resolve();
  }
  const existing = dispatcherClosePromises.get(dispatcher);
  if (existing) {
    return existing;
  }

  const close = (dispatcher as unknown as { close?: () => Promise<void> }).close;
  const closing =
    typeof close === 'function' ? Promise.resolve(close.call(dispatcher)) : Promise.resolve();
  dispatcherClosePromises.set(dispatcher, closing);
  return closing;
}

export async function fetchWithUpstreamTransport(
  input: string | URL | Request,
  init: RequestInit,
  options: { dispatcher?: Dispatcher; insecureTls?: boolean } = {}
): Promise<Response> {
  if (!isBunRuntime()) {
    return undiciFetch(input, init as Parameters<typeof undiciFetch>[1]) as Promise<Response>;
  }

  const requestUrl = new URL(
    typeof input === 'string' || input instanceof URL ? input.toString() : input.url
  );
  const bunInit: BunRequestInit = { ...init };
  delete (bunInit as Record<string, unknown>).dispatcher;

  if (!shouldBypassProxy(requestUrl.hostname)) {
    const proxy = getProxyResolution(requestUrl.protocol === 'https:', process.env, {
      allowedProtocols: ['http:', 'https:'],
    });
    if (proxy.url) {
      bunInit.proxy = proxy.url;
    }
  }
  if (options.insecureTls) {
    bunInit.tls = { rejectUnauthorized: false };
  }

  return globalThis.fetch(input, bunInit);
}

export function toLogErrorInfo(error: unknown, depth = 0): LogErrorInfo {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: String(error) };
  }

  const errorWithDetails = error as Error & { code?: unknown; cause?: unknown };
  const info: LogErrorInfo = { name: error.name, message: error.message };
  if (typeof errorWithDetails.code === 'string') {
    info.code = errorWithDetails.code;
  }
  if (depth < 3 && errorWithDetails.cause !== undefined && errorWithDetails.cause !== error) {
    info.cause = toLogErrorInfo(errorWithDetails.cause, depth + 1);
  }
  return info;
}
