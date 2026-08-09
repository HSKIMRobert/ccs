import * as fs from 'fs';
import * as path from 'path';
import { getDefaultClaudeConfigDir } from '../utils/claude-config-path';

import InstanceManager from '../management/instance-manager';
import ProfileDetector from './profile-detector';
import ProfileRegistry from './profile-registry';
import { resolveConfiguredContinuitySourceAccount } from './profile-continuity-inheritance';
import type { ProfileType } from '../types/profile';
import { getCcsDir } from '../config/config-loader-facade';
import { isValidAccountProfileName } from './account-context';

export type ResumeLaneKind =
  | 'native'
  | 'account-default'
  | 'account-inherited'
  | 'profile-default'
  | 'ambient';

export interface ResumeLaneSummary {
  kind: ResumeLaneKind;
  label: string;
  configDir: string;
  accountName?: string;
  profileName?: string;
  projectCount: number;
}

export interface ResumeFlagIntent {
  implicit: boolean;
  explicitSessionId?: string;
}

export interface ResumeSessionLane {
  kind: 'native' | 'account';
  configDir: string;
  accountName?: string;
}

export interface ResumeSessionScanDependencies {
  beforeSessionOpen?: (sessionPath: string) => void;
}

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPathWithin(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function hasSameIdentity(before: fs.Stats, after: fs.Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino;
}

function isStableDirectory(directoryPath: string, before: fs.Stats): boolean {
  const after = fs.lstatSync(directoryPath);
  return after.isDirectory() && !after.isSymbolicLink() && hasSameIdentity(before, after);
}

function isStableFile(filePath: string, before: fs.Stats): boolean {
  const after = fs.lstatSync(filePath);
  return after.isFile() && !after.isSymbolicLink() && hasSameIdentity(before, after);
}

function countTopLevelProjectDirs(projectsDir: string): number {
  try {
    return fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

function laneContainsSession(
  configDir: string,
  sessionId: string,
  deps: ResumeSessionScanDependencies
): boolean {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return false;
  }

  const projectsDir = path.join(configDir, 'projects');
  try {
    const configStat = fs.lstatSync(configDir);
    if (!configStat.isDirectory() || configStat.isSymbolicLink()) return false;
    const configRealPath = fs.realpathSync(configDir);
    const projectsStat = fs.lstatSync(projectsDir);
    if (!projectsStat.isDirectory() || projectsStat.isSymbolicLink()) return false;
    const projectsRealPath = fs.realpathSync(projectsDir);
    if (!isPathWithin(projectsRealPath, configRealPath)) return false;

    return fs.readdirSync(projectsDir, { withFileTypes: true }).some((projectEntry) => {
      if (!projectEntry.isDirectory() || projectEntry.isSymbolicLink()) {
        return false;
      }
      const projectPath = path.join(projectsDir, projectEntry.name);
      const sessionPath = path.join(projectPath, `${sessionId}.jsonl`);
      let sessionFd: number | undefined;
      try {
        const projectStat = fs.lstatSync(projectPath);
        if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) return false;
        const projectRealPath = fs.realpathSync(projectPath);
        if (!isPathWithin(projectRealPath, projectsRealPath)) return false;
        const sessionRealPath = fs.realpathSync(sessionPath);
        if (!isPathWithin(sessionRealPath, projectRealPath)) return false;
        const sessionStat = fs.lstatSync(sessionPath);
        if (!sessionStat.isFile() || sessionStat.isSymbolicLink()) return false;
        deps.beforeSessionOpen?.(sessionPath);
        sessionFd = fs.openSync(
          sessionPath,
          fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
        );
        const openedSessionStat = fs.fstatSync(sessionFd);
        if (!openedSessionStat.isFile() || !hasSameIdentity(sessionStat, openedSessionStat)) {
          return false;
        }
        return (
          isStableDirectory(configDir, configStat) &&
          isStableDirectory(projectsDir, projectsStat) &&
          isStableDirectory(projectPath, projectStat) &&
          isStableFile(sessionPath, sessionStat) &&
          fs.realpathSync(configDir) === configRealPath &&
          fs.realpathSync(projectsDir) === projectsRealPath &&
          fs.realpathSync(projectPath) === projectRealPath &&
          fs.realpathSync(sessionPath) === sessionRealPath
        );
      } catch {
        return false;
      } finally {
        if (sessionFd !== undefined) fs.closeSync(sessionFd);
      }
    });
  } catch {
    return false;
  }
}

export function findResumeSessionLanes(
  sessionId: string,
  deps: ResumeSessionScanDependencies = {}
): ResumeSessionLane[] {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return [];
  }

  const instanceMgr = new InstanceManager();
  const profileRegistry = new ProfileRegistry();
  const lanes: ResumeSessionLane[] = [];
  const nativeConfigDir = getDefaultClaudeConfigDir();
  if (laneContainsSession(nativeConfigDir, sessionId, deps)) {
    lanes.push({ kind: 'native', configDir: nativeConfigDir });
  }

  const accountNames = Object.entries(profileRegistry.getAllProfilesMerged())
    .filter(
      ([accountName, profile]) =>
        profile.type === 'account' && isValidAccountProfileName(accountName)
    )
    .map(([accountName]) => accountName);
  for (const accountName of accountNames) {
    const configDir = instanceMgr.getInstancePath(accountName);
    if (laneContainsSession(configDir, sessionId, deps)) {
      lanes.push({ kind: 'account', configDir, accountName });
    }
  }

  return lanes;
}

