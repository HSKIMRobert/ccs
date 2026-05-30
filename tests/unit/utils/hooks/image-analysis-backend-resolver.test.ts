import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_IMAGE_ANALYSIS_CONFIG,
  type ImageAnalysisConfig,
} from '../../../../src/config/unified-config-types';
import { findModel } from '../../../../src/cliproxy/model-catalog';
import {
  canonicalizeImageAnalysisConfig,
  resolveImageAnalysisStatus,
} from '../../../../src/utils/hooks/image-analysis-backend-resolver';

describe('image-analysis-backend-resolver', () => {
  it('uses a catalog-backed Claude image analysis default model', () => {
    const defaultModel = DEFAULT_IMAGE_ANALYSIS_CONFIG.provider_models.claude;

    expect(defaultModel).toBe('claude-haiku-4-5-20251001');
    expect(findModel('claude', defaultModel)?.id).toBe(defaultModel);
  });

  it('canonicalizes provider aliases in config', () => {
    const config = canonicalizeImageAnalysisConfig({
      enabled: true,
      timeout: 60,
      provider_models: {
        copilot: 'claude-haiku-4.5',
        gemini: 'gemini-2.5-flash',
      },
      fallback_backend: 'Gemini',
      profile_backends: {
        orq: 'copilot',
      },
    });

    expect(config.provider_models.ghcp).toBe('claude-haiku-4.5');
    expect(config.provider_models.copilot).toBeUndefined();
    expect(config.fallback_backend).toBe('gemini');
    expect(config.profile_backends?.orq).toBe('ghcp');
  });

  it('resolves copilot to the ghcp backend without a duplicate provider key', () => {
    const status = resolveImageAnalysisStatus(
      {
        profileName: 'copilot',
        profileType: 'copilot',
      },
      DEFAULT_IMAGE_ANALYSIS_CONFIG
    );

    expect(status.supported).toBe(true);
    expect(status.backendId).toBe('ghcp');
    expect(status.model).toBe('claude-haiku-4.5');
    expect(status.resolutionSource).toBe('copilot-alias');
  });

  it('does not route cursor image analysis through the fallback backend by default', () => {
    const status = resolveImageAnalysisStatus(
      {
        profileName: 'cursor',
        profileType: 'cursor',
      },
      DEFAULT_IMAGE_ANALYSIS_CONFIG
    );

    expect(status.supported).toBe(false);
    expect(status.backendId).toBeNull();
    expect(status.status).toBe('skipped');
    expect(status.resolutionSource).toBe('unresolved');
    expect(status.reason).toContain('profile_backends.cursor');
  });

  it('allows cursor image analysis only when explicitly mapped to a backend', () => {
    const config: ImageAnalysisConfig = {
      ...DEFAULT_IMAGE_ANALYSIS_CONFIG,
      profile_backends: {
        cursor: 'ghcp',
      },
    };

    const status = resolveImageAnalysisStatus(
      {
        profileName: 'cursor',
        profileType: 'cursor',
      },
      config
    );

    expect(status.supported).toBe(true);
    expect(status.backendId).toBe('ghcp');
    expect(status.status).toBe('mapped');
    expect(status.resolutionSource).toBe('profile-backend');
  });

  it('treats cliproxy cursor as a provider-backed profile rather than a legacy bridge alias', () => {
    const status = resolveImageAnalysisStatus(
      {
        profileName: 'cursor',
        profileType: 'cliproxy',
        cliproxyProvider: 'cursor',
      },
      DEFAULT_IMAGE_ANALYSIS_CONFIG
    );

    expect(status.backendId).toBe('cursor');
    expect(status.resolutionSource).toBe('cliproxy-provider');
    expect(status.reason).toContain('no image-analysis model configured');
  });

  it('uses the fallback backend for an unmapped third-party settings profile', () => {
    const status = resolveImageAnalysisStatus(
      {
        profileName: 'glm',
        profileType: 'settings',
        settings: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.z.ai/v1',
            ANTHROPIC_AUTH_TOKEN: 'glm-test-key',
          },
        },
      },
      DEFAULT_IMAGE_ANALYSIS_CONFIG
    );

    expect(status.supported).toBe(true);
    expect(status.backendId).toBe('gemini');
    expect(status.resolutionSource).toBe('fallback-backend');
    expect(status.model).toBe('gemini-3-flash-preview');
  });

  it('keeps direct Anthropic settings profiles on native read unless explicitly mapped', () => {
    const status = resolveImageAnalysisStatus(
      {
        profileName: 'claude-direct',
        profileType: 'settings',
        settings: {
          env: {
            ANTHROPIC_API_KEY: 'anthropic-test-key',
          },
        },
      },
      DEFAULT_IMAGE_ANALYSIS_CONFIG
    );

    expect(status.supported).toBe(false);
    expect(status.backendId).toBeNull();
    expect(status.status).toBe('skipped');
    expect(status.shouldPersistHook).toBe(false);
    expect(status.reason).toContain('native file access');
  });

  it('uses explicit profile_backends overrides for custom aliases', () => {
    const config: ImageAnalysisConfig = {
      ...DEFAULT_IMAGE_ANALYSIS_CONFIG,
      profile_backends: {
        orq: 'copilot',
      },
    };

    const status = resolveImageAnalysisStatus(
      {
        profileName: 'orq',
        profileType: 'settings',
      },
      config
    );

    expect(status.supported).toBe(true);
    expect(status.status).toBe('mapped');
    expect(status.backendId).toBe('ghcp');
    expect(status.resolutionSource).toBe('profile-backend');
  });

  it('lets explicit profile_backends overrides win over cliproxy provider inference', () => {
    const config: ImageAnalysisConfig = {
      ...DEFAULT_IMAGE_ANALYSIS_CONFIG,
      profile_backends: {
        glmv: 'ghcp',
      },
    };

    const status = resolveImageAnalysisStatus(
      {
        profileName: 'glmv',
        profileType: 'cliproxy',
        cliproxyProvider: 'gemini',
      },
      config
    );

    expect(status.supported).toBe(true);
    expect(status.status).toBe('mapped');
    expect(status.backendId).toBe('ghcp');
    expect(status.resolutionSource).toBe('profile-backend');
  });

  it('reports hook-missing when the profile should persist a hook but it is absent', () => {
    const status = resolveImageAnalysisStatus(
      {
        profileName: 'glm',
        profileType: 'settings',
        settings: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.z.ai/v1',
            ANTHROPIC_AUTH_TOKEN: 'glm-test-key',
          },
        },
        hookInstalled: false,
        sharedHookInstalled: true,
      },
      DEFAULT_IMAGE_ANALYSIS_CONFIG
    );

    expect(status.status).toBe('hook-missing');
    expect(status.reason).toContain('Profile hook is missing');
  });

  it('prefers native image reading when the profile settings opt into it', () => {
    const status = resolveImageAnalysisStatus(
      {
        profileName: 'glmv',
        profileType: 'settings',
        settings: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.z.ai/v1',
            ANTHROPIC_MODEL: 'glm-4.5v',
            ANTHROPIC_AUTH_TOKEN: 'glm-test-key',
          },
          ccs_image: {
            native_read: true,
          },
        },
      },
      DEFAULT_IMAGE_ANALYSIS_CONFIG
    );

    expect(status.backendId).toBeNull();
    expect(status.resolutionSource).toBe('native-compatible');
    expect(status.nativeReadPreference).toBe(true);
    expect(status.profileModel).toBe('glm-4.5v');
    expect(status.nativeImageCapable).toBe(true);
    expect(status.shouldPersistHook).toBe(false);
    expect(status.effectiveRuntimeMode).toBe('native-read');
  });
});
