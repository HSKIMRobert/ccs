import { describe, expect, it } from 'bun:test';
import {
  mergeDailyData,
  mergeHourlyData,
  mergeMonthlyData,
} from '../../../src/web-server/usage/aggregator';
import type {
  DailyUsage,
  HourlyUsage,
  ModelBreakdown,
  MonthlyUsage,
} from '../../../src/web-server/usage/types';

const breakdown: ModelBreakdown = {
  modelName: 'claude-sonnet-4-5',
  inputTokens: 100,
  outputTokens: 40,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  cost: 0.1,
};

function validHour(): HourlyUsage {
  return {
    hour: '2026-03-02 10:00',
    source: 'test',
    inputTokens: 100,
    outputTokens: 40,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cost: 0.1,
    totalCost: 0.1,
    modelsUsed: ['claude-sonnet-4-5'],
    modelBreakdowns: [{ ...breakdown }],
    requestCount: 1,
  };
}

function validDay(): DailyUsage {
  return {
    date: '2026-03-02',
    source: 'test',
    inputTokens: 100,
    outputTokens: 40,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cost: 0.1,
    totalCost: 0.1,
    modelsUsed: ['claude-sonnet-4-5'],
    modelBreakdowns: [{ ...breakdown }],
  };
}

function validMonth(): MonthlyUsage {
  return {
    month: '2026-03',
    source: 'test',
    inputTokens: 100,
    outputTokens: 40,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalCost: 0.1,
    modelsUsed: ['claude-sonnet-4-5'],
    modelBreakdowns: [{ ...breakdown }],
  };
}

/**
 * Simulates a partially-written or legacy persisted usage record that is
 * missing `modelBreakdowns` (and `requestCount`) despite the type declaring
 * them, e.g. a Codex rollout file scanned mid-write.
 */
function stripBreakdowns<T extends { modelBreakdowns: ModelBreakdown[] }>(record: T): T {
  const partial = { ...record } as Partial<T>;
  delete partial.modelBreakdowns;
  if ('requestCount' in partial) {
    delete (partial as { requestCount?: number }).requestCount;
  }
  return partial as T;
}

describe('usage aggregator merge with missing modelBreakdowns', () => {
  it('does not throw when a same-hour record is missing modelBreakdowns (merge-into-existing path)', () => {
    const merged = mergeHourlyData([[validHour()], [stripBreakdowns(validHour())]]);
    expect(merged).toHaveLength(1);
    // requestCount stays numeric instead of throwing on `.length` of undefined.
    expect(typeof merged[0]?.requestCount).toBe('number');
    // Tokens from both records still aggregate.
    expect(merged[0]?.inputTokens).toBe(200);
  });

  it('does not throw when the only record is missing modelBreakdowns (new-bucket path)', () => {
    const merged = mergeHourlyData([[stripBreakdowns(validHour())]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.modelBreakdowns).toEqual([]);
    expect(merged[0]?.requestCount).toBe(0);
  });

  it('daily merge tolerates a record missing modelBreakdowns', () => {
    expect(() => mergeDailyData([[validDay()], [stripBreakdowns(validDay())]])).not.toThrow();
  });

  it('monthly merge tolerates a record missing modelBreakdowns', () => {
    expect(() => mergeMonthlyData([[validMonth()], [stripBreakdowns(validMonth())]])).not.toThrow();
  });
});
