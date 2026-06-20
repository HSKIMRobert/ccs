import { loadOrCreateUnifiedConfig } from '../../config/config-loader-facade';
import { DEFAULT_BACKEND } from '../binary/platform-detector';
import type { CLIProxyBackend, CLIProxyProvider } from '../types';

export function getConfiguredCliproxyBackend(): CLIProxyBackend {
  try {
    const backend = loadOrCreateUnifiedConfig().cliproxy?.backend;
    return backend === 'plus' || backend === 'original' ? backend : DEFAULT_BACKEND;
  } catch {
    return DEFAULT_BACKEND;
  }
}

export function usesScopedProviderRoutes(
  backend: CLIProxyBackend = getConfiguredCliproxyBackend()
): boolean {
  return backend === 'plus';
}

/**
 * Return the CLIProxy route path for a provider.
 *
 * The original backend routes Claude-compatible traffic at the root and relies
 * on model-based provider selection. The Plus backend exposes provider-scoped
 * routes for non-Claude providers.
 */
export function buildCliproxyProviderPath(
  provider: CLIProxyProvider,
  backend: CLIProxyBackend = getConfiguredCliproxyBackend()
): string {
  if (provider === 'claude') return '';
  return usesScopedProviderRoutes(backend) ? `/api/provider/${provider}` : '';
}

export function buildLocalProviderBaseUrl(
  provider: CLIProxyProvider,
  port: number,
  backend: CLIProxyBackend = getConfiguredCliproxyBackend()
): string {
  const rootUrl = `http://127.0.0.1:${port}`;
  return `${rootUrl}${buildCliproxyProviderPath(provider, backend)}`;
}
