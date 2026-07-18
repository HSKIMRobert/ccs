import { afterEach, describe, expect, it } from 'bun:test';
import type { QuotaResult } from '../../../src/cliproxy/quota/quota-fetcher';
import type {
  ClaudeQuotaResult,
  CodexQuotaResult,
} from '../../../src/cliproxy/quota/quota-types';
import {
  clearQuotaCache,
  getCachedQuota,
} from '../../../src/cliproxy/quota/quota-response-cache';
import {
  createBarPoolAccountQuotaFetcher,
  getCachedBarPoolAccountQuota,
  setCachedBarPoolAccountQuota,
} from '../../../src/web-server/routes/bar-pool-account-quota-adapter';

function createFetcher(
  claudeResult: ClaudeQuotaResult,
  codexResult: CodexQuotaResult
): (provider: 'claude' | 'codex', accountId: string) => Promise<QuotaResult> {
  return createBarPoolAccountQuotaFetcher({
    fetchLegacyAccountQuota: async () => {
      throw new Error('Legacy fetcher should not be called');
    },
    fetchClaudeQuota: async () => claudeResult,
    fetchCodexQuota: async () => codexResult,
  });
}

function claudeFailure(overrides: Partial<ClaudeQuotaResult> = {}): ClaudeQuotaResult {
  return {
    success: false,
    windows: [],
    coreUsage: { fiveHour: null, weekly: null },
    lastUpdated: 1,
    accountId: 'claude@example.com',
    ...overrides,
  };
}

function codexFailure(overrides: Partial<CodexQuotaResult> = {}): CodexQuotaResult {
  return {
    success: false,
    windows: [],
    coreUsage: { fiveHour: null, weekly: null },
    planType: 'pro',
    lastUpdated: 2,
    accountId: 'codex@example.com',
    ...overrides,
  };
}

afterEach(() => {
  clearQuotaCache();
});

describe('Bar pool account quota cache policy', () => {
  it('does not cache a retryable Claude timeout', async () => {
    const raw = claudeFailure({
      error: 'Claude OAuth usage request timeout',
      errorCode: 'network_timeout',
      retryable: true,
    });
    const fetchQuota = createFetcher(raw, codexFailure());
    const result = await fetchQuota('claude', 'claude@example.com');

    setCachedBarPoolAccountQuota('claude', 'claude@example.com', result);

    expect(getCachedQuota('claude', 'claude@example.com')).toBeNull();
    expect(getCachedBarPoolAccountQuota('claude', 'claude@example.com')).toBeNull();
  });

  it('does not cache a Codex 429 failure', async () => {
    const raw = codexFailure({
      error: 'Codex usage API rate limited',
      errorCode: 'rate_limited',
      httpStatus: 429,
    });
    const fetchQuota = createFetcher(claudeFailure(), raw);
    const result = await fetchQuota('codex', 'codex@example.com');

    setCachedBarPoolAccountQuota('codex', 'codex@example.com', result);

    expect(getCachedQuota('codex', 'codex@example.com')).toBeNull();
    expect(getCachedBarPoolAccountQuota('codex', 'codex@example.com')).toBeNull();
  });

  it('caches a stable Codex reauthentication failure in raw provider shape', async () => {
    const raw = codexFailure({
      error: 'Token expired or invalid',
      errorCode: 'reauth_required',
      httpStatus: 401,
      needsReauth: true,
      retryable: false,
    });
    const fetchQuota = createFetcher(claudeFailure(), raw);
    const result = await fetchQuota('codex', 'codex@example.com');

    setCachedBarPoolAccountQuota('codex', 'codex@example.com', result);

    const shared = getCachedQuota<CodexQuotaResult>('codex', 'codex@example.com');
    expect(shared).toEqual(raw);
    expect((shared as CodexQuotaResult & Partial<QuotaResult>)?.models).toBeUndefined();
    expect(getCachedBarPoolAccountQuota<QuotaResult>('codex', 'codex@example.com')).toMatchObject({
      success: false,
      models: [],
      needsReauth: true,
      httpStatus: 401,
    });
  });
});
