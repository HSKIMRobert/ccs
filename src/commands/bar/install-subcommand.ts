/**
 * `ccs bar install` — download the CCS Bar app from the floating
 * `ccs-bar-latest` GitHub release tag and install to ~/Applications.
 *
 * Intentionally uses a FLOATING tag (not the exact CLI version) so the
 * Swift app can be rebuilt and published independently. After install the
 * handler calls GET /api/overview to verify version compatibility and warns
 * (but does not hard-fail) on mismatch.
 *
 * Mirrors the download/version-pin pattern in src/cliproxy/binary-manager.ts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getCcsDir } from '../../config/config-loader-facade';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Floating release tag — never pin to exact CLI semver. */
const BAR_RELEASE_TAG = 'ccs-bar-latest';
const BAR_APP_NAME = 'CCS Bar.app';
const BAR_ASSET_NAME = 'CCS-Bar.app.zip';
const BAR_GITHUB_REPO = 'kaitranntt/ccs';

/**
 * Allowlist of hostnames from which we will accept asset downloads.
 * GitHub releases redirect from github.com to objects.githubusercontent.com.
 *
 * TODO(checksum-v2): once release assets ship a checksums.txt/.sha256 file,
 * wire SHA-256 verification here. The download URL is already validated for
 * host+HTTPS as a v1 minimum guard. The verifier hook below is the intended
 * extension point.
 */
