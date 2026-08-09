/**
 * Shared `--port N` flag parsing for the `ccs bar` command family.
 *
 * `present` distinguishes "flag not given" from "flag given with a bad value"
 * so launch can reject typos loudly instead of silently falling back to the
 * default port list.
 */

export interface PortFlag {
  /** True when `--port` appears in args at all. */
  present: boolean;
  /** The parsed port (1-65535), or null when absent or invalid. */
  port: number | null;
}

export function validatePortArgs(args: string[]): string | null {
  let foundPort = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== '--port') return `Unknown option: ${arg}`;
    if (foundPort) return 'Duplicate option: --port';
    foundPort = true;
    const raw = args[index + 1];
    if (raw === undefined) return 'Missing value for --port';
    index += 1;
  }
  return null;
}

export function parsePortFlag(args: string[]): PortFlag {
  const idx = args.indexOf('--port');
  if (idx === -1) return { present: false, port: null };
  const raw = args[idx + 1];
  if (raw === undefined || !/^[1-9]\d{0,4}$/.test(raw)) {
    return { present: true, port: null };
  }
  const n = Number(raw);
  const valid = Number.isSafeInteger(n) && n <= 65535;
  return { present: true, port: valid ? n : null };
}
