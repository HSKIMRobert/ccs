/**
 * Bar-only adapter for CLIProxy pool-account quota.
 *
 * Bar's cache and row builder consume the legacy Antigravity QuotaResult shape.
 * Claude and Codex expose richer window-based results, so this adapter dispatches
 * to their single-account fetchers and collapses the binding core window into
 * the existing percentage/reset fields. Other providers retain the legacy
 * fetcher's behavior, including Antigravity and quota_not_supported results.
 */

import type { CLIProxyProvider } from '../../cliproxy/types';
import type { QuotaResult } from '../../cliproxy/quota/quota-fetcher';
import { fetchAccountQuota } from '../../cliproxy/quota/quota-fetcher';
import {
  getCachedQuota,
  invalidateQuotaCache,
  setCachedQuota,
} from '../../cliproxy/quota/quota-response-cache';
import {
  buildClaudeCoreUsageSummary,
  fetchClaudeQuota,
} from '../../cliproxy/quota/quota-fetcher-claude';
import {
  buildCodexCoreUsageSummary,
  fetchCodexQuota,
} from '../../cliproxy/quota/quota-fetcher-codex';
import type {
  ClaudeQuotaResult,
  CodexQuotaResult,
  QuotaErrorMetadata,
} from '../../cliproxy/quota/quota-types';

interface BindingWindow {
  name: string;
  displayName: string;
  remainingPercent: number;
  resetAt: string | null;
}

interface ProviderQuotaResult extends QuotaErrorMetadata {
  success: boolean;
  lastUpdated: number;
  error?: string;
  accountId?: string;
  needsReauth?: boolean;
}

type RawWindowQuotaResult = ClaudeQuotaResult | CodexQuotaResult;

const rawQuotaByNormalizedResult = new WeakMap<QuotaResult, RawWindowQuotaResult>();

export interface BarPoolAccountQuotaFetcherDeps {
  fetchLegacyAccountQuota: (provider: CLIProxyProvider, accountId: string) => Promise<QuotaResult>;
  fetchClaudeQuota: (accountId: string) => Promise<ClaudeQuotaResult>;
  fetchCodexQuota: (accountId: string) => Promise<CodexQuotaResult>;
}

function normalizeRemainingPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function resetTimestamp(resetAt: string | null): number {
  if (!resetAt) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(resetAt);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function pickBindingWindow(windows: BindingWindow[]): BindingWindow | null {
  return (
    windows
      .filter((window) => Number.isFinite(window.remainingPercent))
      .sort(
        (left, right) =>
          left.remainingPercent - right.remainingPercent ||
          resetTimestamp(left.resetAt) - resetTimestamp(right.resetAt)
      )[0] ?? null
  );
}

function normalizeResult(
  result: ProviderQuotaResult,
  bindingWindow: BindingWindow | null
): QuotaResult {
  return {
    success: result.success,
    models:
      result.success && bindingWindow
        ? [
            {
              name: bindingWindow.name,
              displayName: bindingWindow.displayName,
              percentage: normalizeRemainingPercent(bindingWindow.remainingPercent),
              resetTime: bindingWindow.resetAt,
            },
          ]
        : [],
    lastUpdated: result.lastUpdated,
    httpStatus: result.httpStatus,
    errorCode: result.errorCode,
    errorDetail: result.errorDetail,
    isForbidden: result.isForbidden,
    error: result.error,
    actionHint: result.actionHint,
    retryable: result.retryable,
    needsReauth: result.needsReauth,
    accountId: result.accountId,
  };
}

function normalizeClaudeQuota(result: ClaudeQuotaResult): QuotaResult {
  const coreUsage =
    result.coreUsage?.fiveHour || result.coreUsage?.weekly
      ? result.coreUsage
      : buildClaudeCoreUsageSummary(result.windows);
  const bindingWindow = pickBindingWindow(
    [coreUsage?.fiveHour, coreUsage?.weekly].filter(isPresent).map((window) => ({
      name: window.rateLimitType,
      displayName: window.label,
      remainingPercent: window.remainingPercent,
      resetAt: window.resetAt,
    }))
  );

  const normalized = normalizeResult(result, bindingWindow);
  rawQuotaByNormalizedResult.set(normalized, result);
  return normalized;
}

function normalizeCodexQuota(result: CodexQuotaResult): QuotaResult {
  const coreUsage =
    result.coreUsage?.fiveHour || result.coreUsage?.weekly
      ? result.coreUsage
      : buildCodexCoreUsageSummary(result.windows);
  const bindingWindow = pickBindingWindow(
    [coreUsage?.fiveHour, coreUsage?.weekly].filter(isPresent).map((window) => ({
      name: window.label,
      displayName: window.label,
      remainingPercent: window.remainingPercent,
      resetAt: window.resetAt,
    }))
  );

  const normalized = normalizeResult(result, bindingWindow);
  rawQuotaByNormalizedResult.set(normalized, result);
  return normalized;
}

function isWindowQuotaResult(value: unknown): value is RawWindowQuotaResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'windows' in value &&
    Array.isArray((value as { windows?: unknown }).windows)
  );
}

export function getCachedBarPoolAccountQuota<T>(
  provider: CLIProxyProvider | string,
  accountId: string
): T | null {
  const cached = getCachedQuota<unknown>(provider, accountId);
  if (!cached) return null;
  if (provider === 'claude' && isWindowQuotaResult(cached)) {
    return normalizeClaudeQuota(cached as ClaudeQuotaResult) as T;
  }
  if (provider === 'codex' && isWindowQuotaResult(cached)) {
    return normalizeCodexQuota(cached as CodexQuotaResult) as T;
  }
  return cached as T;
}

export function setCachedBarPoolAccountQuota<T>(
  provider: CLIProxyProvider | string,
  accountId: string,
  data: T
): void {
  const raw =
    typeof data === 'object' && data !== null
      ? rawQuotaByNormalizedResult.get(data as unknown as QuotaResult)
      : undefined;
  setCachedQuota(provider, accountId, raw ?? data);
}

export function invalidateCachedBarPoolAccountQuota(
  provider: CLIProxyProvider | string,
  accountId: string
): void {
  invalidateQuotaCache(provider, accountId);
}

export function createBarPoolAccountQuotaFetcher(
  deps: BarPoolAccountQuotaFetcherDeps
): (provider: CLIProxyProvider, accountId: string) => Promise<QuotaResult> {
  return async (provider, accountId) => {
    if (provider === 'claude') {
      return normalizeClaudeQuota(await deps.fetchClaudeQuota(accountId));
    }
    if (provider === 'codex') {
      return normalizeCodexQuota(await deps.fetchCodexQuota(accountId));
    }
    return deps.fetchLegacyAccountQuota(provider, accountId);
  };
}

export const fetchBarPoolAccountQuota = createBarPoolAccountQuotaFetcher({
  fetchLegacyAccountQuota: fetchAccountQuota,
  fetchClaudeQuota,
  fetchCodexQuota,
});
