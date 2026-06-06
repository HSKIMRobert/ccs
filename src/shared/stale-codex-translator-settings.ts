export const CODEX_TRANSLATOR_URL_MARKER = '/api/provider/codex';

const MAX_CODEX_TRANSLATOR_SCAN_DEPTH = 100;
const MAX_CODEX_TRANSLATOR_SCAN_NODES = 10000;

function formatSettingsPathSegment(basePath: string, segment: string | number): string {
  if (typeof segment === 'number') {
    return `${basePath}[${segment}]`;
  }

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
    return basePath ? `${basePath}.${segment}` : segment;
  }

  return `${basePath}[${JSON.stringify(segment)}]`;
}

export function findCodexTranslatorUrlPaths(value: unknown, path = ''): string[] {
  const matches: string[] = [];
  const stack: Array<{ value: unknown; path: string; depth: number }> = [{ value, path, depth: 0 }];
  const seen = new WeakSet<object>();
  let visitedNodes = 0;

  while (stack.length > 0 && visitedNodes < MAX_CODEX_TRANSLATOR_SCAN_NODES) {
    const item = stack.pop();
    if (!item) {
      break;
    }

    visitedNodes += 1;

    if (typeof item.value === 'string') {
      if (item.value.includes(CODEX_TRANSLATOR_URL_MARKER)) {
        matches.push(item.path || '(root)');
      }
      continue;
    }

    if (typeof item.value !== 'object' || item.value === null) {
      continue;
    }

    if (seen.has(item.value)) {
      continue;
    }
    seen.add(item.value);

    if (item.depth >= MAX_CODEX_TRANSLATOR_SCAN_DEPTH) {
      continue;
    }

    if (Array.isArray(item.value)) {
      for (let index = item.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: item.value[index],
          path: formatSettingsPathSegment(item.path, index),
          depth: item.depth + 1,
        });
      }
      continue;
    }

    const entries = Object.entries(item.value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      stack.push({
        value: child,
        path: formatSettingsPathSegment(item.path, key),
        depth: item.depth + 1,
      });
    }
  }

  return matches;
}

export function formatSettingsPathList(paths: string[]): string {
  const visiblePaths = paths.slice(0, 5);
  const remainingCount = paths.length - visiblePaths.length;
  return remainingCount > 0
    ? `${visiblePaths.join(', ')} (+${remainingCount} more)`
    : visiblePaths.join(', ');
}
