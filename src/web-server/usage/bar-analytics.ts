/**
 * Bar Analytics Aggregator
 *
 * Pure functions that roll up the flat CliproxyUsageHistoryDetail array (the
 * same snapshot the bar already loads for per-account cost) into the small,
 * glanceable analytics the menu bar surfaces: today / 7-day / 30-day spend,
 * a 7-day cost sparkline, and the top models by spend.
 *
 * Kept dependency-free and deterministic (the reference "now" is injected) so
 * it is trivially unit-testable and cheap enough to run on every bar open.
 */

import type { CliproxyUsageHistoryDetail } from './cliproxy-usage-transformer';

/** A single day's roll-up (local-day granularity). */
export interface BarAnalyticsDay {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  cost: number;
  requests: number;
}

/** Aggregate spend over a rolling window. */
export interface BarAnalyticsWindow {
  cost: number;
  requests: number;
}

/** One model's contribution to spend over the trailing 7 days. */
export interface BarAnalyticsModel {
  model: string;
  cost: number;
  requests: number;
}

/** The full analytics payload returned by GET /api/bar/analytics. */
export interface BarAnalytics {
  today: BarAnalyticsWindow;
  last7d: BarAnalyticsWindow;
  last30d: BarAnalyticsWindow;
  /** Lifetime totals across every record in the snapshot. */
  allTime: BarAnalyticsWindow;
  /** Oldest → newest, exactly 7 entries (zero-filled), for the sparkline. */
  byDay: BarAnalyticsDay[];
  /** Highest-spend models (descending, capped) for the window in `topModelsWindow`. */
  topModels: BarAnalyticsModel[];
  /** Which window `topModels` covers — the most recent one that has data. */
  topModelsWindow: '30d' | 'all';
  /** ISO timestamp the payload was generated. */
  generatedAt: string;
}

const SPARKLINE_DAYS = 7;
const TOP_MODELS_LIMIT = 5;

/** Local-time YYYY-MM-DD key for a Date (matches the user's calendar day). */
function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whole-day difference (a - b) in local days, via midnight-anchored dates. */
function dayDelta(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((da.getTime() - db.getTime()) / 86_400_000);
}

/**
 * Roll the raw details into the bar analytics payload, relative to `now`.
 * Failed requests are excluded from spend (they carry no real cost).
 */
export function computeBarAnalytics(
  details: CliproxyUsageHistoryDetail[],
  now: Date
): BarAnalytics {
  const today: BarAnalyticsWindow = { cost: 0, requests: 0 };
  const last7d: BarAnalyticsWindow = { cost: 0, requests: 0 };
  const last30d: BarAnalyticsWindow = { cost: 0, requests: 0 };
  const allTime: BarAnalyticsWindow = { cost: 0, requests: 0 };

  // Seed the sparkline with the trailing 7 local days (zero-filled, ordered).
  const dayBuckets = new Map<string, BarAnalyticsDay>();
  for (let i = SPARKLINE_DAYS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dayBuckets.set(localDayKey(d), { date: localDayKey(d), cost: 0, requests: 0 });
  }

  // Track per-model spend over both the trailing 30 days and all-time so we can
  // show recent leaders when fresh, and lifetime leaders when the proxy has
  // simply been idle lately.
  const model30d = new Map<string, BarAnalyticsModel>();
  const modelAll = new Map<string, BarAnalyticsModel>();
  const bump = (
    map: Map<string, BarAnalyticsModel>,
    model: string,
    cost: number,
    requests: number
  ): void => {
    const existing = map.get(model);
    if (existing) {
      existing.cost += cost;
      existing.requests += requests;
    } else {
      map.set(model, { model, cost, requests });
    }
  };

  for (const detail of details) {
    if (detail.failed) continue;
    const ts = new Date(detail.timestamp);
    if (Number.isNaN(ts.getTime())) continue;

    const delta = dayDelta(now, ts); // 0 = today, 1 = yesterday, …
    if (delta < 0) continue; // ignore future-dated noise

    const cost = Number.isFinite(detail.cost) ? detail.cost : 0;
    const requests = Number.isFinite(detail.requestCount) ? detail.requestCount : 0;

    allTime.cost += cost;
    allTime.requests += requests;
    bump(modelAll, detail.model, cost, requests);

    if (delta === 0) {
      today.cost += cost;
      today.requests += requests;
    }
    if (delta < 7) {
      last7d.cost += cost;
      last7d.requests += requests;
      const bucket = dayBuckets.get(localDayKey(ts));
      if (bucket) {
        bucket.cost += cost;
        bucket.requests += requests;
      }
    }
    if (delta < 30) {
      last30d.cost += cost;
      last30d.requests += requests;
      bump(model30d, detail.model, cost, requests);
    }
  }

  // Prefer recent leaders; fall back to lifetime when the last 30 days are idle.
  const recentHasData = last30d.cost > 0 || last30d.requests > 0;
  const sourceMap = recentHasData ? model30d : modelAll;
  const topModels = Array.from(sourceMap.values())
    .filter((m) => m.cost > 0 || m.requests > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, TOP_MODELS_LIMIT);

  return {
    today,
    last7d,
    last30d,
    allTime,
    byDay: Array.from(dayBuckets.values()),
    topModels,
    topModelsWindow: recentHasData ? '30d' : 'all',
    generatedAt: now.toISOString(),
  };
}
