import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SearchableSelect } from '@/components/ui/searchable-select';
import { render, screen, userEvent, waitFor } from '@tests/setup/test-utils';

function SearchableSelectHarness() {
  const [value, setValue] = useState<string | undefined>();

  return (
    <SearchableSelect
      value={value}
      onChange={setValue}
      placeholder="Select model"
      searchPlaceholder="Search models..."
      emptyText="No results found."
      groups={[
        { key: 'core', label: 'Core Models' },
        { key: 'other', label: 'Other Models' },
      ]}
      options={[
        {
          value: 'claude-sonnet-4',
          groupKey: 'core',
          searchText: 'Claude Sonnet 4 claude-sonnet-4',
          itemContent: <span>Claude Sonnet 4</span>,
        },
        {
          value: 'gpt-5.3-codex',
          groupKey: 'core',
          searchText: 'GPT-5.3 Codex gpt-5.3-codex',
          itemContent: <span>GPT-5.3 Codex</span>,
        },
        {
          value: 'gemini-2.5-pro',
          groupKey: 'other',
          searchText: 'Gemini 2.5 Pro gemini-2.5-pro',
          itemContent: <span>Gemini 2.5 Pro</span>,
        },
      ]}
    />
  );
}

function SearchableSelectWithCreateHarness() {
  const [value, setValue] = useState<string | undefined>();

  return (
    <SearchableSelect
      value={value}
      onChange={setValue}
      placeholder="Select model"
      searchPlaceholder="Search models..."
      emptyText="No results found."
      groups={[
        { key: 'known', label: 'Known Models' },
        { key: 'custom', label: 'Custom Model' },
      ]}
      createOption={(query) =>
        /^[a-z0-9][a-z0-9.-]*$/i.test(query)
          ? {
              value: query,
              groupKey: 'custom',
              searchText: query,
              itemContent: <span>Use custom model {query}</span>,
            }
          : null
      }
      options={[
        {
          value: 'claude-sonnet-4',
          groupKey: 'known',
          searchText: 'Claude Sonnet 4 claude-sonnet-4',
          itemContent: <span>Claude Sonnet 4</span>,
        },
      ]}
    />
  );
}

describe('SearchableSelect', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: vi.fn(() => false),
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('autofocuses the search input, filters options, and updates the selection', async () => {
    render(<SearchableSelectHarness />);

    await userEvent.click(screen.getByRole('button', { name: 'Select model' }));

    const searchInput = await screen.findByPlaceholderText('Search models...');
    await waitFor(() => {
      expect(searchInput).toHaveFocus();
    });
    expect(searchInput).toHaveAttribute('role', 'combobox');

    await userEvent.type(searchInput, 'gpt');

    expect(screen.getByText('GPT-5.3 Codex')).toBeInTheDocument();
    expect(screen.queryByText('Claude Sonnet 4')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('option', { name: 'GPT-5.3 Codex' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'GPT-5.3 Codex' })).toBeInTheDocument();
    });
  });

  it('shows the empty state when the search query has no matches', async () => {
    render(<SearchableSelectHarness />);

    await userEvent.click(screen.getByRole('button', { name: 'Select model' }));
    await userEvent.type(await screen.findByPlaceholderText('Search models...'), 'no-match');

    expect(screen.getByText('No results found.')).toBeInTheDocument();
  });

  it('can append and select a custom option from the search query', async () => {
    render(<SearchableSelectWithCreateHarness />);

    await userEvent.click(screen.getByRole('button', { name: 'Select model' }));
    await userEvent.type(await screen.findByPlaceholderText('Search models...'), 'claude-sonnet-5');

    expect(screen.getByText('Custom Model')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'Use custom model claude-sonnet-5' }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Use custom model claude-sonnet-5' })
      ).toBeInTheDocument();
    });
  });

  it('supports keyboard navigation and selection from the search input', async () => {
    render(<SearchableSelectHarness />);

    await userEvent.click(screen.getByRole('button', { name: 'Select model' }));

    const searchInput = await screen.findByRole('combobox', { name: 'Search models...' });
    await waitFor(() => {
      expect(searchInput).toHaveFocus();
    });

    expect(searchInput).toHaveAttribute(
      'aria-activedescendant',
      expect.stringContaining('claude-sonnet-4')
    );

    await userEvent.keyboard('[ArrowDown]');
    expect(searchInput).toHaveAttribute(
      'aria-activedescendant',
      expect.stringContaining('gpt-5-3-codex')
    );

    await userEvent.keyboard('[Enter]');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'GPT-5.3 Codex' })).toBeInTheDocument();
    });
  });

  it('renders options inside a native overflow container so wheel scrolling works', async () => {
    render(<SearchableSelectHarness />);

    await userEvent.click(screen.getByRole('button', { name: 'Select model' }));

    const scrollContainer = await screen.findByTestId('searchable-select-scroll-container');
    expect(scrollContainer).toHaveClass('max-h-72');
    expect(scrollContainer).toHaveClass('overflow-y-auto');
  });

  it('opens from the trigger with arrow keys', async () => {
    render(<SearchableSelectHarness />);

    await userEvent.keyboard('[Tab][ArrowDown]');

    const searchInput = await screen.findByRole('combobox', { name: 'Search models...' });
    await waitFor(() => {
      expect(searchInput).toHaveFocus();
    });
    expect(searchInput).toHaveAttribute(
      'aria-activedescendant',
      expect.stringContaining('claude-sonnet-4')
    );
  });
});
