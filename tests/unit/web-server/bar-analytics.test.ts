import { describe, it, expect } from 'bun:test';
import { computeBarAnalytics } from '../../../src/web-server/usage/bar-analytics';
import type { CliproxyUsageHistoryDetail } from '../../../src/web-server/usage/cliproxy-usage-transformer';

const NOW = new Date('2026-06-08T12:00:00-04:00');

function detail(over: Partial<CliproxyUsageHistoryDetail>): CliproxyUsageHistoryDetail {
  return {
    model: 'gpt-5.5',
    timestamp: NOW.toISOString(),
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    requestCount: 1,
    cost: 1,
    failed: false,
    ...over,
  };
}

/** Build an ISO timestamp `n` whole days before NOW (local). */
function daysAgo(n: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n, 10, 0, 0);
  return d.toISOString();
}

describe('computeBarAnalytics', () => {
  it('returns an empty/zeroed payload for no details', () => {
    const a = computeBarAnalytics([], NOW);
    expect(a.today.cost).toBe(0);
    expect(a.allTime.cost).toBe(0);
    expect(a.byDay).toHaveLength(7);
    expect(a.topModels).toHaveLength(0);
    expect(a.topModelsWindow).toBe('all');
  });

  it('rolls today / 7d / 30d / allTime into the right windows', () => {
    const a = computeBarAnalytics(
      [
        detail({ timestamp: daysAgo(0), cost: 2, requestCount: 1 }), // today
        detail({ timestamp: daysAgo(3), cost: 3, requestCount: 2 }), // 7d + 30d
        detail({ timestamp: daysAgo(20), cost: 5, requestCount: 1 }), // 30d only
        detail({ timestamp: daysAgo(90), cost: 10, requestCount: 4 }), // allTime only
      ],
      NOW
    );
    expect(a.today.cost).toBe(2);
    expect(a.last7d.cost).toBe(5); // 2 + 3
    expect(a.last30d.cost).toBe(10); // 2 + 3 + 5
    expect(a.allTime.cost).toBe(20); // + 10
    expect(a.allTime.requests).toBe(8);
  });

  it('excludes failed requests from spend', () => {
    const a = computeBarAnalytics(
      [detail({ cost: 9, failed: true }), detail({ cost: 1, failed: false })],
      NOW
    );
    expect(a.today.cost).toBe(1);
    expect(a.allTime.cost).toBe(1);
  });

  it('zero-fills the 7-day sparkline in chronological order', () => {
    const a = computeBarAnalytics([detail({ timestamp: daysAgo(2), cost: 4 })], NOW);
    expect(a.byDay).toHaveLength(7);
    // oldest first, newest last
    expect(a.byDay[0].date < a.byDay[6].date).toBe(true);
    const hit = a.byDay.find((d) => d.cost > 0);
    expect(hit?.cost).toBe(4);
  });

  it('ranks top models by spend and labels the window 30d when recent data exists', () => {
    const a = computeBarAnalytics(
      [
        detail({ model: 'gpt-5.4', timestamp: daysAgo(1), cost: 5 }),
        detail({ model: 'gpt-5.5', timestamp: daysAgo(1), cost: 8 }),
        detail({ model: 'gpt-5.4', timestamp: daysAgo(2), cost: 2 }),
      ],
      NOW
    );
    expect(a.topModelsWindow).toBe('30d');
    expect(a.topModels[0].model).toBe('gpt-5.5'); // 8
    expect(a.topModels[1].model).toBe('gpt-5.4'); // 7
  });

  it('falls back to all-time top models when the last 30 days are idle', () => {
    const a = computeBarAnalytics(
      [
        detail({ model: 'gpt-5.4', timestamp: daysAgo(60), cost: 100 }),
        detail({ model: 'gpt-5.5', timestamp: daysAgo(45), cost: 40 }),
      ],
      NOW
    );
    expect(a.last30d.cost).toBe(0);
    expect(a.topModelsWindow).toBe('all');
    expect(a.topModels[0].model).toBe('gpt-5.4');
  });
});
