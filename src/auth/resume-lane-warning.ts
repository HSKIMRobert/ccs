import * as path from 'path';
import { info, warn } from '../utils/ui';
import { detectShell, formatExport, formatUnset, type Shell } from '../codex-auth/shell-detect';
import { ANTHROPIC_ROUTING_ENV_KEYS } from '../utils/shell-executor';
import { isValidAccountProfileName } from './account-context';
import {
  findResumeSessionLanes,
  parseResumeFlagIntent,
  resolveRuntimePlainCcsResumeLane,
  type ResumeSessionLane,
  type ResumeLaneSummary,
} from './resume-lane-diagnostics';

interface ResumeLaneWarningDependencies {
  resolvePlainLane?: () => Promise<ResumeLaneSummary>;
  findSessionLanes?: (sessionId: string) => ResumeSessionLane[];
  shell?: Shell;
  env?: NodeJS.ProcessEnv;
  platform?: string;
  parentProcessName?: string;
  log?: (message: string) => void;
  debug?: boolean;
}

function joinShellStatements(shell: Shell, statements: string[]): string {
  if (shell === 'cmd') return statements.join(' && ');
  if (shell === 'fish') return statements.join(' ');
  return statements.join('; ');
}

function buildExplicitNativeResumeCommand(
  configDir: string,
  sessionId: string,
  shell: Shell
): string {
  const statements = ANTHROPIC_ROUTING_ENV_KEYS.map((key) => formatUnset(shell, key));
  statements.push(formatExport(shell, 'CLAUDE_CONFIG_DIR', configDir));
  statements.push(`claude --resume ${sessionId}`);
  return joinShellStatements(shell, statements);
}

function buildResumeCommand(
  sourceLane: ResumeSessionLane,
  plainLane: ResumeLaneSummary,
  sessionId: string,
  shell: Shell
): string | null {
  if (sourceLane.kind === 'account') {
    if (!sourceLane.accountName || !isValidAccountProfileName(sourceLane.accountName)) return null;
    return `ccs ${sourceLane.accountName} --resume ${sessionId}`;
  }

  if (
    plainLane.kind === 'native' &&
    path.resolve(sourceLane.configDir) === path.resolve(plainLane.configDir)
  ) {
    return `ccs --resume ${sessionId}`;
  }

  return buildExplicitNativeResumeCommand(sourceLane.configDir, sessionId, shell);
}

export async function maybeWarnAboutResumeLaneMismatch(
  profileName: string,
  accountConfigDir: string,
  args: string[],
  deps: ResumeLaneWarningDependencies = {}
): Promise<void> {
  const resumeIntent = parseResumeFlagIntent(args);
  if (!resumeIntent) {
    return;
  }

  const log = deps.log ?? console.error;

  try {
    const sessionLanes = resumeIntent.explicitSessionId
      ? (deps.findSessionLanes ?? findResumeSessionLanes)(resumeIntent.explicitSessionId)
      : [];
    if (
      sessionLanes.some((lane) => path.resolve(lane.configDir) === path.resolve(accountConfigDir))
    ) {
      return;
    }

    const plainLane = await (deps.resolvePlainLane ?? resolveRuntimePlainCcsResumeLane)();
    if (
      sessionLanes.length === 0 &&
      path.resolve(plainLane.configDir) === path.resolve(accountConfigDir)
    ) {
      return;
    }

    log(
      warn(
        `Resume for account "${profileName}" will search that account lane, not the current plain ccs lane.`
      )
    );
    log(info(`  Account lane: ${accountConfigDir}`));
    log(info(`  Plain ccs lane: ${plainLane.label} (${plainLane.configDir})`));
    const sourceLanes = sessionLanes.filter(
      (lane) => path.resolve(lane.configDir) !== path.resolve(accountConfigDir)
    );
    const shell =
      deps.shell ??
      detectShell(
        deps.env ?? process.env,
        deps.platform ?? process.platform,
        deps.parentProcessName
      );
    if (resumeIntent.explicitSessionId) {
      if (sourceLanes.length === 1) {
        const sourceLane = sourceLanes[0];
        const command = buildResumeCommand(
          sourceLane,
          plainLane,
          resumeIntent.explicitSessionId,
          shell
        );
        if (command) {
          log(info(`  Resume from the lane that owns this session: ${command}`));
        } else {
          log(warn('  Session owner has an unsafe account name; no executable command emitted.'));
        }
      } else if (sourceLanes.length > 1) {
        log(info('  This session exists in multiple lanes; choose one without merging history:'));
        for (const sourceLane of sourceLanes) {
          const command = buildResumeCommand(
            sourceLane,
            plainLane,
            resumeIntent.explicitSessionId,
            shell
          );
          if (command) log(info(`    ${command}`));
        }
      } else {
        log(
          info(
            '  This explicit session ID may have been created in a different lane, so Claude may not find it here.'
          )
        );
      }
    }
    if (sourceLanes.length === 0) {
      log(info('  Recover the original lane first: ccs -r'));
      log(info('  Back it up before changing setup: ccs auth backup default'));
      if (isValidAccountProfileName(profileName)) {
        log(
          info(
            `  For future work, align plain ccs with this account: ccs auth default ${profileName}`
          )
        );
      }
    } else if (
      sourceLanes.length === 1 &&
      sourceLanes[0].accountName &&
      isValidAccountProfileName(sourceLanes[0].accountName)
    ) {
      log(
        info(
          `  Back up that lane before changing setup: ccs auth backup ${sourceLanes[0].accountName}`
        )
      );
    }
    log('');
  } catch (error) {
    log(
      warn(
        'Resume lane guidance skipped because diagnostics failed; continuing with the account lane.'
      )
    );
    if (deps.debug ?? Boolean(process.env.CCS_DEBUG)) {
      log(info(`  Diagnostic error: ${(error as Error).message}`));
    }
  }
}
