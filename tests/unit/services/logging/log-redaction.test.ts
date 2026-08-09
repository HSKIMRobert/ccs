import { describe, expect, it } from 'bun:test';
import {
  maskSecretTokens,
  redactContext,
  redactErrorInfo,
} from '../../../../src/services/logging/log-redaction';

describe('log redaction', () => {
  it('redacts sensitive keys and preserves non-sensitive values', () => {
    const redacted = redactContext({
      token: 'secret-token',
      api_key: 'secret-key',
      safe: 'kept',
      count: 3,
      enabled: true,
    });

    expect(redacted).toEqual({
      token: '[redacted]',
      api_key: '[redacted]',
      safe: 'kept',
      count: 3,
      enabled: true,
    });
  });

  it('sanitizes nested objects and arrays recursively', () => {
    const redacted = redactContext({
      request: {
        headers: {
          authorization: 'Bearer abc',
          cookie: 'session=123',
        },
        steps: [
          { secret: 'hidden' },
          { label: 'safe-step' },
          ['nested-array', { password_hash: 'hidden-hash' }],
        ],
      },
    });

    expect(redacted).toEqual({
      request: {
        headers: {
          authorization: '[redacted]',
          cookie: '[redacted]',
        },
        steps: [
          { secret: '[redacted]' },
          { label: 'safe-step' },
          ['nested-array', { password_hash: '[redacted]' }],
        ],
      },
    });
  });

  it('caps recursive depth, truncates long strings, and preserves nullish values', () => {
    const deeplyNested = {
      first: {
        second: {
          third: {
            fourth: {
              fifth: {
                sixth: 'too-deep',
              },
            },
          },
        },
      },
    };
    const longValue = 'a'.repeat(2_500);

    const redacted = redactContext({
      nested: deeplyNested,
      longValue,
      nothing: null,
      missing: undefined,
    });

    expect(redacted.nested).toEqual({
      first: {
        second: {
          third: {
            fourth: '[max-depth]',
          },
        },
      },
    });
    expect(redacted.longValue).toBe(`${'a'.repeat(2_000)}...[truncated]`);
    expect(redacted.nothing).toBeNull();
    expect(redacted.missing).toBeUndefined();
  });

  it('reduces Error instances to safe name and message fields', () => {
    const error = new Error('boom'.repeat(700));
    error.name = 'ExplodedError';

    const redacted = redactContext({ error });

    expect(redacted).toEqual({
      error: {
        name: 'ExplodedError',
        message: `${'boom'.repeat(500)}...[truncated]`,
      },
    });
  });

  it('redacts proxy URL userinfo from nested error causes', () => {
    const redacted = redactErrorInfo({
      name: 'TypeError',
      message: 'fetch failed',
      cause: {
        name: 'ProxyError',
        code: 'ECONNREFUSED',
        message: 'connect http://sentinel-user:sentinel-password@proxy.example:8080',
      },
    });

    expect(redacted?.cause).toEqual({
      name: 'ProxyError',
      code: 'ECONNREFUSED',
      message: 'connect http://[redacted]@proxy.example:8080',
    });
    expect(JSON.stringify(redacted)).not.toContain('sentinel-user');
    expect(JSON.stringify(redacted)).not.toContain('sentinel-password');
  });

  it('redacts URL userinfo without changing non-credential URLs', () => {
    expect(maskSecretTokens('https://user:pass@example.com/path')).toBe(
      'https://[redacted]@example.com/path'
    );
    expect(maskSecretTokens('https://example.com/path')).toBe('https://example.com/path');
  });
});
