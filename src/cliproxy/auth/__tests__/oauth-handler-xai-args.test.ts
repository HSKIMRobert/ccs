import { describe, expect, it } from 'bun:test';
import { buildOAuthArgs } from '../oauth-cli-args';

describe('xAI OAuth process arguments', () => {
  it('starts CLIProxy device auth without a callback port argument', () => {
    expect(buildOAuthArgs('xai', '/tmp/cliproxy-config.yaml', false, false)).toEqual([
      '--config',
      '/tmp/cliproxy-config.yaml',
      '--xai-login',
    ]);
  });

  it('uses no-browser mode in headless environments', () => {
    expect(buildOAuthArgs('xai', '/tmp/cliproxy-config.yaml', true, false)).toContain(
      '--no-browser'
    );
  });
});
