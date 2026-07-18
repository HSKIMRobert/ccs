/**
 * API Services
 *
 * Barrel export for API-related business logic services.
 */

// Validation services
export {
  validateApiName,
  validateApiNameSyntax,
  validateUrl,
  getUrlWarning,
  sanitizeBaseUrl,
} from './validation-service';

// Profile types
export {
  type ModelMapping,
  type ApiProfileInfo,
  type CliproxyVariantInfo,
  type ApiListResult,
  type CreateApiProfileResult,
  type CreateCliproxyBridgeProfileResult,
  type RemoveApiProfileResult,
  type UpdateApiProfileTargetResult,
  type CliproxyBridgeProviderInfo,
  type CliproxyBridgeMetadata,
  type ResolvedCliproxyBridgeProfile,
  type ProfileValidationIssue,
  type ProfileValidationSummary,
  type ApiProfileOrphanCandidate,
  type DiscoverApiProfileOrphansResult,
  type RegisterApiProfileOrphansResult,
  type CopyApiProfileResult,
  type ApiProfileExportBundle,
  type ExportApiProfileResult,
  type ImportApiProfileResult,
} from './profile-types';

// Profile read operations
export {
  apiProfileExists,
  isApiProfileConfigured,
  listApiProfiles,
  getApiProfileNames,
  isUsingUnifiedConfig,
} from './profile-reader';

// Profile write operations
export { createApiProfile, removeApiProfile, updateApiProfileTarget } from './profile-writer';
export { createCliproxyBridgeProfile } from './profile-writer';
export {
  getDefaultCliproxyBridgeName,
  listCliproxyBridgeProviders,
  resolveCliproxyBridgeMetadata,
  resolveCliproxyBridgeProfile,
  suggestCliproxyBridgeName,
} from './cliproxy-profile-bridge';

// Lifecycle validation and operations
export { validateApiProfileSettingsPayload } from './profile-lifecycle-validation';
export {
  discoverApiProfileOrphans,
  registerApiProfileOrphans,
  copyApiProfile,
  exportApiProfile,
  importApiProfileBundle,
} from './profile-lifecycle-service';

// OpenRouter catalog and picker
export { isOpenRouterUrl, fetchOpenRouterModels, type OpenRouterModel } from './openrouter-catalog';
export { pickOpenRouterModel, type OpenRouterSelection } from './openrouter-picker';
export {
  getLocalRuntimeReadiness,
  type LocalRuntimeId,
  type LocalRuntimeReadiness,
  type LocalRuntimeStatus,
} from './local-runtime-readiness';

// Provider presets for CLI
export {
  PROVIDER_PRESETS,
  PRESET_ALIASES,
  OPENROUTER_BASE_URL,
  getPresetById,
  getPresetAliases,
  getPresetIds,
  isValidPresetId,
  type ProviderPreset,
  type PresetCategory,
} from './provider-presets';
