import { describe, expect, it } from 'bun:test';
import {
  getManagementAuthUrlPath,
  getPasteCallbackStartPath,
  getManagementOAuthCallbackPath,
} from '../auth-types';

describe('auth-types paste-callback start path', () => {
  it('maps providers to CLIProxyAPI management auth-url routes', () => {
    expect(getPasteCallbackStartPath('gemini')).toBe(
      '/v0/management/gemini-cli-auth-url?is_webui=true'
    );
    expect(getPasteCallbackStartPath('codex')).toBe('/v0/management/codex-auth-url?is_webui=true');
    expect(getPasteCallbackStartPath('xai')).toBe('/v0/management/xai-auth-url?is_webui=true');
    expect(getPasteCallbackStartPath('agy')).toBe(
      '/v0/management/antigravity-auth-url?is_webui=true'
    );
    expect(getPasteCallbackStartPath('claude')).toBe(
      '/v0/management/anthropic-auth-url?is_webui=true'
    );
    expect(getPasteCallbackStartPath('ghcp')).toBe('/v0/management/github-auth-url?is_webui=true');
  });

  it('maps Kiro management-supported methods to the management auth-url route', () => {
    expect(getPasteCallbackStartPath('kiro')).toBe(
      '/v0/management/kiro-auth-url?is_webui=true&method=aws'
    );
    expect(getPasteCallbackStartPath('kiro', { kiroMethod: 'google' })).toBe(
      '/v0/management/kiro-auth-url?is_webui=true&method=google'
    );
  });

  it('returns null for Kiro CLI-only paste-callback modes', () => {
    expect(getPasteCallbackStartPath('kiro', { kiroMethod: 'aws-authcode' })).toBeNull();
    expect(getPasteCallbackStartPath('kiro', { kiroMethod: 'idc' })).toBeNull();
  });

  it('still exposes the generic management auth-url helper', () => {
    expect(getManagementAuthUrlPath('kiro')).toBe('/v0/management/kiro-auth-url?is_webui=true');
  });

  it('uses CLIProxyAPI management oauth-callback route', () => {
    expect(getManagementOAuthCallbackPath()).toBe('/v0/management/oauth-callback');
  });
});
