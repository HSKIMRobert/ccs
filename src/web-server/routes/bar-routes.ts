/**
 * Bar Routes — /api/bar/summary aggregator
 *
 * One GET returns the full glance array for CCS Bar (macOS MenuBarExtra).
 * Supports cached (instant) and ?refresh=true (live provider pull) modes.
 *
 * Design:
 * - Calls data sources DIRECTLY (not via HTTP routes) so rate-limiters are irrelevant.
 * - Force-fresh = invalidate quota-response-cache then call the fetcher server-side.
 * - Debounce: if a fresh pull happened < 15s ago, serve cache even when refresh=true.
 * - Per-account failure degrades THAT row (null fields + needsReauth/health:error);
 *   other rows are unaffected — the payload always returns HTTP 200.
 * - today_cost sourced from getTodayCostByAccount() (Phase 1A output).
 * - health derived from runHealthChecks() summary (overall, not per-account for v1).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { CLIProxyProvider } from '../../cliproxy/types';
import type { AccountInfo } from '../../cliproxy/accounts/types';
import type { QuotaResult } from '../../cliproxy/quota/quota-fetcher';
import type { HealthReport } from '../health-service';
import type { CliproxyUsageHistoryDetail } from '../usage/cliproxy-usage-transformer';
import { computeBarAnalytics } from '../usage/bar-analytics';

// ============================================================================
// Types
// ============================================================================

/** Single account glance row returned by /api/bar/summary */
export interface BarSummaryRow {
  /** Account identifier (email or custom name) */
  account_id: string;
  /** CLIProxy provider: agy | codex | gemini | claude | ghcp | … */
  provider: string;
  /** Nickname or fallback to account_id */
  displayName: string | null;
  /** Account tier: free | pro | ultra | unknown | null on error */
  tier: string | null;
  /** Whether account is user-paused */
  paused: boolean;
  /** Best-guess quota remaining percentage (0-100), null on error */
  quota_percentage: number | null;
  /** ISO timestamp of next quota reset, null if unknown */
  next_reset: string | null;
  /** Today's attributed cost in USD, null if unavailable */
  today_cost: number | null;
  /** Health status derived from overall system health */
  health: 'ok' | 'warning' | 'error';
  /** True when value came from cache; false when freshly fetched */
  cached: boolean;
  /** ISO timestamp of when this data was fetched/cached */
  fetchedAt: string;
  /** True if account token is expired and needs re-authentication */
  needsReauth: boolean;
}

// ============================================================================
// Dependency injection interface
// ============================================================================

/** All external dependencies are injectable for testability */
export interface BarRouterDeps {
  /** Get all CLIProxy accounts across providers */
  getAllAccountsSummary: () => Record<string, AccountInfo[]>;
  /** Check the quota cache for a specific account */

  getCachedQuota: <T>(provider: CLIProxyProvider | string, accountId: string) => T | null;
  /** Store a value in the quota cache */

  setCachedQuota: <T>(provider: CLIProxyProvider | string, accountId: string, data: T) => void;
  /** Invalidate cache entry for a specific account */
  invalidateQuotaCache: (provider: CLIProxyProvider | string, accountId: string) => void;
  /** Fetch live quota from provider for one account */
  fetchAccountQuota: (provider: CLIProxyProvider, accountId: string) => Promise<QuotaResult>;
  /** Compute per-account today cost from history details */
  getTodayCostByAccount: (details: CliproxyUsageHistoryDetail[]) => Record<string, number>;
  /** Load persisted CLIProxy usage details (from snapshot cache) */
  loadCliproxyDetails: () => Promise<CliproxyUsageHistoryDetail[]>;
  /**
   * Optional, retained only for test back-compat. NOT used by the request path:
   * the bar derives per-account health from each quota result. The real system
   * audit shells out via a synchronous execSync that must never run here.
   */
  runHealthChecks?: () => Promise<HealthReport>;
}

// ============================================================================
// Timing budgets (module-level; the bar must NEVER block on a slow provider)
// ============================================================================

/** Debounce window: skip force-fresh if last fresh pull was < 15s ago */
const FORCE_FRESH_DEBOUNCE_MS = 15_000;

