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
  /** Run system health checks */
  runHealthChecks: () => Promise<HealthReport>;
}

// ============================================================================
// Debounce state (module-level; reset across test suites via DI)
// ============================================================================

/** Debounce window: skip force-fresh if last fresh pull was < 15s ago */
const FORCE_FRESH_DEBOUNCE_MS = 15_000;

/** Timestamp of the last successful force-fresh pull (epoch ms, 0 = never) */
let lastForceFreshAt = 0;

/** Reset debounce state — called in tests to prevent cross-test pollution */
export function resetForceFreshDebounce(): void {
  lastForceFreshAt = 0;
}

// ============================================================================
// Health mapping helper
// ============================================================================

function mapHealth(report: HealthReport): 'ok' | 'warning' | 'error' {
  if (report.summary.errors > 0) return 'error';
  if (report.summary.warnings > 0) return 'warning';
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
  const isPaused = account.paused === true;

  // Paused accounts: serve cache if present, otherwise degrade.
  // Never trigger a live fetch for a user-paused account (avoids unnecessary
  // network calls and quota consumption for suspended accounts).
  if (isPaused) {
    const cachedQuota = deps.getCachedQuota<QuotaResult>(provider, accountId);
    return {
      quota: cachedQuota ?? null,
      cached: cachedQuota !== null,
      fetchedAt: now,
    };
  }

  // When force-fresh, invalidate first then fetch live
  if (forceRefresh) {
    deps.invalidateQuotaCache(provider, accountId);

    try {
      const quota = await deps.fetchAccountQuota(provider, accountId);
      // Cache the result so subsequent default-mode calls serve it
      deps.setCachedQuota(provider, accountId, quota);
      return { quota, cached: false, fetchedAt: now };
    } catch {
      // Degrade this account row; don't throw
      return { quota: null, cached: false, fetchedAt: now };
    }
  }

  // Default mode: check cache first
  const cached = deps.getCachedQuota<QuotaResult>(provider, accountId);
  if (cached) {
    return { quota: cached, cached: true, fetchedAt: now };
  }

  // Cache miss → fetch live (still in default mode)
  try {
    const quota = await deps.fetchAccountQuota(provider, accountId);
    deps.setCachedQuota(provider, accountId, quota);
    return { quota, cached: false, fetchedAt: now };
  } catch {
    return { quota: null, cached: false, fetchedAt: now };
  }
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
  overallHealth: 'ok' | 'warning' | 'error'
): BarSummaryRow {
  const { quota, cached, fetchedAt } = fetchResult;
  const costKey = resolveCostKey(account);

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
      today_cost: costByAccount[costKey] ?? 0,
      health: quota?.needsReauth ? 'error' : overallHealth,
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
    today_cost: costByAccount[costKey] ?? 0,
    health: overallHealth,
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

      // Fetch system health (overall, not per-account)
      let overallHealth: 'ok' | 'warning' | 'error' = 'ok';
      try {
        const healthReport = await deps.runHealthChecks();
        overallHealth = mapHealth(healthReport);
      } catch {
        overallHealth = 'warning'; // health service unavailable → degrade gracefully
      }

      // Load usage details for per-account cost mapping
      let costByAccount: Record<string, number> = {};
      try {
        const details = await deps.loadCliproxyDetails();
        costByAccount = deps.getTodayCostByAccount(details);
      } catch {
        // Cost unavailable — rows get null/0; non-fatal
      }

      // Flatten all accounts across providers
      const summary = deps.getAllAccountsSummary();
      const allAccounts: AccountInfo[] = Object.values(summary).flat();

      // Fetch quota in parallel with per-account error isolation.
      // Concurrency is capped to avoid fan-out across large account lists.
      // Paused accounts are handled inside fetchAccountData (cache/degrade, no live fetch).
      const CONCURRENCY_CAP = 5;
      const rows: BarSummaryRow[] = [];
      for (let i = 0; i < allAccounts.length; i += CONCURRENCY_CAP) {
        const batch = allAccounts.slice(i, i + CONCURRENCY_CAP);
        const batchRows = await Promise.all(
          batch.map(async (account): Promise<BarSummaryRow> => {
            const fetchResult = await fetchAccountData(account, doForceRefresh, deps);
            return buildRow(account, fetchResult, costByAccount, overallHealth);
          })
        );
        rows.push(...batchRows);
      }

      res.json(rows);
    } catch (err) {
      console.error('[bar-routes] /summary error:', (err as Error).message);
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
import { runHealthChecks } from '../health-service';
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
  runHealthChecks,
});

export default barRouter;
