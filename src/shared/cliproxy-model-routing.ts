export const MANAGED_MODEL_PREFIXES = {
  gemini: 'gcli',
  agy: 'agy',
} as const;

export type ManagedModelPrefixProvider = keyof typeof MANAGED_MODEL_PREFIXES;
export type ModelRoutingStatus = 'safe' | 'shadowed' | 'prefix-only';

export interface CatalogLikeModel {
  id: string;
  name?: string;
}

export interface CatalogLikeProvider {
  provider: string;
  displayName: string;
  models: CatalogLikeModel[];
}

export interface MergedModelLike {
  id: string;
  owned_by?: string;
  type?: string;
}

export interface CliproxyModelRoutingHint {
  modelId: string;
  modelName: string;
  prefix: string;
  pinnedModelId: string;
  recommendedModelId: string;
  pinnedAvailable: boolean;
  unprefixedStatus: ModelRoutingStatus;
  effectiveProvider: string | null;
  effectiveDisplayName: string | null;
  effectiveOwnedBy: string | null;
  summary: string;
}

export interface CliproxyProviderRoutingHints {
  provider: string;
  displayName: string;
  prefix: string;
  safeCount: number;
  shadowedCount: number;
  prefixOnlyCount: number;
  models: CliproxyModelRoutingHint[];
}

const PROVIDER_OWNER_HINTS: Record<string, string[]> = {
  gemini: ['google'],
  agy: ['antigravity'],
  claude: ['anthropic'],
  codex: ['openai'],
  qwen: ['alibaba', 'qwen'],
  iflow: ['iflow'],
  kimi: ['kimi', 'moonshot'],
  kiro: ['kiro', 'aws'],
  ghcp: ['github', 'copilot'],
  qoder: ['qoder'],
};

function normalize(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getManagedPrefix(provider: string): string | null {
  const normalizedProvider = normalize(provider);
  if (normalizedProvider in MANAGED_MODEL_PREFIXES) {
    return MANAGED_MODEL_PREFIXES[normalizedProvider as ManagedModelPrefixProvider];
  }
  return null;
}

function getDisplayName(
  provider: string,
  catalogs: Partial<Record<string, CatalogLikeProvider>>
): string | null {
  const normalizedProvider = normalize(provider);
  const catalog = catalogs[normalizedProvider];
  return catalog?.displayName?.trim() || null;
}

function inferProvider(model: MergedModelLike): string | null {
  const type = normalize(model.type);
  const owner = normalize(model.owned_by);

  const directMatches: Record<string, string> = {
    antigravity: 'agy',
    'github-copilot': 'ghcp',
    copilot: 'ghcp',
    anthropic: 'claude',
    'gemini-cli': 'gemini',
  };

  if (type && directMatches[type]) {
    return directMatches[type];
  }

  for (const [provider, hints] of Object.entries(PROVIDER_OWNER_HINTS)) {
    if (hints.some((hint) => type.includes(hint) || owner.includes(hint))) {
      return provider;
    }
  }

  return null;
}

function buildSummary(
  providerDisplayName: string,
  hint: Pick<
    CliproxyModelRoutingHint,
    'modelId' | 'pinnedModelId' | 'pinnedAvailable' | 'unprefixedStatus' | 'effectiveDisplayName'
  >
): string {
  if (!hint.pinnedAvailable) {
    return `${hint.modelId} does not currently advertise a live pinned route for ${hint.pinnedModelId}. Reconnect or refresh managed prefixes before treating it as pinned.`;
  }

  if (hint.unprefixedStatus === 'safe') {
    return `${hint.modelId} currently resolves to ${providerDisplayName}. Use ${hint.pinnedModelId} to keep it pinned.`;
  }

  if (hint.unprefixedStatus === 'shadowed' && hint.effectiveDisplayName) {
    return `${hint.modelId} currently resolves to ${hint.effectiveDisplayName}. Use ${hint.pinnedModelId} to force ${providerDisplayName}.`;
  }

  return `${hint.modelId} is not advertised unprefixed right now. Use ${hint.pinnedModelId} to target ${providerDisplayName}.`;
}

export function buildCliproxyRoutingHints(
  catalogs: Partial<Record<string, CatalogLikeProvider>>,
  mergedModels: MergedModelLike[]
): Partial<Record<string, CliproxyProviderRoutingHints>> {
  const mergedModelMap = new Map<string, MergedModelLike>();
  for (const model of mergedModels) {
    const key = normalize(model.id);
    if (key && !mergedModelMap.has(key)) {
      mergedModelMap.set(key, model);
    }
  }

  const result: Partial<Record<string, CliproxyProviderRoutingHints>> = {};

  for (const [providerKey, catalog] of Object.entries(catalogs)) {
    if (!catalog) {
      continue;
    }

    const prefix = getManagedPrefix(providerKey);
    if (!prefix) {
      continue;
    }

    let safeCount = 0;
    let shadowedCount = 0;
    let prefixOnlyCount = 0;

    const models = catalog.models.map((model) => {
      const pinnedCandidates = mergedModels
        .filter((candidate) => normalize(candidate.id).endsWith(`/${normalize(model.id)}`))
        .filter((candidate) => inferProvider(candidate) === providerKey)
        .map((candidate) => candidate.id)
        .sort((left, right) => left.localeCompare(right));
      const managedPinnedId = `${prefix}/${model.id}`;
      const pinnedAvailable = pinnedCandidates.includes(managedPinnedId);
      const mergedModel = mergedModelMap.get(normalize(model.id));
      const effectiveProvider = mergedModel ? inferProvider(mergedModel) : null;
      const effectiveDisplayName =
        effectiveProvider && getDisplayName(effectiveProvider, catalogs)
          ? getDisplayName(effectiveProvider, catalogs)
          : mergedModel?.owned_by?.trim() || null;

      let unprefixedStatus: ModelRoutingStatus = 'prefix-only';
      if (!mergedModel) {
        prefixOnlyCount += 1;
      } else if (effectiveProvider === providerKey) {
        unprefixedStatus = 'safe';
        safeCount += 1;
      } else {
        unprefixedStatus = 'shadowed';
        shadowedCount += 1;
      }

      const hint: CliproxyModelRoutingHint = {
        modelId: model.id,
        modelName: model.name?.trim() || model.id,
        prefix,
        pinnedModelId: managedPinnedId,
        recommendedModelId: managedPinnedId,
        pinnedAvailable,
        unprefixedStatus,
        effectiveProvider,
        effectiveDisplayName,
        effectiveOwnedBy: mergedModel?.owned_by?.trim() || null,
        summary: '',
      };

      hint.summary = buildSummary(catalog.displayName, hint);
      return hint;
    });

    result[providerKey] = {
      provider: providerKey,
      displayName: catalog.displayName,
      prefix,
      safeCount,
      shadowedCount,
      prefixOnlyCount,
      models,
    };
  }

  return result;
}

export function getManagedModelPrefix(provider: string): string | null {
  return getManagedPrefix(provider);
}