/** Hard ceiling for the whole /summary response. Past this we paint from cache. */
const REQUEST_DEADLINE_MS = 2_500;

/** Per-account synchronous wait before falling back to stale cache (bg fetch continues). */
const PER_ACCOUNT_TIMEOUT_MS = 5_000;

/** Bound for the cost side-load so a slow snapshot read can't dominate the response. */
const SIDELOAD_TIMEOUT_MS = 1_500;

/** Timestamp of the last successful force-fresh pull (epoch ms, 0 = never) */
let lastForceFreshAt = 0;

/** Reset module state — called in tests to prevent cross-test pollution */
export function resetForceFreshDebounce(): void {
  lastForceFreshAt = 0;
}

/**
 * Resolve a promise to its value, or to null if it doesn't settle within `ms`.
 * The underlying promise keeps running (used to let a slow fetch warm the cache
 * for the next open while the current response degrades gracefully).
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, ms);
    p.then(
      (v) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(v);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    );
  });
}

// ============================================================================
// Per-account health derivation
// ============================================================================

/**
 * Health for a single account, derived from its own quota-fetch result.
 *
 * The menu bar is a per-account glance, so health is per-row — NOT the global
 * system audit. (The system audit is also unsafe here: it shells out via a
 * synchronous execSync that would block the event loop on the request path.)
 *
 *   needsReauth → 'error'   (token expired; user action required)
 *   fetch failed → 'warning' (transient/unknown; row degrades but isn't fatal)
 *   success      → 'ok'
 */
function deriveHealth(quota: QuotaResult | null): 'ok' | 'warning' | 'error' {
  if (quota?.needsReauth) return 'error';
  if (!quota || !quota.success) return 'warning';
  return 'ok';
}

// ============================================================================
// Quota → bar row mapping
// ============================================================================

/**
 * Extract the primary quota percentage from a QuotaResult.
 * For Antigravity accounts: use the first model's percentage.
 * Returns null on failure or missing data.
 */
function extractQuotaPercentage(quota: QuotaResult): number | null {
  if (!quota.success || quota.models.length === 0) return null;
  // Use the first model (highest weight) as the representative percentage
  return quota.models[0].percentage ?? null;
}

/**
 * Extract the next reset timestamp from a QuotaResult.
 * Returns null if not available.
 */
function extractNextReset(quota: QuotaResult): string | null {
  if (!quota.success || quota.models.length === 0) return null;
  return quota.models[0].resetTime ?? null;
}

// ============================================================================
// Per-account fetch with error isolation
// ============================================================================

interface AccountFetchResult {
  quota: QuotaResult | null;
  cached: boolean;
  fetchedAt: string;
}

async function fetchAccountData(
  account: AccountInfo,
  forceRefresh: boolean,
  deps: BarRouterDeps
): Promise<AccountFetchResult> {
  const provider = account.provider;
  const accountId = account.id;
  const now = new Date().toISOString();

  // Read any prior cache up front so it survives as a stale fallback even when a
  // refresh fetch is slow or fails (stale-while-revalidate).
  const cached = deps.getCachedQuota<QuotaResult>(provider, accountId);

  // Paused accounts: serve cache if present, otherwise degrade.
  // Never trigger a live fetch for a user-paused account.
  if (account.paused === true) {
    return { quota: cached ?? null, cached: cached !== null, fetchedAt: now };
  }

  // Default mode serves a present cache instantly (no provider call).
  if (!forceRefresh && cached) {
    return { quota: cached, cached: true, fetchedAt: now };
  }

  // Force-fresh busts the route cache first (the stale value captured above
  // still backs the fallback below).
  if (forceRefresh) {
    deps.invalidateQuotaCache(provider, accountId);
  }

  // Live fetch (force-refresh, or default-mode cache miss). It overwrites the
  // cache on success and is bounded by PER_ACCOUNT_TIMEOUT_MS; if it overruns,
  // the fetch keeps running (warming the cache for the next open) while this row
  // degrades to the stale value so the payload never blocks.
  const live = deps.fetchAccountQuota(provider as CLIProxyProvider, accountId).then((quota) => {
    deps.setCachedQuota(provider, accountId, quota);
    return quota;
  });
  const fresh = await withTimeout(live, PER_ACCOUNT_TIMEOUT_MS);
  if (fresh) return { quota: fresh, cached: false, fetchedAt: now };
  return { quota: cached ?? null, cached: cached !== null, fetchedAt: now };
}

