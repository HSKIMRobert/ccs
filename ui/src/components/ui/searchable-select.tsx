import * as React from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface SearchableSelectGroup {
  key: string;
  label?: React.ReactNode;
}

export interface SearchableSelectOption {
  value: string;
  searchText: string;
  itemContent: React.ReactNode;
  triggerContent?: React.ReactNode;
  keywords?: string[];
  groupKey?: string;
  disabled?: boolean;
}

interface SearchableSelectProps {
  value?: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  createOption?: (query: string) => SearchableSelectOption | null | undefined;
  groups?: SearchableSelectGroup[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function getOptionId(listboxId: string, value: string): string {
  return `${listboxId}-option-${value.replace(/[^a-z0-9_-]+/gi, '-')}`;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  createOption,
  groups,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled,
  className,
  triggerClassName,
  contentClassName,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeOptionValue, setActiveOptionValue] = React.useState<string>();
  const listboxId = React.useId();
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  const selectedOption = React.useMemo(
    () =>
      options.find((option) => option.value === value) ??
      (value ? (createOption?.(value) ?? undefined) : undefined),
    [createOption, options, value]
  );

  const filteredOptions = React.useMemo(() => {
    const normalizedQuery = normalizeSearch(query);
    if (!normalizedQuery) return options;

    const matchedOptions = options.filter((option) =>
      [option.searchText, ...(option.keywords ?? [])].some((candidate) =>
        normalizeSearch(candidate).includes(normalizedQuery)
      )
    );
    const createdOption = createOption?.(query.trim()) ?? null;
    if (!createdOption) return matchedOptions;

    const normalizedCreatedValue = normalizeSearch(createdOption.value);
    const optionAlreadyExists = options.some(
      (option) => normalizeSearch(option.value) === normalizedCreatedValue
    );
    if (optionAlreadyExists) return matchedOptions;

    return [...matchedOptions, createdOption];
  }, [createOption, options, query]);

  const groupedOptions = React.useMemo(() => {
    const knownGroups = new Map((groups ?? []).map((group) => [group.key, group]));
    const ungrouped = filteredOptions.filter(
      (option) => !option.groupKey || !knownGroups.has(option.groupKey)
    );
    const grouped = (groups ?? [])
      .map((group) => ({
        ...group,
        options: filteredOptions.filter((option) => option.groupKey === group.key),
      }))
      .filter((group) => group.options.length > 0);

    if (ungrouped.length === 0) return grouped;

    return [{ key: '__default', options: ungrouped }, ...grouped];
  }, [filteredOptions, groups]);

  const enabledFilteredOptions = React.useMemo(
    () => filteredOptions.filter((option) => !option.disabled),
    [filteredOptions]
  );

  const selectedContent = selectedOption?.triggerContent ?? selectedOption?.itemContent;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery('');
      setActiveOptionValue(undefined);
    }
  };

  const focusSearchInput = () => searchInputRef.current?.focus();

  React.useEffect(() => {
    if (!open) return;
    if (enabledFilteredOptions.length === 0) {
      setActiveOptionValue(undefined);
      return;
    }

    setActiveOptionValue((currentValue) => {
      if (currentValue && enabledFilteredOptions.some((option) => option.value === currentValue)) {
        return currentValue;
      }

      return (
        enabledFilteredOptions.find((option) => option.value === value)?.value ??
        enabledFilteredOptions[0]?.value
      );
    });
  }, [enabledFilteredOptions, open, value]);

  React.useEffect(() => {
    if (!open || !activeOptionValue) return;
    optionRefs.current[activeOptionValue]?.scrollIntoView({ block: 'nearest' });
  }, [activeOptionValue, open]);

  const moveActiveOption = (direction: 'next' | 'previous' | 'first' | 'last') => {
    if (enabledFilteredOptions.length === 0) return;
    if (direction === 'first') {
      setActiveOptionValue(enabledFilteredOptions[0]?.value);
      return;
    }
    if (direction === 'last') {
      setActiveOptionValue(enabledFilteredOptions.at(-1)?.value);
      return;
    }

    const currentIndex = enabledFilteredOptions.findIndex(
      (option) => option.value === activeOptionValue
    );
    const fallbackIndex = direction === 'next' ? -1 : enabledFilteredOptions.length;
    const startIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
    const nextIndex =
      direction === 'next'
        ? Math.min(startIndex + 1, enabledFilteredOptions.length - 1)
        : Math.max(startIndex - 1, 0);

    setActiveOptionValue(enabledFilteredOptions[nextIndex]?.value);
  };

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    handleOpenChange(false);
  };

  const selectActiveOption = () => {
    if (!activeOptionValue) return;
    const activeOption = enabledFilteredOptions.find(
      (option) => option.value === activeOptionValue
    );
    if (!activeOption) return;
    selectOption(activeOption.value);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-haspopup="dialog"
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            handleOpenChange(true);

            const setInitialActiveOption = () => {
              focusSearchInput();
              moveActiveOption(event.key === 'ArrowDown' ? 'first' : 'last');
            };

            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(setInitialActiveOption);
              return;
            }

            setTimeout(setInitialActiveOption, 0);
          }}
          className={cn(
            'w-full justify-between font-normal',
            className,
            triggerClassName,
            !selectedContent && 'text-muted-foreground'
          )}
        >
          <div className="min-w-0 flex-1 text-left">
            {selectedContent ?? <span>{placeholder}</span>}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn('w-[var(--radix-popover-trigger-width)] p-0', contentClassName)}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(focusSearchInput);
            return;
          }
          setTimeout(focusSearchInput, 0);
        }}
      >
        <div className="border-b p-2">
          <div className="relative">
            <Search className="text-muted-foreground absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              role="combobox"
              aria-label={searchPlaceholder}
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-activedescendant={
                activeOptionValue ? getOptionId(listboxId, activeOptionValue) : undefined
              }
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveActiveOption('next');
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveActiveOption('previous');
                  return;
                }
                if (event.key === 'Home') {
                  event.preventDefault();
                  moveActiveOption('first');
                  return;
                }
                if (event.key === 'End') {
                  event.preventDefault();
                  moveActiveOption('last');
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  selectActiveOption();
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  handleOpenChange(false);
                }
              }}
              placeholder={searchPlaceholder}
              className="pl-8"
            />
          </div>
        </div>

        <div
          data-slot="searchable-select-scroll-container"
          data-testid="searchable-select-scroll-container"
          className="max-h-72 overflow-y-auto overscroll-contain"
        >
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
          ) : (
            <div id={listboxId} role="listbox" aria-label={placeholder} className="p-1">
              {groupedOptions.map((group) => (
                <div key={group.key}>
                  {group.label && (
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      {group.label}
                    </div>
                  )}
                  {group.options.map((option) => {
                    const isActive = option.value === activeOptionValue;
                    const isSelected = option.value === value;
                    return (
                      <button
                        id={getOptionId(listboxId, option.value)}
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        disabled={option.disabled}
                        tabIndex={-1}
                        ref={(node) => {
                          optionRefs.current[option.value] = node;
                        }}
                        onMouseMove={() => {
                          if (!option.disabled) setActiveOptionValue(option.value);
                        }}
                        onFocus={() => {
                          if (!option.disabled) setActiveOptionValue(option.value);
                        }}
                        onClick={() => selectOption(option.value)}
                        className={cn(
                          'hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none',
                          'focus-visible:ring-ring focus-visible:ring-1',
                          isActive && 'bg-accent text-accent-foreground',
                          isSelected && 'bg-accent text-accent-foreground',
                          option.disabled && 'pointer-events-none opacity-50'
                        )}
                      >
                        <div className="min-w-0 flex-1">{option.itemContent}</div>
                        {isSelected && <Check className="h-4 w-4 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
