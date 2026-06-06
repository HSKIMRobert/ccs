import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AllProviders } from '../../setup/test-utils';
import { useLogsWorkspace } from '@/hooks/use-logs';
import type { LogsEntry } from '@/lib/api-client';

function createJsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const entries: LogsEntry[] = [
  {
    id: 'http-audit-1',
    timestamp: '2026-05-29T00:00:00.000Z',
    level: 'error',
    source: 'web-server:http',
    event: 'request.completed',
    message: 'Dashboard request completed',
    processId: 1,
    runId: null,
    requestId: 'dashboard-audit',
  },
  {
    id: 'ws-audit-1',
    timestamp: '2026-05-29T00:00:01.000Z',
    level: 'warn',
    source: 'web-server:websocket',
    event: 'message.invalid',
    message: 'WebSocket client sent invalid JSON',
    processId: 1,
    runId: null,
    requestId: 'dashboard-audit',
  },
  {
    id: 'provider-1',
    timestamp: '2026-05-29T00:00:02.000Z',
    level: 'info',
    source: 'provider:codex',
    event: 'request.completed',
    message: 'Provider request completed',
    processId: 2,
    runId: null,
    requestId: 'provider-trace',
  },
];

function mockLogsApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/logs/config')) {
        return createJsonResponse({
          logging: {
            enabled: true,
            level: 'info',
            rotate_mb: 10,
            retain_days: 7,
            redact: true,
            live_buffer_size: 150,
          },
        });
      }
      if (url.startsWith('/api/logs/sources')) {
        return createJsonResponse({
          sources: entries.map((entry) => ({
            source: entry.source,
            label: entry.source,
            kind: 'native',
            count: 1,
            lastTimestamp: entry.timestamp,
          })),
        });
      }
      if (url.startsWith('/api/logs/entries')) {
        return createJsonResponse({ entries });
      }
      return createJsonResponse({ error: `Unexpected URL: ${url}` }, 404);
    })
  );
}

describe('useLogsWorkspace', () => {
  it('keeps dashboard audit events visible by default and only hides them on opt-in', async () => {
    mockLogsApi();

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AllProviders>{children}</AllProviders>
    );
    const { result } = renderHook(() => useLogsWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.entriesQuery.data?.map((entry) => entry.id)).toEqual([
        'http-audit-1',
        'ws-audit-1',
        'provider-1',
      ]);
    });

    act(() => result.current.setHideDashboardInternals(true));

    await waitFor(() => {
      expect(result.current.entriesQuery.data?.map((entry) => entry.id)).toEqual(['provider-1']);
    });

    act(() => result.current.clearAdvancedFilters());

    await waitFor(() => {
      expect(result.current.entriesQuery.data?.map((entry) => entry.id)).toEqual([
        'http-audit-1',
        'ws-audit-1',
        'provider-1',
      ]);
    });
  });
});
