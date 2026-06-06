/**
 * Unit tests for Data Aggregator
 */

import { describe, expect, test } from 'bun:test';
import {
  aggregateDailyUsage,
  aggregateHourlyUsage,
  aggregateMonthlyUsage,
  aggregateSessionUsage,
} from '../../src/web-server/data-aggregator';
import { type RawUsageEntry } from '../../src/web-server/jsonl-parser';

// ============================================================================
// TEST FIXTURES
// ============================================================================

const createEntry = (overrides: Partial<RawUsageEntry> = {}): RawUsageEntry => ({
  inputTokens: 1000,
  outputTokens: 500,
  cacheCreationTokens: 100,
  cacheReadTokens: 50,
  model: 'claude-sonnet-4-5',
  sessionId: 'session-123',
  timestamp: '2025-12-09T10:00:00.000Z',
  projectPath: '/home/user/project',
  version: '2.0.60',
  ...overrides,
});

// ============================================================================
// aggregateDailyUsage Tests
// ============================================================================

describe('aggregateDailyUsage', () => {
  test('aggregates entries by date', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ timestamp: '2025-12-09T10:00:00.000Z', inputTokens: 1000 }),
      createEntry({ timestamp: '2025-12-09T14:00:00.000Z', inputTokens: 2000 }),
      createEntry({ timestamp: '2025-12-08T10:00:00.000Z', inputTokens: 500 }),
    ];

    const result = aggregateDailyUsage(entries);

    expect(result.length).toBe(2);
    // Most recent first
    expect(result[0].date).toBe('2025-12-09');
    expect(result[0].inputTokens).toBe(3000); // 1000 + 2000
    expect(result[1].date).toBe('2025-12-08');
    expect(result[1].inputTokens).toBe(500);
  });

  test('groups by model within each day', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ model: 'claude-sonnet-4-5', inputTokens: 1000 }),
      createEntry({ model: 'claude-opus-4-5-20251101', inputTokens: 2000 }),
      createEntry({ model: 'claude-sonnet-4-5', inputTokens: 500 }),
    ];

    const result = aggregateDailyUsage(entries);

    expect(result.length).toBe(1);
    expect(result[0].modelBreakdowns.length).toBe(2);
    expect(result[0].modelsUsed).toContain('claude-sonnet-4-5');
    expect(result[0].modelsUsed).toContain('claude-opus-4-5-20251101');

    // Find sonnet breakdown
    const sonnet = result[0].modelBreakdowns.find((b) => b.modelName === 'claude-sonnet-4-5');
    expect(sonnet!.inputTokens).toBe(1500); // 1000 + 500
  });

  test('calculates costs correctly', () => {
    const entries: RawUsageEntry[] = [
      createEntry({
        model: 'claude-sonnet-4-5',
        inputTokens: 1_000_000, // $3.00
        outputTokens: 1_000_000, // $15.00
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ];

    const result = aggregateDailyUsage(entries);

    expect(result[0].totalCost).toBeCloseTo(18.0, 2);
    expect(result[0].modelBreakdowns[0].cost).toBeCloseTo(18.0, 2);
  });

  test('returns empty array for no entries', () => {
    const result = aggregateDailyUsage([]);
    expect(result.length).toBe(0);
  });

  test('sorts model breakdowns by cost descending', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ model: 'claude-haiku-4-5-20251001', inputTokens: 1000 }), // cheap
      createEntry({ model: 'claude-opus-4-5-20251101', inputTokens: 1000 }), // expensive
    ];

    const result = aggregateDailyUsage(entries);

    // Opus should be first (higher cost)
    expect(result[0].modelBreakdowns[0].modelName).toBe('claude-opus-4-5-20251101');
  });

  test('sets source field', () => {
    const entries: RawUsageEntry[] = [createEntry()];
    const result = aggregateDailyUsage(entries, 'test-source');
    expect(result[0].source).toBe('test-source');
  });

  test('keeps provider identity when same model appears under multiple providers', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ model: 'gpt-5.5', target: 'openai' }),
      createEntry({ model: 'gpt-5.5', target: 'github-copilot' }),
    ];

    const daily = aggregateDailyUsage(entries);
    const hourly = aggregateHourlyUsage(entries);
    const monthly = aggregateMonthlyUsage(entries);
    const session = aggregateSessionUsage(entries);

    expect(daily[0].modelsUsed).toEqual(['openai/gpt-5.5', 'github-copilot/gpt-5.5']);
    expect(hourly[0].modelsUsed).toEqual(['openai/gpt-5.5', 'github-copilot/gpt-5.5']);
    expect(monthly[0].modelsUsed).toEqual(['openai/gpt-5.5', 'github-copilot/gpt-5.5']);
    expect(session[0].modelsUsed).toEqual(['openai/gpt-5.5', 'github-copilot/gpt-5.5']);
    expect(daily[0].modelBreakdowns.map((item) => item.provider)).toEqual([
      'openai',
      'github-copilot',
    ]);
  });

  test('preserves model-only modelsUsed entries when provider is unambiguous', () => {
    const result = aggregateDailyUsage([
      createEntry({ model: 'gpt-5.5', target: 'openai' }),
      createEntry({ model: 'gpt-5.5', target: 'openai' }),
    ]);

    expect(result[0].modelsUsed).toEqual(['gpt-5.5']);
  });

  test('canonicalizes provider aliases before grouping usage', () => {
    const result = aggregateDailyUsage([
      createEntry({ model: 'gpt-5.5', target: 'ghcp', inputTokens: 1000 }),
      createEntry({ model: 'gpt-5.5', target: 'github-copilot', inputTokens: 2000 }),
    ]);

    expect(result[0].modelsUsed).toEqual(['gpt-5.5']);
    expect(result[0].modelBreakdowns).toHaveLength(1);
    expect(result[0].modelBreakdowns[0].provider).toBe('github-copilot');
    expect(result[0].modelBreakdowns[0].inputTokens).toBe(3000);
  });

  test('handles provider names inherited from Object.prototype', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ model: 'model-a', target: '__proto__' }),
      createEntry({ model: 'model-b', target: 'constructor' }),
      createEntry({ model: 'model-c', target: 'toString' }),
    ];

    const daily = aggregateDailyUsage(entries);
    const hourly = aggregateHourlyUsage(entries);
    const monthly = aggregateMonthlyUsage(entries);
    const session = aggregateSessionUsage(entries);

    expect(daily[0].modelBreakdowns.map((item) => item.provider)).toEqual([
      '__proto__',
      'constructor',
      'tostring',
    ]);
    expect(hourly[0].modelBreakdowns.map((item) => item.provider)).toEqual([
      '__proto__',
      'constructor',
      'tostring',
    ]);
    expect(monthly[0].modelBreakdowns.map((item) => item.provider)).toEqual([
      '__proto__',
      'constructor',
      'tostring',
    ]);
    expect(session[0].modelBreakdowns.map((item) => item.provider)).toEqual([
      '__proto__',
      'constructor',
      'tostring',
    ]);
  });
});

