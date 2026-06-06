import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  api,
  type LogsEntry,
  type LogsLevel,
  type UpdateLogsConfigPayload,
} from '@/lib/api-client';

// ---- dev-only fixture injection (`?mock=logs`) -----------------------------
// Tree-shaken from production: the fixture import lives behind
// `import.meta.env.DEV` and the URL flag check.
const KNOWN_LOGS_ENTRY_KEYS = new Set([
  'id',
  'timestamp',
  'level',
  'source',
  'event',
  'message',
  'processId',
  'runId',
  'context',
  'requestId',
  'module',
  'stage',
  'latencyMs',
  'metadata',
  'error',
]);

let _shapeWarned = false;
function assertLogsEntryShape(entry: LogsEntry): void {
  if (!import.meta.env.DEV || _shapeWarned) return;
  const missing: string[] = [];
  if (!entry.id) missing.push('id');
  if (!entry.timestamp) missing.push('timestamp');
  if (!entry.level) missing.push('level');
  const unknown = Object.keys(entry).filter((k) => !KNOWN_LOGS_ENTRY_KEYS.has(k));
  if (missing.length || unknown.length) {
    _shapeWarned = true;

    console.warn('[logs] LogsEntry shape drift detected -- backend contract changed?', {
      missing,
      unknown,
    });
  }
}

function isMockLogsEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('mock') === 'logs';
  } catch {
    return false;
  }
}

export type LogsLevelFilter = 'all' | LogsLevel;
export type LogsSourceFilter = 'all' | string;
export type LogsTimeWindow = 'all' | '5m' | '15m' | '1h' | '24h';

const CONFIG_QUERY_KEY = ['logs', 'config'] as const;
const SOURCES_QUERY_KEY = ['logs', 'sources'] as const;
const DEFAULT_LIMIT = 150;
const POLL_INTERVAL_MS = 10_000;
const TEXT_DEBOUNCE_MS = 250;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const sync = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return visible;
}

function windowToCutoffMs(window: LogsTimeWindow): number | null {
  switch (window) {
    case '5m':
      return 5 * 60_000;
    case '15m':
      return 15 * 60_000;
    case '1h':
      return 60 * 60_000;
    case '24h':
      return 24 * 60 * 60_000;
    default:
      return null;
  }
}

