import { ValidationError, AuthError } from '../../errors/error-types';
import { getUnsupportedAuthStartReason } from '../provider-capabilities';
import { CLIProxyBackend, CLIProxyProvider } from '../types';
import {
  getKiroCLIAuthFlag,
  getOAuthConfig,
  isKiroCLIAuthMethod,
  normalizeKiroAuthMethod,
  normalizeKiroIDCFlow,
  type OAuthOptions,
} from './auth-types';
import {
  getOAuthFlagCandidatesForProvider,
  resolveAdvertisedAuthFlag,
} from './oauth-cli-capabilities';

export function buildOAuthArgs(
  provider: CLIProxyProvider,
  configPath: string,
  headless: boolean,
  noIncognito: boolean,
  options: {
    advertisedFlags?: ReadonlySet<string>;
    backend?: CLIProxyBackend;
    kiroMethod?: OAuthOptions['kiroMethod'];
    kiroIDCStartUrl?: string;
    kiroIDCRegion?: string;
    kiroIDCFlow?: OAuthOptions['kiroIDCFlow'];
  } = {}
): string[] {
  const unsupportedReason = getUnsupportedAuthStartReason(provider);
  if (unsupportedReason) {
    throw new AuthError(unsupportedReason, provider);
  }

  const args = ['--config', configPath];
  const advertisedFlags = options.advertisedFlags;

  if (provider === 'kiro') {
    const method = normalizeKiroAuthMethod(options.kiroMethod);
    if (!isKiroCLIAuthMethod(method)) {
      throw new AuthError(`Kiro auth method '${method}' is not supported by CLI flow.`, 'kiro');
    }

    const selectedKiroFlag = advertisedFlags
      ? resolveAdvertisedAuthFlag(
          provider,
          getOAuthFlagCandidatesForProvider(provider, method),
          advertisedFlags,
          { backend: options.backend }
        )
      : getKiroCLIAuthFlag(method);

    if (method !== 'idc') {
      args.push(selectedKiroFlag);
    } else {
      const startUrl = options.kiroIDCStartUrl?.trim();
      if (!startUrl) {
        throw new ValidationError(
          'Kiro IDC login requires --kiro-idc-start-url',
          'kiroIDCStartUrl'
        );
      }

      args.push(selectedKiroFlag, '--kiro-idc-start-url', startUrl);
      const region = options.kiroIDCRegion?.trim();
      if (region) {
        args.push('--kiro-idc-region', region);
      }
      args.push('--kiro-idc-flow', normalizeKiroIDCFlow(options.kiroIDCFlow));
    }
  } else {
    args.push(
      advertisedFlags
        ? resolveAdvertisedAuthFlag(
            provider,
            getOAuthFlagCandidatesForProvider(provider),
            advertisedFlags,
            { backend: options.backend }
          )
        : getOAuthConfig(provider).authFlag
    );
  }

  if (headless) {
    args.push('--no-browser');
  }
  if (provider === 'kiro' && noIncognito) {
    args.push('--no-incognito');
  }

  return args;
}
