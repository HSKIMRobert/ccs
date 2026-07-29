import { getWebSearchConfig } from '../../config/config-loader-facade';
import { getWebSearchHookEnv } from './hook-env';

export type WebSearchConfigSnapshot = ReturnType<typeof getWebSearchConfig>;

export interface WebSearchLaunchState {
  config: WebSearchConfigSnapshot;
  enabled: boolean;
  hookEnv: Record<string, string>;
}

export function resolveWebSearchLaunchState(): WebSearchLaunchState {
  const config = getWebSearchConfig();
  return {
    config,
    enabled: config.enabled,
    hookEnv: getWebSearchHookEnv(config),
  };
}
