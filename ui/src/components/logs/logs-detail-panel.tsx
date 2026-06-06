import { useMemo, useState } from 'react';
import { Copy, Eye, EyeOff, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { LogsEntry } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { LogLevelBadge } from './log-level-badge';
import { LogsEmpty } from './logs-empty';
import {
  formatJson,
  formatLogTimestampIso,
  getDisplayLatency,
  getDisplayModule,
  getDisplayRequestId,
  getDisplayStage,
} from './utils';
import { FOCUS_RING, MONO_NUMERIC } from './tokens';

export interface LogsDetailPanelProps {
  entry: LogsEntry | null;
  sourceLabel?: string;
  /** Optional: when provided, "Show trace" button surfaces & calls this. */
  onShowTrace?: (requestId: string) => void;
  /** When true, redact metadata leaves until user reveals. */
  redact?: boolean;
}

interface OverviewRow {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}

function buildOverviewRows(entry: LogsEntry, sourceLabel?: string): OverviewRow[] {
  // Use shared accessors so this panel and the list row never diverge.
  return [
    { label: 'Time', value: formatLogTimestampIso(entry.timestamp), mono: true },
    { label: 'Level', value: entry.level },
    { label: 'Module', value: getDisplayModule(entry, sourceLabel) },
    { label: 'Stage', value: getDisplayStage(entry) },
    { label: 'Request ID', value: getDisplayRequestId(entry), mono: true },
    { label: 'Latency', value: getDisplayLatency(entry), mono: true },
    { label: 'Source', value: sourceLabel ?? entry.source ?? '—' },
    { label: 'Run ID', value: entry.runId ?? '—', mono: true },
    { label: 'Process ID', value: entry.processId ?? '—', mono: true },
  ];
}

function MetaTree({
  value,
  redact,
  depth = 0,
}: {
  value: unknown;
  redact: boolean;
  depth?: number;
}) {
  const [revealed, setRevealed] = useState(false);
  if (depth > 8) return <span className="text-muted-foreground">…</span>;

  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">null</span>;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (redact && typeof value === 'string' && value.length > 0 && !revealed) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">redacted</span>
          <button
            type="button"
            onClick={() => setRevealed(true)}
            aria-label="Reveal value"
            className={cn('rounded p-0.5 text-muted-foreground hover:text-foreground', FOCUS_RING)}
          >
            <Eye className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={cn('text-foreground/90', typeof value !== 'string' && MONO_NUMERIC)}>
          {String(value)}
        </span>
        {redact && typeof value === 'string' && revealed ? (
          <button
            type="button"
            onClick={() => setRevealed(false)}
            aria-label="Hide value"
            className={cn('rounded p-0.5 text-muted-foreground hover:text-foreground', FOCUS_RING)}
          >
            <EyeOff className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}
      </span>
    );
  }
  if (Array.isArray(value)) {
    return (
      <ul className="border-l border-border/60 pl-3">
        {value.slice(0, 50).map((v, i) => (
          <li key={i} className="text-[12px]">
            <span className="text-muted-foreground">[{i}]</span>{' '}
            <MetaTree value={v} redact={redact} depth={depth + 1} />
          </li>
        ))}
        {value.length > 50 ? (
          <li className="text-[12px] text-muted-foreground">… +{value.length - 50} more</li>
        ) : null}
      </ul>
    );
  }
  // object
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  return (
    <ul className="border-l border-border/60 pl-3">
      {keys.map((k) => (
        <li key={k} className="text-[12px]">
          <span className="font-medium text-foreground/80">{k}</span>:{' '}
          <MetaTree value={obj[k]} redact={redact} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore — copy is best effort
  }
}

export function LogsDetailPanel({
  entry,
  sourceLabel,
  onShowTrace,
  redact = false,
}: LogsDetailPanelProps) {
  const overviewRows = useMemo(
    () => (entry ? buildOverviewRows(entry, sourceLabel) : []),
    [entry, sourceLabel]
  );
  if (!entry) {
    return <LogsEmpty variant="selection" />;
  }

  const rawJson = formatJson(entry);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 flex-col gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <LogLevelBadge level={entry.level} />
          <span className="truncate text-[12px] text-muted-foreground">{entry.event}</span>
        </div>
        <p className="truncate text-sm font-medium text-foreground">{entry.message}</p>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void copyText(rawJson)}
            className={cn('h-7 gap-1.5 px-2 text-xs', FOCUS_RING)}
          >
            <Copy className="h-3 w-3" aria-hidden="true" />
            Copy JSON
          </Button>
          {entry.requestId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => entry.requestId && void copyText(entry.requestId)}
              className={cn('h-7 gap-1.5 px-2 text-xs', FOCUS_RING)}
            >
              <Copy className="h-3 w-3" aria-hidden="true" />
              Copy requestId
            </Button>
          ) : null}
          {entry.requestId && onShowTrace ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => entry.requestId && onShowTrace(entry.requestId)}
              className={cn('h-7 gap-1.5 px-2 text-xs', FOCUS_RING)}
            >
              <GitBranch className="h-3 w-3" aria-hidden="true" />
              Show trace
            </Button>
          ) : null}
        </div>
      </header>

      <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="m-2 h-8 w-fit bg-muted/40">
          <TabsTrigger value="overview" className="text-xs">
            Overview
          </TabsTrigger>
          <TabsTrigger value="context" className="text-xs">
            Context
          </TabsTrigger>
          <TabsTrigger value="raw" className="text-xs">
            Raw
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="m-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 pb-4">
              {overviewRows.map((row) => (
                <DetailRow key={row.label} {...row} />
              ))}
              {entry.error ? (
                <div className="col-span-2 mt-2 rounded border border-red-500/30 bg-red-500/5 p-3">
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                    {entry.error.code ?? 'Error'}: {entry.error.message}
                  </p>
                  {entry.error.stack ? (
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-red-700/80 dark:text-red-300/80">
                      {entry.error.stack}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </dl>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="context" className="m-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="px-4 pb-4 text-[12px] leading-relaxed">
              {entry.metadata && Object.keys(entry.metadata).length > 0 ? (
                <MetaTree value={entry.metadata} redact={redact} />
              ) : (
                <p className="text-muted-foreground">No structured metadata.</p>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="raw" className="m-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <pre
              className={cn(
                'm-0 px-4 pb-4 text-[12px] leading-relaxed text-foreground/90',
                MONO_NUMERIC
              )}
            >
              {rawJson}
            </pre>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DetailRow({ label, value, mono }: OverviewRow) {
  return (
    <>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={cn('truncate text-[13px] text-foreground/90', mono && MONO_NUMERIC)}
        title={value === null || value === undefined ? undefined : String(value)}
      >
        {value ?? '—'}
      </dd>
    </>
  );
}
