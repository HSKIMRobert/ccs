import { describe, expect, it } from 'bun:test';

import {
  parseTomlObject,
  proposeJoinedCodexModelMigrationRepair,
} from '../../../src/shared/toml-object';

describe('joined Codex model migration TOML recovery', () => {
  it('proposes the exact one-newline repair for a joined following table header', () => {
    const rawText = `model = "gpt-5.4"

[notice.model_migrations]
"gpt-5.3-codex" = "gpt-5.4"[agents.code_simplifier]
description = "Keep this exact text"
`;

    const proposal = proposeJoinedCodexModelMigrationRepair(rawText);
    const insertionOffset = rawText.indexOf('[agents.code_simplifier]');

    expect(proposal).toEqual({
      repairedText: `${rawText.slice(0, insertionOffset)}\n${rawText.slice(insertionOffset)}`,
      insertionOffset,
    });
    expect(() => parseTomlObject(proposal?.repairedText ?? '')).not.toThrow();
  });

  it('preserves a UTF-8 BOM, CRLF endings, comments, spacing, and quoting', () => {
    const rawText =
      "\uFEFF# exact comment\r\n[notice.model_migrations]\r\n  'gpt-5.3-codex' = 'gpt-5.4'[[agents]]\r\nname = \"one\"\r\n";

    const proposal = proposeJoinedCodexModelMigrationRepair(rawText);
    const insertionOffset = rawText.indexOf('[[agents]]');

    expect(proposal?.repairedText).toBe(
      `${rawText.slice(0, insertionOffset)}\r\n${rawText.slice(insertionOffset)}`
    );
    expect(proposal?.insertionOffset).toBe(insertionOffset);
  });

  it('does not propose a repair for valid TOML', () => {
    const rawText = `[notice.model_migrations]
"gpt-5.3-codex" = "gpt-5.4"

[agents.code_simplifier]
description = "valid"
`;

    expect(proposeJoinedCodexModelMigrationRepair(rawText)).toBeNull();
  });

  it('does not generically repair a joined boundary outside the migration table', () => {
    const rawText = `model = "gpt-5.4"[agents.code_simplifier]
description = "invalid"
`;

    expect(proposeJoinedCodexModelMigrationRepair(rawText)).toBeNull();
  });

  it('ignores a migration table lookalike inside a multiline TOML string', () => {
    const rawText = `description = """
[notice.model_migrations]
"""
"old" = "new"[agents.outside]
`;

    expect(proposeJoinedCodexModelMigrationRepair(rawText)).toBeNull();
  });

  it('does not propose a repair for unrelated invalid TOML', () => {
    expect(proposeJoinedCodexModelMigrationRepair('model = "gpt-5.4"\n[features\n')).toBeNull();
  });

  it('requires a quoted string-to-string migration mapping', () => {
    const rawText = `[notice.model_migrations]
gpt-5 = 54[agents.code_simplifier]
description = "invalid"
`;

    expect(proposeJoinedCodexModelMigrationRepair(rawText)).toBeNull();
  });

  it('does not propose a repair when the following text is not a valid table header', () => {
    const rawText = `[notice.model_migrations]
"gpt-5.3-codex" = "gpt-5.4"[agents.code_simplifier
`;

    expect(proposeJoinedCodexModelMigrationRepair(rawText)).toBeNull();
  });

  it('does not propose a repair when another syntax error would remain', () => {
    const rawText = `[notice.model_migrations]
"gpt-5.3-codex" = "gpt-5.4"[agents.code_simplifier]
description = "valid"
[features
`;

    expect(proposeJoinedCodexModelMigrationRepair(rawText)).toBeNull();
  });

  it('does not propose an ambiguous repair when multiple joined boundaries match', () => {
    const rawText = `[notice.model_migrations]
"gpt-5.2" = "gpt-5.3"[agents.first]
name = "first"

[notice.model_migrations]
"gpt-5.3" = "gpt-5.4"[agents.second]
name = "second"
`;

    expect(proposeJoinedCodexModelMigrationRepair(rawText)).toBeNull();
  });

  it('does not treat a joined-looking string inside a multiline value as a repair candidate', () => {
    const rawText = `[notice.model_migrations]
note = """
"gpt-5.3-codex" = "gpt-5.4"[agents.code_simplifier]
"""
[features
`;

    expect(proposeJoinedCodexModelMigrationRepair(rawText)).toBeNull();
  });
});
