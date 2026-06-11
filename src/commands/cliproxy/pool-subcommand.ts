/**
 * CLIProxy Pool Routing Subcommand
 *
 * Handles:
 *   ccs cliproxy pool --enable   Enable pool routing (fill-first + affinity + cooling ON)
 *   ccs cliproxy pool --disable  Disable pool routing and restore non-pool config
 *   ccs cliproxy pool            Show current pool routing state
 */

import { initUI, header, ok, warn, info } from '../../utils/ui';
import { enablePoolRouting, disablePoolRouting } from '../../cliproxy/routing/routing-strategy';
import { loadOrCreateUnifiedConfig } from '../../config/config-loader-facade';
import { CLIPROXY_DEFAULT_PORT } from '../../cliproxy/config/port-manager';
import { getConfigPathForPort, getAuthDir } from '../../cliproxy/config/path-resolver';
import { hasAnyFlag } from '../arg-extractor';

export async function handlePoolSubcommand(args: string[]): Promise<void> {
  await initUI();
  console.log('');
  console.log(header('CLIProxy Pool Routing'));
  console.log('');

  const port = CLIPROXY_DEFAULT_PORT;
  const configPath = getConfigPathForPort(port);
  const authDir = getAuthDir();

  if (hasAnyFlag(args, ['--enable'])) {
    const result = enablePoolRouting(port, { configPath, authDir });
    if (result.changed) {
      console.log(ok(result.message));
    } else {
      console.log(info(result.message));
    }
    console.log('');
    return;
  }

  if (hasAnyFlag(args, ['--disable'])) {
    const result = disablePoolRouting(port, { configPath, authDir });
    if (result.changed) {
      console.log(ok(result.message));
    } else {
      console.log(info(result.message));
    }
    console.log('');
    return;
  }

  // Default: show status
  const config = loadOrCreateUnifiedConfig();
  const enabled = config.cliproxy?.pool_routing?.enabled === true;
  const dismissed = config.cliproxy?.pool_routing?.prompt_dismissed === true;
  const maxRetry = config.cliproxy?.pool_routing?.max_retry_credentials;

  console.log(`  Status:       ${enabled ? ok('enabled') : warn('disabled')}`);
  if (enabled && maxRetry !== undefined) {
    console.log(`  Max retry:    ${maxRetry}`);
  }
  if (!enabled && dismissed) {
    console.log(`  Dismissed:    ${info('yes (prompt will not re-show)')}`);
  }
  console.log('');
  console.log(`  Enable:   ccs cliproxy pool --enable`);
  console.log(`  Disable:  ccs cliproxy pool --disable`);
  console.log('');
}
