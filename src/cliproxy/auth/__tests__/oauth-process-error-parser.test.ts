import { describe, expect, it } from 'bun:test';
import {
  analyzeSuccessfulAuthExit,
  extractLikelyAuthFailureFromLogs,
  extractLikelyAuthFailureFromStderr,
  extractLikelyOAuthAuthorizationUrl,
  extractDeviceCodePrompt,
  getExpectedLocalCallback,
  getKiroBuilderIdSelectionInput,
  validateManualCallbackUrl,
} from '../oauth-process';

describe('oauth-process device code parsing', () => {
  it('parses the xAI device authorization output contract', () => {
    const output = `
To authenticate, please visit:
https://accounts.x.ai/oauth2/device?user_code=ABCD-1234

Then enter this code: ABCD-1234
`;

    expect(extractDeviceCodePrompt(output)).toEqual({
      userCode: 'ABCD-1234',
      verificationUrl: 'https://accounts.x.ai/oauth2/device?user_code=ABCD-1234',
    });
  });
});

describe('oauth-process stderr parsing', () => {
  it('does not match provider-specific patterns for other providers', () => {
    const stderr =
      'time="2026-03-03T10:00:00Z" level=error msg="GitHub Copilot authentication failed: example"';

    expect(extractLikelyAuthFailureFromStderr('qwen', stderr)).toBeNull();
  });

  it('extracts copilot verification failures from logrus lines', () => {
    const stderr =
      'time="2026-03-03T10:00:00Z" level=error msg="GitHub Copilot authentication failed: github-copilot: failed to verify Copilot access - you may not have an active Copilot subscription: 403 Forbidden"';

    expect(extractLikelyAuthFailureFromStderr('ghcp', stderr)).toBe(
      'github-copilot: failed to verify Copilot access - you may not have an active Copilot subscription: 403 Forbidden'
    );
  });

  it('extracts generic authentication failure lines', () => {
    const stderr = 'level=error msg="Authentication failed: state mismatch"';

    expect(extractLikelyAuthFailureFromStderr('ghcp', stderr)).toBe('state mismatch');
  });

  it('caps extracted message length to prevent noisy broadcasts', () => {
    const longSuffix = 'x'.repeat(400);
    const stderr = `level=error msg="Authentication failed: ${longSuffix}"`;

    const parsed = extractLikelyAuthFailureFromStderr('ghcp', stderr);
    expect(parsed).not.toBeNull();
    expect((parsed as string).length).toBe(240);
  });

  it('extracts kiro IDC failures from verbose stdout logs', () => {
    const logData =
      '[2026-04-07 11:01:21] [--------] [error] [kiro_login.go:236] Kiro IDC authentication failed: login failed: failed to register client: register client failed (status 400)';

    expect(extractLikelyAuthFailureFromLogs('kiro', logData)).toBe(
      'login failed: failed to register client: register client failed (status 400)'
    );
  });
});

describe('oauth-process successful exit analysis', () => {
  it('treats unchanged existing kiro tokens as a failed add-account attempt', () => {
    const result = analyzeSuccessfulAuthExit({
      provider: 'kiro',
      knownTokenFiles: [{ file: 'kiro-existing.json', mtimeMs: 100, fingerprint: 'same' }],
      currentTokenFiles: [{ file: 'kiro-existing.json', mtimeMs: 100, fingerprint: 'same' }],
      stdoutData:
        '[error] Kiro IDC authentication failed: login failed: failed to register client: register client failed (status 400)',
      stderrData: '',
    });

    expect(result.tokenSnapshot).toBeNull();
    expect(result.failureReason).toBe(
      'login failed: failed to register client: register client failed (status 400)'
    );
  });

  it('treats a refreshed token file as success during reauth', () => {
    const result = analyzeSuccessfulAuthExit({
      provider: 'kiro',
      knownTokenFiles: [
        {
          file: 'kiro-existing.json',
          mtimeMs: 100,
          accountId: 'kiro-existing',
          fingerprint: 'before',
        },
      ],
      currentTokenFiles: [
        {
          file: 'kiro-existing.json',
          mtimeMs: 250,
          accountId: 'kiro-existing',
          fingerprint: 'after',
        },
      ],
      expectedAccountId: 'kiro-existing.json',
      stdoutData: '',
      stderrData: '',
    });

    expect(result.tokenSnapshot?.file).toBe('kiro-existing.json');
    expect(result.failureReason).toBeNull();
  });

  it('ignores unrelated new token files during reauth', () => {
    const result = analyzeSuccessfulAuthExit({
      provider: 'kiro',
      knownTokenFiles: [
        {
          file: 'kiro-existing.json',
          mtimeMs: 100,
          accountId: 'kiro-existing',
          fingerprint: 'before',
        },
      ],
      currentTokenFiles: [
        {
          file: 'kiro-existing.json',
          mtimeMs: 100,
          accountId: 'kiro-existing',
          fingerprint: 'before',
        },
        {
          file: 'kiro-other.json',
          mtimeMs: 150,
          accountId: 'kiro-other',
          fingerprint: 'other-after',
        },
      ],
      expectedAccountId: 'kiro-existing',
      stdoutData: '',
      stderrData: '',
    });

    expect(result.tokenSnapshot).toBeNull();
    expect(result.failureReason).toBeNull();
  });

  it('treats fingerprint changes as success even when mtime is unchanged', () => {
    const result = analyzeSuccessfulAuthExit({
      provider: 'kiro',
      knownTokenFiles: [
        {
          file: 'kiro-existing.json',
          mtimeMs: 100,
          accountId: 'kiro-existing',
          fingerprint: 'before',
        },
      ],
      currentTokenFiles: [
        {
          file: 'kiro-existing.json',
          mtimeMs: 100,
          accountId: 'kiro-existing',
          fingerprint: 'after',
        },
      ],
      expectedAccountId: 'kiro-existing',
      stdoutData: '',
      stderrData: '',
    });

    expect(result.tokenSnapshot?.file).toBe('kiro-existing.json');
    expect(result.failureReason).toBeNull();
  });
});

