import type { LogsEntry, LogsLevel } from '@/lib/api-client';
// NOTE: This module contains utility functions that are not directly i18n-aware.
// String literals here ("No activity yet", "Error", etc.) are used as fallbacks
// and defaults in non-component contexts. Components consuming these values
// should wrap them with t() calls when rendering.
// TODO i18n: Consider making formatRelativeLogTime/formatLogTimestamp i18n-aware

export function formatLogTimestamp(timestamp: string | null | undefined) {
  if (!timestamp) {
    return 'No activity yet';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatLogTimestampIso(timestamp: string | null | undefined) {
  if (!timestamp) {
    return 'No activity yet';
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toISOString();
}

export function formatRelativeLogTime(timestamp: string | null | undefined) {
  if (!timestamp) {
    return 'No activity yet';
  }

  const value = new Date(timestamp).getTime();
  if (Number.isNaN(value)) {
    return timestamp;
  }

  const diffSeconds = Math.round((value - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (absSeconds < 60) {
    return formatter.format(diffSeconds, 'second');
  }

  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, 'minute');
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour');
  }

  return formatter.format(Math.round(diffHours / 24), 'day');
}

export function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

export function formatJson(value: unknown) {
  if (value === null || value === undefined) {
    return '{}';
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function getLevelLabel(level: LogsLevel) {
  switch (level) {
    case 'error':
      return 'Error';
    case 'warn':
      return 'Warn';
    case 'info':
      return 'Info';
    case 'debug':
      return 'Debug';
  }
}

// Field accessors shared by list row + detail panel.
// Without these, list and detail diverged — list fell back to source/sourceLabel
// while detail showed `—` for the same entry. Single source of truth.

export function getDisplayModule(entry: LogsEntry, sourceLabel?: string): string {
  return entry.module ?? sourceLabel ?? entry.source ?? '—';
}

export function getDisplayStage(entry: LogsEntry): string {
  return entry.stage ?? '—';
}

export function getDisplayRequestId(entry: LogsEntry, options: { short?: boolean } = {}): string {
  if (!entry.requestId) return '—';
  return options.short ? entry.requestId.slice(-8) : entry.requestId;
}

export function getDisplayLatency(entry: LogsEntry): string {
  if (entry.latencyMs === undefined || entry.latencyMs === null) return '—';
  return `${entry.latencyMs}ms`;
}

/**
 * Default filter pattern: dashboard self-polling sources start with `web-server:`.
 * UI applies as a default exclusion to keep the logs view focused on signal,
 * not the dashboard observing itself.
 */
export const DASHBOARD_INTERNALS_PATTERN = /^web-server:/i;

export function isDashboardInternal(entry: LogsEntry): boolean {
  if (!entry.source) return false;
  return DASHBOARD_INTERNALS_PATTERN.test(entry.source);
}
