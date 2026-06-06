import { render, screen } from '@tests/setup/test-utils';
import { describe, expect, it } from 'vitest';
import { LogsDetailPanel } from '@/components/logs/logs-detail-panel';
import type { LogsEntry } from '@/lib/api-client';

function buildEntry(overrides: Partial<LogsEntry> = {}): LogsEntry {
  return {
    id: 'entry-1',
    timestamp: '2026-04-07T11:00:00.000Z',
    level: 'info',
    source: 'dashboard',
    event: 'logs.bootstrap',
    message: 'Dashboard log entry',
    processId: 25582,
    runId: 'run-1',
    ...overrides,
  };
}

describe('LogsDetailPanel', () => {
  it('falls back to the raw timestamp when the selected log entry has an invalid timestamp', () => {
    render(<LogsDetailPanel entry={buildEntry({ timestamp: 'not-a-date' })} />);

    expect(screen.getByText('not-a-date')).toBeInTheDocument();
    expect(screen.getByTitle('not-a-date')).toHaveTextContent('not-a-date');
  });
});
