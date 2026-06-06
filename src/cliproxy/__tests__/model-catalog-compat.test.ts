import { describe, it, expect } from 'bun:test';
import { findModel, supportsThinking } from '../model-catalog';
import { PROVIDER_TO_CHANNEL, SYNCABLE_PROVIDERS, mergeCatalog } from '../services/catalog-cache';

describe('model-catalog compatibility lookups', () => {
  it('finds agy Claude models using dotted major.minor IDs', () => {
    const dottedThinking = findModel('agy', 'claude-opus-4.6-thinking');
    const dottedNonThinking = findModel('agy', 'claude-sonnet-4.6');

    expect(dottedThinking?.id).toBe('claude-opus-4-6-thinking');
    expect(dottedNonThinking?.id).toBe('claude-sonnet-4-6');
  });

  it('maps legacy agy 4.5 IDs to canonical 4.6 catalog models', () => {
    const legacyOpusThinking = findModel('agy', 'claude-opus-4.5-thinking');
    const legacySonnetThinking = findModel('agy', 'claude-sonnet-4.5-thinking');
    const legacySonnet = findModel('agy', 'claude-sonnet-4.5');

    expect(legacyOpusThinking?.id).toBe('claude-opus-4-6-thinking');
    expect(legacySonnetThinking?.id).toBe('claude-sonnet-4-6');
    expect(legacySonnet?.id).toBe('claude-sonnet-4-6');
  });

  it('supports thinking checks for dotted agy model IDs', () => {
    expect(supportsThinking('agy', 'claude-opus-4.6-thinking')).toBe(true);
    expect(supportsThinking('agy', 'claude-sonnet-4.6')).toBe(true);
    expect(supportsThinking('agy', 'claude-opus-4.5-thinking')).toBe(true);
    expect(supportsThinking('agy', 'claude-sonnet-4.5')).toBe(true);
  });

  it('maps legacy sonnet 4.6 thinking aliases to canonical agy model', () => {
    const dottedLegacy = findModel('agy', 'claude-sonnet-4.6-thinking');
    const hyphenLegacy = findModel('agy', 'claude-sonnet-4-6-thinking');

    expect(dottedLegacy?.id).toBe('claude-sonnet-4-6');
    expect(hyphenLegacy?.id).toBe('claude-sonnet-4-6');
  });

  it('maps all dashboard providers to upstream catalog channels', () => {
    expect(SYNCABLE_PROVIDERS).toContain('qwen');
    expect(SYNCABLE_PROVIDERS).toContain('iflow');
    expect(SYNCABLE_PROVIDERS).toContain('kiro');
    expect(SYNCABLE_PROVIDERS).toContain('ghcp');
    expect(PROVIDER_TO_CHANNEL.ghcp).toBe('github-copilot');
  });

  it('does not re-add stale static-only models when live catalog data is present', () => {
    const catalog = mergeCatalog('gemini', [
      {
        id: 'gemini-2.5-pro',
        display_name: 'Gemini 2.5 Pro',
      },
    ]);

    expect(catalog?.models.map((model) => model.id)).toEqual(['gemini-2.5-pro']);
  });

  it('falls back to a visible live model when the static default is absent', () => {
    const catalog = mergeCatalog('gemini', [
      {
        id: 'gemini-live-only',
        display_name: 'Gemini Live Only',
      },
    ]);

    expect(catalog?.defaultModel).toBe('gemini-live-only');
    expect(catalog?.models.map((model) => model.id)).toContain(catalog?.defaultModel);
  });

  it('preserves static maxLevel when live thinking metadata omits it', () => {
    const catalog = mergeCatalog('claude', [
      {
        id: 'claude-opus-4-7',
        display_name: 'Claude Opus 4.7',
        thinking: {
          levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          dynamic_allowed: true,
        },
      },
    ]);

    expect(catalog?.models[0]?.thinking).toMatchObject({
      type: 'levels',
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      maxLevel: 'max',
      dynamicAllowed: true,
    });
  });
});