export function useLogsWorkspace() {
  const [selectedSource, setSelectedSource] = useState<LogsSourceFilter>('all');
  const [selectedLevel, setSelectedLevel] = useState<LogsLevelFilter>('all');
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [requestIdFilter, setRequestIdFilter] = useState('');
  const [timeWindow, setTimeWindow] = useState<LogsTimeWindow>('all');
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  // Default OFF: web-server:* entries include dashboard access and WebSocket
  // audit evidence, so keep them visible unless the operator opts into noise
  // reduction from the advanced filter toggle.
  const [hideDashboardInternals, setHideDashboardInternals] = useState(false);
  const frozenIdsRef = useRef<Set<string>>(new Set());

  const deferredSearch = useDeferredValue(search.trim());
  const debouncedModule = useDebouncedValue(moduleFilter.trim(), TEXT_DEBOUNCE_MS);
  const debouncedStage = useDebouncedValue(stageFilter.trim(), TEXT_DEBOUNCE_MS);
  const debouncedRequestId = useDebouncedValue(requestIdFilter.trim(), TEXT_DEBOUNCE_MS);
  const documentVisible = useDocumentVisible();

  const configQuery = useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: async () => (await api.logs.getConfig()).logging,
    refetchInterval: 30_000,
  });

  const sourcesQuery = useQuery({
    queryKey: SOURCES_QUERY_KEY,
    queryFn: async () => (await api.logs.getSources()).sources,
    refetchInterval: 15_000,
  });

  const mockEnabled = isMockLogsEnabled();
  const refetchInterval = isPaused || !documentVisible ? false : POLL_INTERVAL_MS;

  const entriesQuery = useQuery({
    queryKey: [
      'logs',
      'entries',
      selectedSource,
      selectedLevel,
      deferredSearch,
      debouncedModule,
      debouncedStage,
      debouncedRequestId,
      timeWindow,
      limit,
      hideDashboardInternals ? 'hide-internals' : 'show-internals',
      mockEnabled ? 'mock' : 'live',
    ],
    queryFn: async () => {
      let entries: LogsEntry[];
      if (mockEnabled && import.meta.env.DEV) {
        const { STRUCTURED_LOG_ENTRIES } =
          await import('@/components/logs/__fixtures__/structured-log-entries');
        entries = STRUCTURED_LOG_ENTRIES.filter((entry) => {
          if (selectedSource !== 'all' && entry.source !== selectedSource) return false;
          if (selectedLevel !== 'all' && entry.level !== selectedLevel) return false;
          if (deferredSearch) {
            const needle = deferredSearch.toLowerCase();
            const hay =
              `${entry.message} ${entry.event} ${entry.module ?? ''} ${entry.requestId ?? ''}`.toLowerCase();
            if (!hay.includes(needle)) return false;
          }
          return true;
        }).slice(0, limit);
      } else {
        const result = await api.logs.getEntries({
          source: selectedSource === 'all' ? undefined : selectedSource,
          level: selectedLevel === 'all' ? undefined : selectedLevel,
          search: deferredSearch || undefined,
          limit,
        });
        entries = result.entries;
      }

      // Client-side fallback for advanced filters (backend may not yet implement).
      const cutoffMs = windowToCutoffMs(timeWindow);
      const now = Date.now();
      const filtered = entries.filter((entry) => {
        if (debouncedModule && !(entry.module ?? '').includes(debouncedModule)) return false;
        if (debouncedStage && (entry.stage ?? '') !== debouncedStage) return false;
        if (debouncedRequestId && !(entry.requestId ?? '').includes(debouncedRequestId))
          return false;
        if (cutoffMs !== null) {
          const ts = Date.parse(entry.timestamp);
          if (Number.isFinite(ts) && now - ts > cutoffMs) return false;
        }
        // Optional noise reduction only: web-server:* entries can contain
        // security-relevant dashboard access and WebSocket audit evidence, so
        // they remain visible by default.
        if (hideDashboardInternals && /^web-server:/i.test(entry.source)) return false;
        return true;
      });
      const head = filtered[0];
      if (head) assertLogsEntryShape(head);
      return filtered;
    },
    placeholderData: keepPreviousData,
    refetchInterval,
    refetchOnWindowFocus: true,
  });

  // Live-tail pending count: rotation-safe id-set diff.
  const entriesData = entriesQuery.data;
  const backendEntries = useMemo<LogsEntry[]>(() => entriesData ?? [], [entriesData]);
  const pendingCount = useMemo(() => {
    if (!isPaused) return 0;
    const frozen = frozenIdsRef.current;
    let count = 0;
    for (const e of backendEntries) {
      if (!frozen.has(e.id)) count += 1;
    }
    return count;
  }, [backendEntries, isPaused]);

  const pause = useCallback(() => {
    frozenIdsRef.current = new Set(backendEntries.map((e) => e.id));
    setIsPaused(true);
  }, [backendEntries]);

  const resume = useCallback(() => {
    frozenIdsRef.current = new Set();
    setIsPaused(false);
    void entriesQuery.refetch();
  }, [entriesQuery]);

  const togglePause = useCallback(() => {
    if (isPaused) resume();
    else pause();
  }, [isPaused, pause, resume]);

  // Selection: keep selectedId across refetch, fall back to first entry.
  const activeSelectedEntryId = useMemo(() => {
    if (backendEntries.length === 0) return null;
    if (selectedEntryId && backendEntries.some((entry) => entry.id === selectedEntryId)) {
      return selectedEntryId;
    }
    return backendEntries[0]?.id ?? null;
  }, [backendEntries, selectedEntryId]);

  const selectedEntry = useMemo(
    () => backendEntries.find((entry) => entry.id === activeSelectedEntryId) ?? null,
    [activeSelectedEntryId, backendEntries]
  );

  // selectionOutOfScope: a selection survived but is no longer in filtered entries.
  const isSelectionOutOfScope = Boolean(
    selectedEntryId && !backendEntries.some((entry) => entry.id === selectedEntryId)
  );

  const latestTimestamp = useMemo(() => {
    const timestamps = (sourcesQuery.data ?? [])
      .map((source) => source.lastTimestamp)
      .filter((value): value is string => Boolean(value));
    return timestamps.sort((left, right) => right.localeCompare(left))[0] ?? null;
  }, [sourcesQuery.data]);

  const clearAdvancedFilters = useCallback(() => {
    setSearch('');
    setSelectedLevel('all');
    setSelectedSource('all');
    setModuleFilter('');
    setStageFilter('');
    setRequestIdFilter('');
    setTimeWindow('all');
    setHideDashboardInternals(false);
  }, []);

  return {
    configQuery,
    sourcesQuery,
    entriesQuery,
    selectedSource,
    setSelectedSource,
    selectedLevel,
    setSelectedLevel,
    search,
    setSearch,
    moduleFilter,
    setModuleFilter,
    stageFilter,
    setStageFilter,
    requestIdFilter,
    setRequestIdFilter,
    timeWindow,
    setTimeWindow,
    hideDashboardInternals,
    setHideDashboardInternals,
    limit,
    setLimit,
    selectedEntryId: activeSelectedEntryId,
    setSelectedEntryId,
    selectedEntry,
    isSelectionOutOfScope,
    latestTimestamp,
    isInitialLoading:
      (!configQuery.data && configQuery.isLoading) ||
      (!sourcesQuery.data && sourcesQuery.isLoading) ||
      (!entriesQuery.data && entriesQuery.isLoading),
    liveTail: {
      isPaused,
      pendingCount,
      pause,
      resume,
      togglePause,
    },
    clearAdvancedFilters,
  };
}

