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

export function parsePortFlag(args: string[]): PortFlag {
  const idx = args.indexOf('--port');
  if (idx === -1) return { present: false, port: null };
  const raw = args[idx + 1];
  const n = raw === undefined ? NaN : parseInt(raw, 10);
  const valid = Number.isFinite(n) && n > 0 && n < 65536;
  return { present: true, port: valid ? n : null };
}