describe('oauth-process manual callback validation', () => {
  const authUrl =
    'https://oidc.example.com/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Foauth%2Fcallback&state=test-state';

  it('extracts the expected local callback target from the auth URL', () => {
    expect(getExpectedLocalCallback(authUrl)).toEqual({
      origin: 'http://127.0.0.1:9876',
      pathname: '/oauth/callback',
      state: 'test-state',
    });
  });

  it('accepts matching loopback callback URLs', () => {
    expect(
      validateManualCallbackUrl(
        'http://127.0.0.1:9876/oauth/callback?code=abc123&state=test-state',
        authUrl
      )
    ).toBeNull();
  });

  it('rejects non-loopback callback URLs', () => {
    expect(
      validateManualCallbackUrl(
        'https://evil.example.com/oauth/callback?code=abc123&state=test-state',
        authUrl
      )
    ).toContain('local OAuth callback server');
  });

  it('rejects callback URLs with the wrong path or state', () => {
    expect(
      validateManualCallbackUrl(
        'http://127.0.0.1:9876/not-the-callback?code=abc123&state=test-state',
        authUrl
      )
    ).toContain('expected local OAuth callback target');

    expect(
      validateManualCallbackUrl(
        'http://127.0.0.1:9876/oauth/callback?code=abc123&state=wrong-state',
        authUrl
      )
    ).toContain('state does not match');
  });
});

describe('oauth-process Kiro Builder ID menu parsing', () => {
  it('selects Builder ID when it is the first option', () => {
    const output = `
? Select login method:
  1) Use with Builder ID (personal AWS account)
  2) Use with IDC Account (organization SSO)
`;

    expect(getKiroBuilderIdSelectionInput(output)).toBe('1\n');
  });

  it('selects the Builder ID option even when upstream reorders the menu', () => {
    const output = `
Select login method
1. IAM Identity Center
2. AWS Builder ID
`;

    expect(getKiroBuilderIdSelectionInput(output)).toBe('2\n');
  });

  it('returns null when the Builder ID option is not present in the prompt window', () => {
    const output = `
Select login method
1. IAM Identity Center
2. Google
`;

    expect(getKiroBuilderIdSelectionInput(output)).toBeNull();
  });
});

describe('oauth-process OAuth URL extraction', () => {
  it('prefers the real auth URL over the IDC start URL banner', () => {
    const authUrl =
      'https://oidc.us-east-1.amazonaws.com/authorize?response_type=code&client_id=test-client&redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Foauth%2Fcallback&state=test-state&code_challenge=test-challenge&code_challenge_method=S256';
    const output = `
Using IDC with Start URL: https://d-123.awsapps.com/start
Region: us-east-1
URL: ${authUrl}
`;

    expect(extractLikelyOAuthAuthorizationUrl(output)).toBe(authUrl);
  });

  it('ignores local callback server URLs when the auth URL is also present', () => {
    const authUrl =
      'https://device.sso.us-east-1.amazonaws.com/authorize?response_type=code&client_id=test-client&redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Foauth%2Fcallback&state=test-state&code_challenge=test-challenge&code_challenge_method=S256';
    const output = `
Callback server started, redirect URI: http://127.0.0.1:9876/oauth/callback
URL: ${authUrl}
`;

    expect(extractLikelyOAuthAuthorizationUrl(output)).toBe(authUrl);
  });
});
