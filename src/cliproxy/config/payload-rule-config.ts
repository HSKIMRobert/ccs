/** Parse, merge, and serialize user-owned CLIProxy payload rules. */

import * as yaml from 'js-yaml';
import type {
  CLIProxyPayloadConfig,
  CLIProxyPayloadModelSelector,
  CLIProxyPayloadOverrideRule,
} from '../../config/schemas/cliproxy';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidModelSelector(value: unknown): value is CLIProxyPayloadModelSelector {
  if (!isRecord(value) || typeof value.name !== 'string') {
    return false;
  }

  return value.name.trim().length > 0;
}

function cloneOverrideRule(value: unknown): CLIProxyPayloadOverrideRule | null {
  if (!isRecord(value) || !Array.isArray(value.models) || !isRecord(value.params)) {
    return null;
  }

  if (value.models.length === 0 || !value.models.every(isValidModelSelector)) {
    return null;
  }

  return structuredClone(value) as CLIProxyPayloadOverrideRule;
}

function canonicalizeForKey(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeForKey);
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeForKey(value[key])])
  );
}

function predicateKey(rule: CLIProxyPayloadOverrideRule): string {
  const predicate = Object.fromEntries(Object.entries(rule).filter(([key]) => key !== 'params'));
  return JSON.stringify(canonicalizeForKey(predicate));
}

export function parsePayloadSection(body: string): CLIProxyPayloadConfig | undefined {
  if (!body.trim()) {
    return undefined;
  }

  try {
    const parsed = yaml.load(`payload:\n${body}`);
    if (!isRecord(parsed) || !isRecord(parsed.payload)) {
      return undefined;
    }
    return parsed.payload as CLIProxyPayloadConfig;
  } catch {
    return undefined;
  }
}

export function mergePayloadConfig(
  existing?: CLIProxyPayloadConfig,
  configured?: CLIProxyPayloadConfig
): CLIProxyPayloadConfig | undefined {
  const existingConfig = isRecord(existing) ? (existing as CLIProxyPayloadConfig) : undefined;
  const configuredConfig = isRecord(configured) ? (configured as CLIProxyPayloadConfig) : undefined;
  if (!existingConfig && !configuredConfig) {
    return undefined;
  }

  const merged: CLIProxyPayloadConfig = {
    ...(existingConfig ?? {}),
    ...(configuredConfig ?? {}),
  };
  const rules: CLIProxyPayloadOverrideRule[] = [];
  const indexByPredicate = new Map<string, number>();

  const addRules = (rawRules: unknown, replaceMatching: boolean) => {
    if (!Array.isArray(rawRules)) {
      return;
    }

    for (const rawRule of rawRules) {
      const rule = cloneOverrideRule(rawRule);
      if (!rule) {
        continue;
      }

      const key = predicateKey(rule);
      const existingIndex = indexByPredicate.get(key);
      if (existingIndex !== undefined) {
        if (replaceMatching) {
          rules[existingIndex] = rule;
        }
        continue;
      }

      indexByPredicate.set(key, rules.length);
      rules.push(rule);
    }
  };

  addRules(existingConfig?.override, false);
  addRules(configuredConfig?.override, true);

  if (rules.length > 0) {
    merged.override = rules;
  } else {
    delete merged.override;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function serializePayloadSection(config?: CLIProxyPayloadConfig): string {
  if (!config || Object.keys(config).length === 0) {
    return '';
  }

  return yaml
    .dump(
      { payload: config },
      {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        noCompatMode: true,
        quotingType: '"',
      }
    )
    .trimEnd();
}