// ============================================================================
// aggregateMonthlyUsage Tests
// ============================================================================

describe('aggregateMonthlyUsage', () => {
  test('aggregates entries by month', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ timestamp: '2025-12-09T10:00:00.000Z', inputTokens: 1000 }),
      createEntry({ timestamp: '2025-12-15T10:00:00.000Z', inputTokens: 2000 }),
      createEntry({ timestamp: '2025-11-20T10:00:00.000Z', inputTokens: 500 }),
    ];

    const result = aggregateMonthlyUsage(entries);

    expect(result.length).toBe(2);
    // Most recent first
    expect(result[0].month).toBe('2025-12');
    expect(result[0].inputTokens).toBe(3000); // 1000 + 2000
    expect(result[1].month).toBe('2025-11');
    expect(result[1].inputTokens).toBe(500);
  });

  test('groups by model within each month', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ model: 'claude-sonnet-4-5', inputTokens: 1000 }),
      createEntry({ model: 'gemini-2.5-pro', inputTokens: 2000 }),
    ];

    const result = aggregateMonthlyUsage(entries);

    expect(result[0].modelBreakdowns.length).toBe(2);
    expect(result[0].modelsUsed).toContain('claude-sonnet-4-5');
    expect(result[0].modelsUsed).toContain('gemini-2.5-pro');
  });

  test('returns empty array for no entries', () => {
    const result = aggregateMonthlyUsage([]);
    expect(result.length).toBe(0);
  });
});

// ============================================================================
// aggregateSessionUsage Tests
// ============================================================================