const DOWNLOAD_HOST_ALLOWLIST: ReadonlyArray<string> = [
  'github.com',
  'objects.githubusercontent.com',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReleaseAssetResult {
  downloadUrl: string;
  version: string;
}

export interface CompatResult {
  version: string;
  compatible: boolean;
}

export interface InstallDeps {
  /**
   * Resolve the asset download URL + version string from a GitHub release tag.
   * Production: calls GitHub API releases/tags/{tag}.
   * Test: mock that returns a fake URL + version.
   */
  fetchReleaseAsset: (tag: string, asset: string) => Promise<ReleaseAssetResult>;
  /**
   * Download the zip archive and extract the .app bundle into dest/.
   * Production: uses undici to stream + extract (with redirect + status check).
   */
  downloadAndExtract: (url: string, dest: string) => Promise<void>;
  /**
   * Call GET {baseUrl}/api/overview and return { version, compatible }.
   * compatible = server version major === installed app version major.
   * Returns compatible:false (never true) when versions cannot be compared.
   */
  verifyCompat: (baseUrl: string, installedVersion: string) => Promise<CompatResult>;
  /** Returns path to ~/.ccs (respects CCS_HOME). */
  getCcsDir: () => string;
  /** Destination directory for the .app bundle (~/Applications by default). */
  getAppsDir: () => string;
}

// ---------------------------------------------------------------------------
// Host allowlist validation (Finding #9)
// ---------------------------------------------------------------------------

/**
 * Validate that a download URL is https and its hostname is in the allowlist
 * (exact match or *.githubusercontent.com wildcard).
 * Throws a descriptive Error if validation fails.
 */
export function validateDownloadUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Download URL is not a valid URL: ${url}`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`Download URL must use HTTPS, got: ${parsed.protocol} for ${url}`);
  }

  const host = parsed.hostname.toLowerCase();
  const allowed =
    (DOWNLOAD_HOST_ALLOWLIST as string[]).includes(host) || host.endsWith('.githubusercontent.com');

  if (!allowed) {
    throw new Error(
      `Download URL hostname "${host}" is not in the trusted allowlist ` +
        `(${DOWNLOAD_HOST_ALLOWLIST.join(', ')}, *.githubusercontent.com). ` +
        `Refusing to download from untrusted host.`
    );
  }
}

// ---------------------------------------------------------------------------
// Production implementation helpers
// ---------------------------------------------------------------------------

async function defaultFetchReleaseAsset(tag: string, asset: string): Promise<ReleaseAssetResult> {
  const { request } = await import('undici');
  const apiUrl = `https://api.github.com/repos/${BAR_GITHUB_REPO}/releases/tags/${tag}`;
  const { statusCode, body } = await request(apiUrl, {
    headers: {
      'User-Agent': 'ccs-cli',
      Accept: 'application/vnd.github+json',
    },
  });

  if (statusCode !== 200) {
    throw new Error(`GitHub API returned ${statusCode} for tag ${tag}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const release = (await body.json()) as any;
  const tagName: string = release.tag_name ?? tag;
  // Strip leading 'v' for the version pin file.
  const version = tagName.replace(/^v/, '');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const found = (release.assets as any[]).find((a: { name: string }) => a.name === asset);
  if (!found) {
    throw new Error(`Asset "${asset}" not found in release ${tag}`);
  }

  return { downloadUrl: found.browser_download_url as string, version };
}

/**
 * Download a zip from `url` (following up to 5 GitHub 302 redirects, re-validating
 * each hop's Location hostname) and extract its contents into `dest`.
 *
 * Fixes applied:
 * - Fix #6: maxRedirections:0 + manual redirect following so every hop's Location
 *   header is passed through validateDownloadUrl before following it.
 *   The previous maxRedirections:5 let undici follow redirects to ANY host unchecked.
 * - Fix #14: list zip entries with `unzip -l` before extracting; reject the archive
 *   if any entry path contains ".." or starts with "/" (zip-slip guard).
 * - Finding #11: check `statusCode` and throw a descriptive error before streaming.
 * - Finding #9: validate host+HTTPS before making the first request.
 */
async function defaultDownloadAndExtract(url: string, dest: string): Promise<void> {
  const { request } = await import('undici');
  const { createWriteStream, mkdirSync } = fs;
  const { promisify } = await import('util');
  const { pipeline } = await import('stream');
  const streamPipeline = promisify(pipeline);
  const { execFile } = await import('child_process');
  const execFileAsync = promisify(execFile);

  // Validate initial URL (Finding #9)
  validateDownloadUrl(url);

  mkdirSync(dest, { recursive: true });

  // Fix #6: follow redirects manually so each hop is re-validated.
  const MAX_REDIRECTS = 5;
  let currentUrl = url;
  let redirectsFollowed = 0;

  while (true) {
    const { statusCode, headers, body } = await request(currentUrl, {
      maxRedirections: 0, // disable undici's auto-follow; we follow manually
    });

    if (statusCode >= 300 && statusCode < 400) {
      const location = Array.isArray(headers['location'])
        ? headers['location'][0]
        : headers['location'];

      if (!location) {
        throw new Error(`Redirect (HTTP ${statusCode}) from ${currentUrl} has no Location header`);
      }

      // Resolve relative redirects against the current URL
      const resolved = new URL(location, currentUrl).toString();

      // Re-validate the redirect target — this is the key fix for #6
      validateDownloadUrl(resolved);

      if (redirectsFollowed >= MAX_REDIRECTS) {
        throw new Error(`Too many redirects (>${MAX_REDIRECTS}) while downloading ${url}`);
      }

      // Drain the body to free the socket before following the redirect
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (body as any).dump?.();
      currentUrl = resolved;
      redirectsFollowed++;
      continue;
    }

    if (statusCode !== 200) {
      throw new Error(`Download failed: HTTP ${statusCode} for ${currentUrl}`);
    }

    const tmpZip = path.join(os.tmpdir(), `ccs-bar-${Date.now()}.zip`);

    // Stream body to tmpZip
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await streamPipeline(body as any, createWriteStream(tmpZip));

    // Fix #14: zip-slip guard — inspect entries before extraction.
    // `unzip -l` lists entries in a machine-readable format; we scan for ".." or
    // absolute paths that would escape the destination directory.
    try {
      const { stdout: listing } = await execFileAsync('unzip', ['-l', tmpZip]);
      const lines = listing.split('\n');
      for (const line of lines) {
        // Entry lines look like: "  <size>  <date> <time>  <path>"
        // We extract the path from the last whitespace-delimited field.
        const match = /^\s+\d+\s+[\d-]+\s+[\d:]+\s+(.+)$/.exec(line);
        if (!match || !match[1]) continue;
        const entryPath = match[1].trim();
        if (!entryPath || entryPath.endsWith('/')) continue; // skip directory entries

        // Reject absolute paths and paths with traversal components
        if (path.isAbsolute(entryPath) || entryPath.includes('..')) {
          try {
            fs.unlinkSync(tmpZip);
          } catch {
            /* ignore */
          }
          throw new Error(
            `Zip-slip detected: archive entry "${entryPath}" contains a path traversal ` +
              `component. Refusing to extract.`
          );
        }
      }
    } catch (err) {
      // If the guard itself throws (e.g. zip-slip detected above), propagate it.
      // If it's a system error (unzip not available), let extraction proceed and
      // surface the issue then.
      if ((err as Error).message?.includes('Zip-slip')) throw err;
      // Warn but continue — extraction will likely also fail if unzip is missing
      console.error(
        `[!] Zip entry scan failed (will attempt extraction): ${(err as Error).message}`
      );
    }

    // Extract the zip into dest
    await execFileAsync('unzip', ['-o', tmpZip, '-d', dest]);

    // Clean up the temp archive
    try {
      fs.unlinkSync(tmpZip);
    } catch {
      /* ignore */
    }

    break;
  }
}

/**
 * Call GET {baseUrl}/api/overview and compare server version against the
 * installed bar version. Returns compat=false whenever the comparison cannot
 * be made (server unreachable, version strings unparseable, etc.).
 *
 * Fix for Finding #10: replaces the phantom check that always returned true.
 * Compatible is defined as same semver major (0 vs 0, 1 vs 1, etc.).
 */
async function defaultVerifyCompat(
  baseUrl: string,
  installedVersion: string
): Promise<CompatResult> {
  try {
    const { request } = await import('undici');
    const { statusCode, body } = await request(`${baseUrl}/api/overview`, {
      headers: { 'User-Agent': 'ccs-cli' },
    });
    if (statusCode !== 200) {
      console.log(
        `[!] Version compatibility check failed: /api/overview returned HTTP ${statusCode}.`
      );
      return { version: 'unknown', compatible: false };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await body.json()) as any;
    const serverVersion: string = (data.version as string) ?? 'unknown';

    if (serverVersion === 'unknown') {
      console.log('[!] Version compatibility: server did not report a version.');
      return { version: serverVersion, compatible: false };
    }

    // Parse installed version major from the pinned version string.
    const installedMajorRaw = installedVersion.split('.')[0];
    const serverMajorRaw = serverVersion.split('.')[0];
    const installedMajor = parseInt(installedMajorRaw ?? '', 10);
    const serverMajor = parseInt(serverMajorRaw ?? '', 10);

    if (isNaN(installedMajor) || isNaN(serverMajor)) {
      console.log(
        `[!] Version compatibility: cannot parse major versions ` +
          `(installed="${installedVersion}", server="${serverVersion}").`
      );
      return { version: serverVersion, compatible: false };
    }

    const compatible = installedMajor === serverMajor;
    return { version: serverVersion, compatible };
  } catch {
    // Server unreachable — warn but do not claim compatible.
    return { version: 'unknown', compatible: false };
  }
}

function defaultGetCcsDir(): string {
  return getCcsDir();
}

function defaultGetAppsDir(): string {
  return path.join(os.homedir(), 'Applications');
}

// ---------------------------------------------------------------------------
// Version pin helpers
// ---------------------------------------------------------------------------

function getBarVersionFilePath(ccsDir: string): string {
  return path.join(ccsDir, 'bar', '.version');
}

function pinBarVersion(ccsDir: string, version: string): void {
  const versionFile = getBarVersionFilePath(ccsDir);
  fs.mkdirSync(path.dirname(versionFile), { recursive: true });
  fs.writeFileSync(versionFile, version);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function handleBarInstall(
  _args: string[],
  deps: Partial<InstallDeps> = {}
): Promise<void> {
  const fetchReleaseAsset = deps.fetchReleaseAsset ?? defaultFetchReleaseAsset;
  const downloadAndExtract = deps.downloadAndExtract ?? defaultDownloadAndExtract;
  const verifyCompat = deps.verifyCompat ?? defaultVerifyCompat;
  const ccsDir = (deps.getCcsDir ?? defaultGetCcsDir)();
  const appsDir = (deps.getAppsDir ?? defaultGetAppsDir)();

  console.log('[i] Fetching CCS Bar release info...');

  // 1. Resolve the floating tag → download URL + version.
  let releaseInfo: ReleaseAssetResult;
  try {
    releaseInfo = await fetchReleaseAsset(BAR_RELEASE_TAG, BAR_ASSET_NAME);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[X] Failed to fetch release asset: ${msg}`);
    console.error('[i] Check your network connection and try again.');
    return;
  }

  const { downloadUrl, version } = releaseInfo;
  console.log(`[i] Installing CCS Bar v${version} from ${BAR_RELEASE_TAG}...`);

  // 2. Download and extract into ~/Applications.
  try {
    await downloadAndExtract(downloadUrl, appsDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[X] Download or extraction failed: ${msg}`);
    return;
  }

  // 3. Finding #12: assert that the expected .app bundle was actually extracted
  //    before reporting success.
  const appPath = path.join(appsDir, BAR_APP_NAME);
  if (!fs.existsSync(appPath)) {
    // Report what was actually extracted to help diagnose archive issues.
    let extracted: string[] = [];
    try {
      extracted = fs.readdirSync(appsDir);
    } catch {
      /* ignore */
    }
    const found = extracted.length > 0 ? extracted.join(', ') : '(none)';
    console.error(`[X] Extraction succeeded but "${BAR_APP_NAME}" was not found in ${appsDir}.`);
    console.error(`[i] Files found in ${appsDir}: ${found}`);
    return;
  }

  // 4. Pin the installed version to ~/.ccs/bar/.version.
  try {
    pinBarVersion(ccsDir, version);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[!] Could not write version pin: ${msg}`);
    // Non-fatal — continue.
  }

  console.log(`[OK] CCS Bar v${version} installed to ${appsDir}/${BAR_APP_NAME}`);

  // 5. Version-compat handshake via /api/overview.
  //    Read bar.json for baseUrl if present; otherwise fall back to localhost:3000.
  const barJsonPath = path.join(ccsDir, 'bar.json');
  let baseUrl = 'http://127.0.0.1:3000';
  try {
    const raw = fs.readFileSync(barJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { baseUrl?: string };
    if (parsed.baseUrl) baseUrl = parsed.baseUrl;
  } catch {
    /* bar.json absent — use fallback */
  }

  try {
    // Pass the pinned version so verifyCompat can do a real major-version comparison.
    const compat = await verifyCompat(baseUrl, version);
    if (!compat.compatible) {
      console.log(
        `[!] Version mismatch: CCS server reports v${compat.version}, ` +
          `app is v${version}. Some features may not work until you restart ` +
          '`ccs bar` or update CCS.'
      );
    } else {
      console.log(`[OK] Version compatibility confirmed (server: v${compat.version}).`);
    }
  } catch {
    console.log('[!] Could not verify version compatibility (server may not be running).');
    console.log('[i] Run `ccs bar` to start the server and recheck.');
  }

  // 6. Print Gatekeeper guidance for ad-hoc/unsigned builds.
  console.log('');
  console.log('[i] Gatekeeper note (ad-hoc build):');
  console.log('    If macOS says the app is "damaged" or "unverified", run:');
  console.log(`      xattr -dr com.apple.quarantine "${path.join(appsDir, BAR_APP_NAME)}"`);
  console.log('    Or right-click the app and select Open.');
}