// ============================================================================
// Row builder
// ============================================================================

/**
 * Resolve the cost-lookup key for an account.
 *
 * The attribution pipeline (buildAuthIndexToAccountMap) stores email as the
 * map value, so costByAccount keys are emails. For providers where
 * account.id == email (agy, gemini, anthropic, etc.) this is a no-op.
 * For duplicate-email providers like codex, account.id may be "email#variant",
 * so we prefer account.email for the lookup to ensure the keys match.
 * Falls back to account.id when email is absent (e.g. kiro/ghcp).
 */
function resolveCostKey(account: AccountInfo): string {
  return account.email ?? account.id;
}

function buildRow(
  account: AccountInfo,
  fetchResult: AccountFetchResult,
  costByAccount: Record<string, number>,
  /** Set of cost-keys that are shared by more than one account. Cost is unknowable for these. */
  sharedCostKeys: ReadonlySet<string>
): BarSummaryRow {
  const { quota, cached, fetchedAt } = fetchResult;
  const costKey = resolveCostKey(account);
  const health = deriveHealth(quota);

  // Fix #11: when multiple accounts share the same cost-key (e.g. two codex accounts with
  // the same email), we cannot attribute the combined cost to either individual account.
  // Report null (unknowable) rather than the inflated shared total.
  const todayCost = sharedCostKeys.has(costKey) ? null : (costByAccount[costKey] ?? 0);

  if (!quota || !quota.success) {
    // Degraded row: preserve identity fields, null out quota data
    return {
      account_id: account.id,
      provider: account.provider,
      displayName: account.nickname ?? account.id,
      tier: account.tier ?? null,
      paused: account.paused ?? false,
      quota_percentage: null,
      next_reset: null,
      today_cost: todayCost,
      health,
      cached,
      fetchedAt,
      needsReauth: quota?.needsReauth ?? false,
    };
  }

  return {
    account_id: account.id,
    provider: account.provider,
    displayName: account.nickname ?? account.id,
    tier: quota.tier ?? account.tier ?? null,
    paused: account.paused ?? false,
    quota_percentage: extractQuotaPercentage(quota),
    next_reset: extractNextReset(quota),
    today_cost: todayCost,
    health,
    cached,
    fetchedAt,
    needsReauth: quota.needsReauth ?? false,
  };
}

// ============================================================================
// Router factory
// ============================================================================

/**
 * Create the bar router with injected dependencies.
 *
 * Production usage: call without arguments (defaults resolve from real modules).
 * Test usage: pass mock implementations for each dep.
 */
