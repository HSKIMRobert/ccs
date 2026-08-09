import { describe, expect, it } from 'bun:test';

import { ProxyRequestTransformer } from '../../../../src/proxy/transformers/request-transformer';

describe('ProxyRequestTransformer regressions', () => {
  it('drops assistant messages that only contain stripped thinking blocks', () => {
    const result = new ProxyRequestTransformer().transform({
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', text: 'internal' },
            { type: 'redacted_thinking', text: 'hidden' },
          ],
        },
      ],
    });

    expect(result.messages).toEqual([]);
  });

  it('maps adaptive thinking through output_config effort for OpenAI-compatible upstreams', () => {
    const result = new ProxyRequestTransformer().transform({
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'max' },
    });

    expect(result.reasoning_effort).toBe('high');
    expect(result.reasoning).toBeUndefined();
  });

  it('explicitly normalizes anthropic xhigh adaptive effort for OpenAI-compatible upstreams', () => {
    const result = new ProxyRequestTransformer().transform({
      messages: [{ role: 'user', content: 'hello' }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'xhigh' },
    });

    expect(result.reasoning_effort).toBe('high');
    expect(result.reasoning).toBeUndefined();
  });

  it('rejects unsupported thinking types instead of silently dropping them', () => {
    expect(() =>
      new ProxyRequestTransformer().transform({
        messages: [{ role: 'user', content: 'hello' }],
        thinking: { type: 'typo' },
      })
    ).toThrow('thinking.type must be "enabled", "adaptive", or "disabled"');
  });

  it('keeps Anthropic role validation for tool_use, image, and tool_result blocks', () => {
    expect(() =>
      new ProxyRequestTransformer().transform({
        messages: [{ role: 'user', content: [{ type: 'tool_use', name: 'search', input: {} }] }],
      })
    ).toThrow('tool_use requires assistant role');

    expect(() =>
      new ProxyRequestTransformer().transform({
        messages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'image',
                source: { type: 'url', url: 'https://example.com/image.png' },
              },
            ],
          },
        ],
      })
    ).toThrow('image requires user role');

    expect(() =>
      new ProxyRequestTransformer().transform({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'nope' }],
          },
        ],
      })
    ).toThrow('tool_result requires user role');
  });

  it('rejects orphaned, incomplete, or mixed-order tool_result blocks', () => {
    expect(() =>
      new ProxyRequestTransformer().transform({
        messages: [
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'orphan' }],
          },
        ],
      })
    ).toThrow('tool_result requires a preceding assistant tool_use');

    expect(() =>
      new ProxyRequestTransformer().transform({
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'docs' } },
              { type: 'tool_use', id: 'toolu_2', name: 'open', input: { url: 'https://example.com' } },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'partial' }],
          },
        ],
      })
    ).toThrow('must provide tool_result blocks for all pending tool_use ids');

    expect(() =>
      new ProxyRequestTransformer().transform({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'vision', input: { detail: 'high' } }],
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Here you go' },
              { type: 'tool_result', tool_use_id: 'toolu_1', content: 'result' },
            ],
          },
        ],
      })
    ).toThrow('text is not allowed before tool_result blocks for pending tool_use ids');

    expect(() =>
      new ProxyRequestTransformer().transform({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'vision', input: { detail: 'high' } }],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_1', content: 'result' },
              { type: 'text', text: 'follow-up' },
            ],
          },
        ],
      })
    ).not.toThrow();

    expect(() =>
      new ProxyRequestTransformer().transform({
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'docs' } },
              { type: 'tool_use', id: 'toolu_2', name: 'open', input: { url: 'https://example.com' } },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'toolu_1', content: 'partial' },
              { type: 'text', text: 'follow-up' },
              { type: 'tool_result', tool_use_id: 'toolu_2', content: 'done' },
            ],
          },
        ],
      })
    ).toThrow('text is not allowed between tool_result blocks for pending tool_use ids');

    expect(() =>
      new ProxyRequestTransformer().transform({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'vision', input: { detail: 'high' } }],
          },
          {
            role: 'user',
            content: 'plain follow-up',
          },
        ],
      })
    ).toThrow('must start with tool_result blocks for pending tool_use ids');
  });

  it('converts tool_result image blocks to text placeholders for OpenAI-compatible tool messages', () => {
    const result = new ProxyRequestTransformer().transform({
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'vision', input: { detail: 'high' } }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: [
                { type: 'text', text: 'screenshot captured' },
                {
                  type: 'image',
                  source: { type: 'url', url: 'https://storage.example.com/error.png?X-Amz-Signature=secret' },
                },
                {
                  type: 'image',
                  source: { type: 'base64', media_type: 'image/png', data: 'ZmFrZQ==' },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(result.messages[1]).toEqual({
      role: 'tool',
      tool_call_id: 'toolu_1',
      content:
        'screenshot captured\n[tool_result image omitted: url image payload]\n[tool_result image omitted: image/png base64 payload]',
    });
    expect(result.messages[1]?.content).not.toContain('https://storage.example.com');
    expect(result.messages[1]?.content).not.toContain('X-Amz-Signature');
    expect(result.messages[1]?.content).not.toContain('secret');
  });

  it('rejects unsupported assistant blocks instead of silently dropping them', () => {
    expect(() =>
      new ProxyRequestTransformer().transform({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'server_tool_use', id: 'srv_1' }],
          },
        ],
      })
    ).toThrow('type "server_tool_use" is not supported');
  });

  it('translates url images and tool_choice while coalescing repeated turns', () => {
    const result = new ProxyRequestTransformer().transform({
      tool_choice: {
        type: 'tool',
        name: 'vision',
        disable_parallel_tool_use: true,
      },
      tools: [{ name: 'vision', description: 'Inspect image', input_schema: { type: 'object' } }],
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', source: { type: 'url', url: 'https://example.com/cat.png' } }],
        },
        { role: 'user', content: [{ type: 'text', text: 'Describe it' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Checking' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'vision', input: { detail: 'high' } }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              is_error: true,
              content: [{ type: 'text', text: 'fetch failed' }],
            },
          ],
        },
      ],
    });

    expect(result.tool_choice).toEqual({
      type: 'function',
      function: { name: 'vision' },
    });
    expect(result.parallel_tool_calls).toBe(false);

    expect(result.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'https://example.com/cat.png' } },
        { type: 'text', text: 'Describe it' },
      ],
    });
    expect(result.messages[1]).toEqual({
      role: 'assistant',
      content: 'Checking',
      tool_calls: [
        {
          id: 'toolu_1',
          type: 'function',
          function: {
            name: 'vision',
            arguments: '{"detail":"high"}',
          },
        },
      ],
    });
    expect(result.messages[2]).toEqual({
      role: 'tool',
      tool_call_id: 'toolu_1',
      content: 'Error: fetch failed',
    });
  });

  it('defaults tools to auto tool_choice when none is specified', () => {
    const result = new ProxyRequestTransformer().transform({
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'search', description: 'Search docs', input_schema: { type: 'object' } }],
    });

    expect(result.tool_choice).toBe('auto');
  });

  it('merges the top-level system field with a mid-array system message into one leading system message', () => {
    // Claude Code sends the main system prompt via the top-level `system`
    // field AND a skill/plugin listing as a `role: "system"` message inside
    // `messages` (see #1459). Prepending the top-level field unconditionally
    // used to leave two non-adjacent `system` messages in the payload, which
    // strict OpenAI-compatible backends (LiteLLM among them) reject with:
    // `400 A 'system' message can only appear at index 0 of the messages array.`
    const result = new ProxyRequestTransformer().transform({
      system: [{ type: 'text', text: 'You are Claude Code, a CLI tool.' }],
      messages: [
        { role: 'user', content: 'ping' },
        {
          role: 'system',
          content: 'The following skills are available for use with the Skill tool:\n- foo',
        },
        { role: 'user', content: 'pong' },
      ],
    });

    const systemMessages = result.messages.filter((message) => message.role === 'system');
    expect(systemMessages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      role: 'system',
      content:
        'You are Claude Code, a CLI tool.\n\nThe following skills are available for use with the Skill tool:\n- foo',
    });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'ping\npong' });
  });

  it('hoists a late system message after complete parallel tool results without disturbing tool order', () => {
    const result = new ProxyRequestTransformer().transform({
      system: 'base instructions',
      messages: [
        { role: 'user', content: 'inspect both files' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_1', name: 'read', input: { path: 'a.ts' } },
            { type: 'tool_use', id: 'toolu_2', name: 'read', input: { path: 'b.ts' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'a contents' },
            { type: 'tool_result', tool_use_id: 'toolu_2', content: 'b contents' },
          ],
        },
        { role: 'system', content: 'late instructions' },
        { role: 'user', content: 'compare them' },
      ],
    });

    expect(result.messages).toEqual([
      { role: 'system', content: 'base instructions\n\nlate instructions' },
      { role: 'user', content: 'inspect both files' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'toolu_1',
            type: 'function',
            function: { name: 'read', arguments: '{"path":"a.ts"}' },
          },
          {
            id: 'toolu_2',
            type: 'function',
            function: { name: 'read', arguments: '{"path":"b.ts"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'toolu_1', content: 'a contents' },
      { role: 'tool', tool_call_id: 'toolu_2', content: 'b contents' },
      { role: 'user', content: 'compare them' },
    ]);
  });

  it('rejects a system message inserted before pending tool results', () => {
    expect(() =>
      new ProxyRequestTransformer().transform({
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'read', input: { path: 'a.ts' } }],
          },
          { role: 'system', content: 'interrupting instructions' },
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'a contents' }],
          },
        ],
      })
    ).toThrow('role must be "user" with tool_result blocks after assistant tool_use');
  });
});