function resolveNativeLaneSummary(
  kind: ResumeLaneKind = 'native',
  profileName?: string
): ResumeLaneSummary {
  const configDir = getDefaultClaudeConfigDir();
  const label =
    kind === 'profile-default' && profileName
      ? `profile "${profileName}" via native Claude lane`
      : 'native Claude lane';

  return {
    kind,
    label,
    configDir,
    profileName,
    projectCount: countTopLevelProjectDirs(path.join(configDir, 'projects')),
  };
}

function resolveAccountLaneSummary(
  kind: Extract<ResumeLaneKind, 'account-default' | 'account-inherited'>,
  accountName: string
): ResumeLaneSummary {
  const instanceMgr = new InstanceManager();
  const configDir = instanceMgr.getInstancePath(accountName);

  return {
    kind,
    label:
      kind === 'account-inherited'
        ? `plain ccs inherits from account "${accountName}"`
        : `plain ccs defaults to account "${accountName}"`,
    configDir,
    accountName,
    projectCount: countTopLevelProjectDirs(path.join(configDir, 'projects')),
  };
}

export async function resolveConfiguredPlainCcsResumeLane(): Promise<ResumeLaneSummary> {
  const detector = new ProfileDetector();
  const defaultProfile = detector.resolveDefaultProfileResult();

  if (defaultProfile.type === 'account') {
    return resolveAccountLaneSummary('account-default', defaultProfile.name);
  }

  const inheritedAccount = resolveConfiguredContinuitySourceAccount(
    defaultProfile.name,
    defaultProfile.type
  );
  if (inheritedAccount) {
    return resolveAccountLaneSummary('account-inherited', inheritedAccount);
  }

  if (defaultProfile.type !== 'default') {
    return resolveNativeLaneSummary('profile-default', defaultProfile.name);
  }

  return resolveNativeLaneSummary();
}

export async function resolveRuntimePlainCcsResumeLane(): Promise<ResumeLaneSummary> {
  if (process.env.CLAUDE_CONFIG_DIR) {
    const configDir = path.resolve(process.env.CLAUDE_CONFIG_DIR);
    return {
      kind: 'ambient',
      label: 'current shell CLAUDE_CONFIG_DIR',
      configDir,
      projectCount: countTopLevelProjectDirs(path.join(configDir, 'projects')),
    };
  }

  return resolveConfiguredPlainCcsResumeLane();
}

export function parseResumeFlagIntent(args: string[]): ResumeFlagIntent | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-r') {
      return { implicit: true };
    }

    if (arg === '--resume') {
      const next = args[index + 1];
      if (next && !next.startsWith('-')) {
        return { implicit: false, explicitSessionId: next };
      }
      return { implicit: true };
    }

    if (arg.startsWith('--resume=')) {
      const sessionId = arg.slice('--resume='.length).trim();
      return sessionId ? { implicit: false, explicitSessionId: sessionId } : { implicit: true };
    }
  }

  return null;
}

export function getAuthBackupRoot(): string {
  return path.join(getCcsDir(), 'backups', 'auth-continuity');
}

export function createTimestampStamp(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

export function getContinuityArtifactNames(profileType: ProfileType): string[] {
  const sharedItems = ['projects'];
  const deeperItems = ['session-env', 'file-history', 'shell-snapshots', 'todos'];

  if (profileType === 'default' || profileType === 'account') {
    return [...sharedItems, ...deeperItems];
  }

  return sharedItems;
}
