import { parse } from 'smol-toml';

export interface SafeTomlObjectParseResult {
  config: Record<string, unknown> | null;
  parseError: string | null;
}

function isTomlObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripUtf8Bom(rawText: string): string {
  return rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;
}

export function parseTomlObject(rawText: string): Record<string, unknown> {
  const parseText = stripUtf8Bom(rawText);
  const trimmed = parseText.trim();
  if (!trimmed) return {};

  const parsed = parse(parseText);
  if (!isTomlObject(parsed)) {
    throw new Error('TOML root must be a table.');
  }

  return parsed;
}

export interface TomlNewlineRepairProposal {
  repairedText: string;
  insertionOffset: number;
}

const CODEX_MODEL_MIGRATION_TABLE = /^[ \t]*\[notice\.model_migrations\][ \t]*(?:#.*)?$/;
const QUOTED_MIGRATION_JOIN =
  /^[ \t]*(?:"(?:\\.|[^"\\])*"|'[^']*')[ \t]*=[ \t]*(?:"(?:\\.|[^"\\])*"|'[^']*')(?=\[)/;
const TOML_TABLE_HEADER_SUFFIX = /^(?:\[\[[^\]\r\n]+\]\]|\[[^\]\r\n]+\])[ \t]*(?:#.*)?$/;

type TomlMultilineDelimiter = '"""' | "'''";

function isEscapedAt(text: string, offset: number): boolean {
  let backslashCount = 0;
  for (let index = offset - 1; index >= 0 && text[index] === '\\'; index -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function updateTomlMultilineDelimiter(
  line: string,
  initialDelimiter: TomlMultilineDelimiter | null
): TomlMultilineDelimiter | null {
  let delimiter = initialDelimiter;
  let cursor = 0;

  while (cursor < line.length) {
    if (delimiter) {
      const closingOffset = line.indexOf(delimiter, cursor);
      if (closingOffset === -1) return delimiter;
      if (delimiter === '"""' && isEscapedAt(line, closingOffset)) {
        cursor = closingOffset + 1;
        continue;
      }
      cursor = closingOffset + delimiter.length;
      delimiter = null;
      continue;
    }

    const char = line[cursor];
    if (char === '#') return null;
    if (line.startsWith('"""', cursor) || line.startsWith("'''", cursor)) {
      delimiter = line.slice(cursor, cursor + 3) as TomlMultilineDelimiter;
      cursor += 3;
      continue;
    }
    if (char === '"') {
      cursor += 1;
      while (cursor < line.length) {
        if (line[cursor] === '"' && !isEscapedAt(line, cursor)) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      continue;
    }
    if (char === "'") {
      const closingOffset = line.indexOf("'", cursor + 1);
      cursor = closingOffset === -1 ? line.length : closingOffset + 1;
      continue;
    }
    cursor += 1;
  }

  return delimiter;
}

export function safeParseTomlObject(rawText: string): SafeTomlObjectParseResult {
  try {
    return {
      config: parseTomlObject(rawText),
      parseError: null,
    };
  } catch (error) {
    return {
      config: null,
      parseError: (error as Error).message,
    };
  }
}

export function proposeJoinedCodexModelMigrationRepair(
  rawText: string
): TomlNewlineRepairProposal | null {
  if (!safeParseTomlObject(rawText).parseError) return null;

  const candidates: Array<{ insertionOffset: number; lineEnding: string }> = [];
  let cursor = 0;
  let inModelMigrationTable = false;
  let previousLineEnding = '\n';
  let multilineDelimiter: TomlMultilineDelimiter | null = null;

  while (cursor < rawText.length) {
    const newlineOffset = rawText.indexOf('\n', cursor);
    const rawLineEnd = newlineOffset === -1 ? rawText.length : newlineOffset;
    const usesCrLf = newlineOffset !== -1 && rawText[rawLineEnd - 1] === '\r';
    const contentEnd = usesCrLf ? rawLineEnd - 1 : rawLineEnd;
    const lineEnding = newlineOffset === -1 ? '' : usesCrLf ? '\r\n' : '\n';
    const rawLine = rawText.slice(cursor, contentEnd);
    const line = cursor === 0 && rawLine.charCodeAt(0) === 0xfeff ? rawLine.slice(1) : rawLine;

    if (!multilineDelimiter) {
      if (CODEX_MODEL_MIGRATION_TABLE.test(line)) {
        inModelMigrationTable = true;
      } else if (/^[ \t]*\[\[?/.test(line)) {
        inModelMigrationTable = false;
      } else if (inModelMigrationTable) {
        const joinedMapping = line.match(QUOTED_MIGRATION_JOIN);
        if (joinedMapping) {
          const suffix = line.slice(joinedMapping[0].length);
          if (TOML_TABLE_HEADER_SUFFIX.test(suffix)) {
            candidates.push({
              insertionOffset: cursor + joinedMapping[0].length,
              lineEnding: lineEnding || previousLineEnding,
            });
          }
        }
      }
    }
    multilineDelimiter = updateTomlMultilineDelimiter(line, multilineDelimiter);

    if (lineEnding) previousLineEnding = lineEnding;
    if (newlineOffset === -1) break;
    cursor = newlineOffset + 1;
  }

  if (candidates.length !== 1) return null;

  const [{ insertionOffset, lineEnding }] = candidates;
  const repairedText = `${rawText.slice(0, insertionOffset)}${lineEnding}${rawText.slice(insertionOffset)}`;

  try {
    parseTomlObject(repairedText);
    return { repairedText, insertionOffset };
  } catch {
    return null;
  }
}
