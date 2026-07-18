import { describe, expect, test } from 'bun:test';

import {
  parseProfileArgs,
  validateVariantCreateName,
} from '../../../src/commands/cliproxy/variant-subcommand';

describe('cliproxy variant arg parser', () => {
  test('parses --target value form', () => {
    const parsed = parseProfileArgs(['variant-a', '--target', 'droid']);

    expect(parsed.name).toBe('variant-a');
    expect(parsed.target).toBe('droid');
    expect(parsed.errors).toEqual([]);
  });

  test('parses --target=value form', () => {
    const parsed = parseProfileArgs(['variant-a', '--target=droid']);

    expect(parsed.name).toBe('variant-a');
    expect(parsed.target).toBe('droid');
    expect(parsed.errors).toEqual([]);
  });

  test('collects missing value error for --target with no value', () => {
    const parsed = parseProfileArgs(['variant-a', '--target']);

    expect(parsed.target).toBeUndefined();
    expect(parsed.errors).toEqual(['Missing value for --target']);
  });

  test('accepts codex as a persisted variant target value', () => {
    const parsed = parseProfileArgs(['variant-a', '--target', 'codex']);

    expect(parsed.target).toBe('codex');
    expect(parsed.errors).toEqual([]);
  });

  test('uses last --target value when repeated', () => {
    const parsed = parseProfileArgs(['variant-a', '--target', 'claude', '--target=droid']);

    expect(parsed.target).toBe('droid');
    expect(parsed.errors).toEqual([]);
  });

  test('supports option terminator for variant names that start with dash', () => {
    const parsed = parseProfileArgs(['--yes', '--', '-variant-a']);

    expect(parsed.yes).toBe(true);
    expect(parsed.name).toBe('-variant-a');
    expect(parsed.errors).toEqual([]);
  });

  test('does not parse flags after option terminator', () => {
    const parsed = parseProfileArgs(['--', '--target', 'droid']);

    expect(parsed.target).toBeUndefined();
    expect(parsed.name).toBe('--target');
    expect(parsed.errors).toEqual([]);
  });
});

describe('cliproxy variant create name policy', () => {
  test('allows force repair of an exact existing grandfathered variant', () => {
    expect(validateVariantCreateName('xai', true, true)).toBeNull();
    expect(validateVariantCreateName('GROK', true, true)).toBeNull();
  });

  test('keeps absent, non-force, and other reserved variant names blocked', () => {
    expect(validateVariantCreateName('xai', true, false)).toContain('reserved name');
    expect(validateVariantCreateName('xai', false, true)).toContain('reserved name');
    expect(validateVariantCreateName('gemini', true, true)).toContain('reserved name');
  });
});
