import { describe, expect, it } from 'vitest';
import { MODEL_CATALOGS } from '@/lib/model-catalogs';

describe('xAI model catalog defaults', () => {
  it('mirrors the CLIProxyAPI text catalog and default tier routing', () => {
    const catalog = MODEL_CATALOGS.xai;
    const ids = catalog.models.map((model) => model.id);
    const defaultModel = catalog.models.find((model) => model.id === catalog.defaultModel);

    expect(catalog.displayName).toBe('xAI (Grok)');
    expect(catalog.defaultModel).toBe('grok-build-0.1');
    expect(ids).toEqual([
      'grok-build-0.1',
      'grok-4.5',
      'grok-4.3',
      'grok-4.20-0309-reasoning',
      'grok-4.20-0309-non-reasoning',
      'grok-4.20-multi-agent-0309',
      'grok-3-mini',
      'grok-3-mini-fast',
      'grok-composer-2.5-fast',
    ]);
    expect(defaultModel?.presetMapping).toEqual({
      default: 'grok-build-0.1',
      opus: 'grok-4.5',
      sonnet: 'grok-build-0.1',
      haiku: 'grok-composer-2.5-fast',
    });
  });
});
