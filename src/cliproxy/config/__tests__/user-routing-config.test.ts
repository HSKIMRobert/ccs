import { describe, expect, it } from 'bun:test';
import {
  mergeOAuthModelAliases,
  parseOAuthModelAliasSection,
  serializeOAuthModelAliasBody,
} from '../oauth-model-alias-config';
import {
  mergePayloadConfig,
  parsePayloadSection,
  serializePayloadSection,
} from '../payload-rule-config';

describe('CLIProxy user routing config', () => {
  it('parses and round-trips provider aliases without dropping provider sections', () => {
    const body = `  codex:
    - name: gpt-5.6-sol
      alias: gpt-5.6-sol-fast
      fork: true
  future-provider:
    - name: upstream-model
      alias: client-model
`;

    const parsed = parseOAuthModelAliasSection(body);
    expect(parsed.codex).toEqual([{ name: 'gpt-5.6-sol', alias: 'gpt-5.6-sol-fast', fork: true }]);
    expect(parsed['future-provider']).toEqual([{ name: 'upstream-model', alias: 'client-model' }]);
    expect(parseOAuthModelAliasSection(serializeOAuthModelAliasBody(parsed))).toEqual(parsed);
  });

  it('preserves insertion order and deduplicates exact aliases while promoting fork', () => {
    const merged = mergeOAuthModelAliases(
      {
        codex: [
          { name: 'first-upstream', alias: 'first-client' },
          { name: 'gpt-5.6-sol', alias: 'gpt-5.6-sol-fast' },
        ],
      },
      {
        codex: [
          { name: 'gpt-5.6-sol', alias: 'gpt-5.6-sol-fast', fork: true },
          { name: 'last-upstream', alias: 'last-client' },
        ],
      }
    );

    expect(merged.codex).toEqual([
      { name: 'first-upstream', alias: 'first-client' },
      { name: 'gpt-5.6-sol', alias: 'gpt-5.6-sol-fast', fork: true },
      { name: 'last-upstream', alias: 'last-client' },
    ]);
  });

  it('lets configured aliases replace an existing provider client alias in place', () => {
    const merged = mergeOAuthModelAliases(
      {
        codex: [
          { name: 'first-upstream', alias: 'first-client' },
          { name: 'old-upstream', alias: 'gpt-5.6-sol-fast', fork: true },
          { name: 'last-upstream', alias: 'last-client' },
        ],
      },
      {
        codex: [{ name: 'gpt-5.6-sol', alias: 'gpt-5.6-sol-fast' }],
      }
    );

    expect(merged.codex).toEqual([
      { name: 'first-upstream', alias: 'first-client' },
      { name: 'gpt-5.6-sol', alias: 'gpt-5.6-sol-fast' },
      { name: 'last-upstream', alias: 'last-client' },
    ]);
  });

  it('round-trips unknown payload subsections and replaces matching scoped rules', () => {
    const existing = parsePayloadSection(`  default:
    - models:
        - name: keep-default
      params:
        temperature: 0.2
  override:
    - models:
        - name: gpt-5.6-sol-fast
          protocol: codex
      params:
        service_tier: standard
`);
    const configured = {
      override: [
        {
          models: [{ name: 'gpt-5.6-sol-fast', protocol: 'codex' }],
          params: { service_tier: 'priority' },
        },
      ],
    };

    const merged = mergePayloadConfig(existing, configured);
    expect(merged?.default).toBeDefined();
    expect(merged?.override).toEqual(configured.override);
    expect(parsePayloadSection(serializePayloadSection(merged).replace(/^payload:\n/, ''))).toEqual(
      merged
    );
  });

  it('preserves distinct full predicates that select the same model', () => {
    const existing = {
      override: [
        {
          models: [
            {
              name: 'gpt-5.6-sol-fast',
              protocol: 'codex',
              'from-protocol': 'openai',
            },
          ],
          headers: { 'x-tenant': 'alpha' },
          match: { project: '^priority-' },
          params: { service_tier: 'standard' },
        },
        {
          models: [{ name: 'gpt-5.6-sol-fast', protocol: 'codex' }],
          headers: { 'x-tenant': 'beta' },
          'not-match': { project: '^disabled-' },
          exist: ['metadata.project'],
          params: { service_tier: 'standard' },
        },
      ],
    };
    const configured = {
      override: [
        {
          models: [
            {
              protocol: 'codex',
              'from-protocol': 'openai',
              name: 'gpt-5.6-sol-fast',
            },
          ],
          match: { project: '^priority-' },
          headers: { 'x-tenant': 'alpha' },
          params: { service_tier: 'priority' },
        },
      ],
    };

    const merged = mergePayloadConfig(existing, configured);
    expect(merged?.override).toEqual([configured.override[0], existing.override[1]]);
    expect(parsePayloadSection(serializePayloadSection(merged).replace(/^payload:\n/, ''))).toEqual(
      merged
    );
  });
});