describe('aggregateSessionUsage', () => {
  test('aggregates entries by sessionId', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ sessionId: 'session-A', inputTokens: 1000 }),
      createEntry({ sessionId: 'session-A', inputTokens: 2000 }),
      createEntry({ sessionId: 'session-B', inputTokens: 500 }),
    ];

    const result = aggregateSessionUsage(entries);

    expect(result.length).toBe(2);

    const sessionA = result.find((s) => s.sessionId === 'session-A');
    expect(sessionA!.inputTokens).toBe(3000);

    const sessionB = result.find((s) => s.sessionId === 'session-B');
    expect(sessionB!.inputTokens).toBe(500);
  });

  test('tracks last activity timestamp', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ sessionId: 'session-A', timestamp: '2025-12-09T10:00:00.000Z' }),
      createEntry({ sessionId: 'session-A', timestamp: '2025-12-09T14:00:00.000Z' }),
      createEntry({ sessionId: 'session-A', timestamp: '2025-12-09T12:00:00.000Z' }),
    ];

    const result = aggregateSessionUsage(entries);

    expect(result[0].lastActivity).toBe('2025-12-09T14:00:00.000Z');
  });

  test('collects unique versions', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ sessionId: 'session-A', version: '2.0.59' }),
      createEntry({ sessionId: 'session-A', version: '2.0.60' }),
      createEntry({ sessionId: 'session-A', version: '2.0.60' }), // duplicate
    ];

    const result = aggregateSessionUsage(entries);

    expect(result[0].versions.length).toBe(2);
    expect(result[0].versions).toContain('2.0.59');
    expect(result[0].versions).toContain('2.0.60');
  });

  test('includes project path', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ sessionId: 'session-A', projectPath: '/home/user/my-project' }),
    ];

    const result = aggregateSessionUsage(entries);

    expect(result[0].projectPath).toBe('/home/user/my-project');
  });

  test('skips entries without sessionId', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ sessionId: '', inputTokens: 1000 }),
      createEntry({ sessionId: 'valid-session', inputTokens: 500 }),
    ];

    const result = aggregateSessionUsage(entries);

    expect(result.length).toBe(1);
    expect(result[0].sessionId).toBe('valid-session');
  });

  test('sorts by last activity descending', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ sessionId: 'old-session', timestamp: '2025-12-01T10:00:00.000Z' }),
      createEntry({ sessionId: 'new-session', timestamp: '2025-12-09T10:00:00.000Z' }),
    ];

    const result = aggregateSessionUsage(entries);

    expect(result[0].sessionId).toBe('new-session');
    expect(result[1].sessionId).toBe('old-session');
  });

  test('propagates target metadata into session usage', () => {
    const entries: RawUsageEntry[] = [
      createEntry({ sessionId: 'session-A', target: 'droid' }),
      createEntry({ sessionId: 'session-B' }),
    ];

    const result = aggregateSessionUsage(entries);
    const sessionA = result.find((s) => s.sessionId === 'session-A');
    const sessionB = result.find((s) => s.sessionId === 'session-B');

    expect(sessionA?.target).toBe('droid');
    expect(sessionB?.target).toBeUndefined();
  });

  test('uses latest timestamp target when a session has mixed targets', () => {
    const entries: RawUsageEntry[] = [
      createEntry({
        sessionId: 'session-A',
        timestamp: '2025-12-09T10:00:00.000Z',
        target: 'claude',
      }),
      createEntry({
        sessionId: 'session-A',
        timestamp: '2025-12-09T12:00:00.000Z',
        target: 'droid',
      }),
      createEntry({
        sessionId: 'session-A',
        timestamp: '2025-12-09T11:00:00.000Z',
      }),
    ];

    const result = aggregateSessionUsage(entries);
    expect(result[0].target).toBe('droid');
  });

  test('returns empty array for no entries', () => {
    const result = aggregateSessionUsage([]);
    expect(result.length).toBe(0);
  });
});

// ============================================================================
// Integration: All token types
// ============================================================================

describe('token aggregation completeness', () => {
  test('aggregates all token types correctly', () => {
    const entries: RawUsageEntry[] = [
      createEntry({
        inputTokens: 100,
        outputTokens: 200,
        cacheCreationTokens: 50,
        cacheReadTokens: 25,
      }),
      createEntry({
        inputTokens: 150,
        outputTokens: 100,
        cacheCreationTokens: 30,
        cacheReadTokens: 10,
      }),
    ];

    const daily = aggregateDailyUsage(entries);

    expect(daily[0].inputTokens).toBe(250);
    expect(daily[0].outputTokens).toBe(300);
    expect(daily[0].cacheCreationTokens).toBe(80);
    expect(daily[0].cacheReadTokens).toBe(35);

    // Model breakdown should also have correct totals
    expect(daily[0].modelBreakdowns[0].inputTokens).toBe(250);
    expect(daily[0].modelBreakdowns[0].outputTokens).toBe(300);
    expect(daily[0].modelBreakdowns[0].cacheCreationTokens).toBe(80);
    expect(daily[0].modelBreakdowns[0].cacheReadTokens).toBe(35);
  });
});