export function createBarRouter(deps: BarRouterDeps): Router {
  const router = Router();

  /**
   * GET /summary[?refresh=true]
   *
   * Returns the menu-bar glance array for all CLIProxy accounts.
   *
   * Query params:
   *   refresh=true  — force-fresh from provider (debounced to once per 15s)
   */
  router.get('/summary', async (req: Request, res: Response): Promise<void> => {
    try {
      const wantsRefresh = req.query['refresh'] === 'true';

      // Determine effective refresh mode after applying debounce.
      // IMPORTANT: set lastForceFreshAt at decision time (before awaiting any
      // fetches) to prevent a read-modify-write race where two concurrent
      // refresh=true requests both pass the debounce check before either
      // records the timestamp.
      let doForceRefresh = false;
      if (wantsRefresh) {
        const sinceLastFresh = Date.now() - lastForceFreshAt;
        if (sinceLastFresh >= FORCE_FRESH_DEBOUNCE_MS) {
          doForceRefresh = true;
          lastForceFreshAt = Date.now(); // claim the window before any async work
        }
        // else: debounce active — fall through to cache path
      }

      // Cost side-load is bounded so a slow usage-snapshot read can't stall the
      // glance. (Health is per-account, derived from each quota result below —
      // no blocking system audit on the request path.)
      const details = await withTimeout(deps.loadCliproxyDetails(), SIDELOAD_TIMEOUT_MS);
      const costByAccount: Record<string, number> = details
        ? deps.getTodayCostByAccount(details)
        : {};

      // Flatten all accounts across providers
      const summary = deps.getAllAccountsSummary();
      const allAccounts: AccountInfo[] = Object.values(summary).flat();

      // Fix #11: compute which cost-keys are shared by >1 account so buildRow can
      // report null (unknowable) rather than the combined total for those rows.
      const costKeyCount = new Map<string, number>();
      for (const account of allAccounts) {
        const key = resolveCostKey(account);
        costKeyCount.set(key, (costKeyCount.get(key) ?? 0) + 1);
      }
      const sharedCostKeys = new Set<string>(
        Array.from(costKeyCount.entries())
          .filter(([, count]) => count > 1)
          .map(([key]) => key)
      );

      // Build every row synchronously from whatever is in cache right now. This
      // is the instant-paint fallback and the source of truth when the deadline
      // fires before live fetches finish.
      const cacheRows = (): BarSummaryRow[] => {
        const at = new Date().toISOString();
        return allAccounts.map((account) => {
          const cached = deps.getCachedQuota<QuotaResult>(account.provider, account.id);
          return buildRow(
            account,
            { quota: cached ?? null, cached: cached !== null, fetchedAt: at },
            costByAccount,
            sharedCostKeys
          );
        });
      };

      // Fetch quota in parallel with per-account error isolation. Each row is
      // bounded inside fetchAccountData; the whole gather is additionally raced
      // against REQUEST_DEADLINE_MS so the response NEVER hangs on a slow
      // provider — past the deadline we paint from cache and let background
      // fetches warm the next open.
      const CONCURRENCY_CAP = 5;
      const gather = (async (): Promise<BarSummaryRow[]> => {
        const rows: BarSummaryRow[] = [];
        for (let i = 0; i < allAccounts.length; i += CONCURRENCY_CAP) {
          const batch = allAccounts.slice(i, i + CONCURRENCY_CAP);
          const batchRows = await Promise.all(
            batch.map(async (account): Promise<BarSummaryRow> => {
              const fetchResult = await fetchAccountData(account, doForceRefresh, deps);
              return buildRow(account, fetchResult, costByAccount, sharedCostKeys);
            })
          );
          rows.push(...batchRows);
        }
        return rows;
      })();

      const deadline = new Promise<BarSummaryRow[]>((resolve) => {
        setTimeout(() => resolve(cacheRows()), REQUEST_DEADLINE_MS);
      });

      const rows = await Promise.race([gather, deadline]);
      res.json(rows);
    } catch (err) {
      console.error('[bar-routes] /summary error:', (err as Error).message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /analytics
   *
   * Rolls up the persisted usage snapshot into today / 7-day / 30-day spend, a
   * 7-day sparkline, and the top models. Read-only and cheap (the snapshot is
   * already on disk); bounded so a slow read can't stall the menu.
   */
  router.get('/analytics', async (_req: Request, res: Response): Promise<void> => {
    try {
      const details = await withTimeout(deps.loadCliproxyDetails(), SIDELOAD_TIMEOUT_MS);
      const analytics = computeBarAnalytics(details ?? [], new Date());
      res.json(analytics);
    } catch (err) {
      console.error('[bar-routes] /analytics error:', (err as Error).message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

// ============================================================================
// Default production router (sync imports — matches all other route modules)
// ============================================================================

import { getAllAccountsSummary } from '../../cliproxy/accounts/query';
import {
  getCachedQuota,
  setCachedQuota,
  invalidateQuotaCache,
} from '../../cliproxy/quota/quota-response-cache';
import { fetchAccountQuota } from '../../cliproxy/quota/quota-fetcher';
import { getTodayCostByAccount } from '../usage/data-aggregator';
import { loadCliproxySnapshotDetails } from '../usage/cliproxy-snapshot-reader';

/** Production bar router — wired to real dependencies */
const barRouter: Router = createBarRouter({
  getAllAccountsSummary,
  getCachedQuota,
  setCachedQuota,
  invalidateQuotaCache,
  fetchAccountQuota,
  getTodayCostByAccount,
  loadCliproxyDetails: loadCliproxySnapshotDetails,
});

export default barRouter;
