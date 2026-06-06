import { useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LogsSource } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  getLogLevelOptions,
  getLogsTimeWindowOptions,
  type LogsLevelFilter,
  type LogsSourceFilter,
  type LogsTimeWindow,
} from '@/hooks/use-logs';
import { FOCUS_RING } from './tokens';

export interface LogsFiltersProps {
  sources: LogsSource[];
  selectedSource: LogsSourceFilter;
  onSourceChange: (value: LogsSourceFilter) => void;
  selectedLevel: LogsLevelFilter;
  onLevelChange: (value: LogsLevelFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  limit: number;
  onLimitChange: (value: number) => void;
  onRefresh: () => void;
  isRefreshing: boolean;

  /** Phase-04 advanced filters (optional for back-compat). */
  moduleFilter?: string;
  onModuleChange?: (v: string) => void;
  stageFilter?: string;
  onStageChange?: (v: string) => void;
  requestIdFilter?: string;
  onRequestIdChange?: (v: string) => void;
  timeWindow?: LogsTimeWindow;
  onTimeWindowChange?: (v: LogsTimeWindow) => void;
  /** When true, hides entries from `web-server:*` sources. Default OFF. */
  hideDashboardInternals?: boolean;
  onHideDashboardInternalsChange?: (next: boolean) => void;
  onClearAll?: () => void;
}

interface ChipProps {
  label: string;
  onRemove: () => void;
}

function Chip({ label, onRemove }: ChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-foreground/80">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className={cn('rounded-full p-0.5 hover:bg-muted', FOCUS_RING)}
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}

export function LogsFilters({
  sources,
  selectedSource,
  onSourceChange,
  selectedLevel,
  onLevelChange,
  search,
  onSearchChange,
  limit,
  onLimitChange,
  onRefresh: _onRefresh,
  isRefreshing: _isRefreshing,
  moduleFilter = '',
  onModuleChange,
  stageFilter = '',
  onStageChange,
  requestIdFilter = '',
  onRequestIdChange,
  timeWindow = 'all',
  onTimeWindowChange,
  hideDashboardInternals = false,
  onHideDashboardInternalsChange,
  onClearAll,
}: LogsFiltersProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const levels = getLogLevelOptions();
  const limits = [50, 100, 150, 250];
  const timeWindows = getLogsTimeWindowOptions();

  const activeChips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (selectedLevel !== 'all') {
    activeChips.push({
      key: 'level',
      label: `level: ${selectedLevel}`,
      clear: () => onLevelChange('all'),
    });
  }
  if (selectedSource !== 'all') {
    const label = sources.find((s) => s.source === selectedSource)?.label ?? selectedSource;
    activeChips.push({
      key: 'source',
      label: `source: ${label}`,
      clear: () => onSourceChange('all'),
    });
  }
  if (search.trim()) {
    activeChips.push({
      key: 'search',
      label: `search: ${search}`,
      clear: () => onSearchChange(''),
    });
  }
  if (moduleFilter) {
    activeChips.push({
      key: 'module',
      label: `module: ${moduleFilter}`,
      clear: () => onModuleChange?.(''),
    });
  }
  if (stageFilter) {
    activeChips.push({
      key: 'stage',
      label: `stage: ${stageFilter}`,
      clear: () => onStageChange?.(''),
    });
  }
  if (requestIdFilter) {
    activeChips.push({
      key: 'requestId',
      label: `requestId: ${requestIdFilter}`,
      clear: () => onRequestIdChange?.(''),
    });
  }
  if (timeWindow !== 'all') {
    activeChips.push({
      key: 'timeWindow',
      label: `time: ${timeWindow}`,
      clear: () => onTimeWindowChange?.('all'),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Primary row */}
      <div className="space-y-2">
        <Label
          htmlFor="logs-search"
          className="text-[11px] uppercase tracking-wide text-muted-foreground"
        >
          Search
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="logs-search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search message, event, module"
            className="h-9 pl-8"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label
            htmlFor="logs-level"
            className="text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            Level
          </Label>
          <Select value={selectedLevel} onValueChange={(v) => onLevelChange(v as LogsLevelFilter)}>
            <SelectTrigger id="logs-level" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {levels.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label
            htmlFor="logs-source"
            className="text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            Source
          </Label>
          <Select
            value={selectedSource}
            onValueChange={(v) => onSourceChange(v as LogsSourceFilter)}
          >
            <SelectTrigger id="logs-source" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s.source} value={s.source}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Advanced */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 w-full justify-between px-2 text-xs font-medium', FOCUS_RING)}
            aria-expanded={advancedOpen}
          >
            Advanced filters
            <ChevronDown
              className={cn('h-3.5 w-3.5 transition-transform', advancedOpen && 'rotate-180')}
              aria-hidden="true"
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          {onModuleChange ? (
            <div className="space-y-1">
              <Label
                htmlFor="logs-module"
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Module
              </Label>
              <Input
                id="logs-module"
                value={moduleFilter}
                onChange={(e) => onModuleChange(e.target.value)}
                placeholder="e.g. cliproxy.router"
                className="h-9"
              />
            </div>
          ) : null}
          {onStageChange ? (
            <div className="space-y-1">
              <Label
                htmlFor="logs-stage"
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Stage
              </Label>
              <Input
                id="logs-stage"
                value={stageFilter}
                onChange={(e) => onStageChange(e.target.value)}
                placeholder="e.g. handler"
                className="h-9"
              />
            </div>
          ) : null}
          {onRequestIdChange ? (
            <div className="space-y-1">
              <Label
                htmlFor="logs-request-id"
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Request ID
              </Label>
              <Input
                id="logs-request-id"
                value={requestIdFilter}
                onChange={(e) => onRequestIdChange(e.target.value)}
                placeholder="req_…"
                className="h-9 font-mono"
              />
            </div>
          ) : null}
          {onTimeWindowChange ? (
            <div className="space-y-1">
              <Label
                htmlFor="logs-time-window"
                className="text-[11px] uppercase tracking-wide text-muted-foreground"
              >
                Time window
              </Label>
              <Select
                value={timeWindow}
                onValueChange={(v) => onTimeWindowChange(v as LogsTimeWindow)}
              >
                <SelectTrigger id="logs-time-window" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timeWindows.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {onHideDashboardInternalsChange ? (
            <div className="flex items-start justify-between gap-3 rounded border border-border/60 bg-muted/20 p-2">
              <div className="space-y-0.5">
                <Label
                  htmlFor="logs-hide-internals"
                  className="block text-[12px] font-medium text-foreground"
                >
                  Hide dashboard web-server logs
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Optional noise reduction. Audit entries are visible by default.
                </p>
              </div>
              <input
                id="logs-hide-internals"
                type="checkbox"
                role="switch"
                checked={hideDashboardInternals}
                onChange={(e) => onHideDashboardInternalsChange(e.target.checked)}
                className={cn('mt-0.5 h-4 w-4 cursor-pointer accent-foreground', FOCUS_RING)}
                aria-label="Hide dashboard web-server logs"
              />
            </div>
          ) : null}
        </CollapsibleContent>
      </Collapsible>

      <div className="space-y-2">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Visible entries
        </Label>
        <div className="grid grid-cols-4 gap-1">
          {limits.map((option) => (
            <Button
              key={option}
              type="button"
              variant={limit === option ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => onLimitChange(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      </div>

      {activeChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Active:</span>
          {activeChips.map((c) => (
            <Chip key={c.key} label={c.label} onRemove={c.clear} />
          ))}
          {onClearAll ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearAll}
              className="h-7 px-2 text-[11px] text-muted-foreground"
            >
              Clear all
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