export function useUpdateLogsConfig() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (payload: UpdateLogsConfigPayload) => api.logs.updateConfig(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: SOURCES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['logs', 'entries'] }),
      ]);
      toast.success(t('toasts.loggingConfigSaved'));
    },
    onError: (error: Error) => {
      toast.error(error.message || t('toasts.loggingConfigSaveFailed'));
    },
  });
}

export function getLogLevelOptions(): Array<{ value: LogsLevelFilter; label: string }> {
  return [
    { value: 'all', label: 'All levels' },
    { value: 'error', label: 'Errors' },
    { value: 'warn', label: 'Warnings' },
    { value: 'info', label: 'Info' },
    { value: 'debug', label: 'Debug' },
  ];
}

export function getLogsTimeWindowOptions(): Array<{ value: LogsTimeWindow; label: string }> {
  return [
    { value: 'all', label: 'All time' },
    { value: '5m', label: 'Last 5m' },
    { value: '15m', label: 'Last 15m' },
    { value: '1h', label: 'Last 1h' },
    { value: '24h', label: 'Last 24h' },
  ];
}

export function getSelectedSourceLabel(
  source: LogsSourceFilter,
  sources: Array<{ source: string; label: string }>
) {
  if (source === 'all') {
    return 'All sources';
  }

  return sources.find((entry) => entry.source === source)?.label ?? source;
}

export function getSourceLabelMap(
  sources: Array<{ source: string; label: string }>
): Record<string, string> {
  return Object.fromEntries(sources.map((source) => [source.source, source.label]));
}

export function isLogsEntryListEmpty(entries: LogsEntry[] | undefined) {
  return !entries || entries.length === 0;
}
