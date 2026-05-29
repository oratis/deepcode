---
name: deepseek-api
description: Help build/debug DeepSeek API usage (openai-compatible).
---

# deepseek-api

DeepSeek's HTTP API is OpenAI-Compatible. Use the same patterns; just
swap the base URL and key.

## When to invoke

- User asks "how do I call DeepSeek", "debug my chat completion call",
  "stream tool calls from DeepSeek", etc.

## Basics

- **Base URL**: `https://api.deepseek.com/v1`
- **Auth**: `Authorization: Bearer <DEEPSEEK_API_KEY>` (or set via env)
- **SDK**: any OpenAI-compatible SDK works; e.g. `openai` npm with
  `baseURL: 'https://api.deepseek.com/v1'`.

## Models

| Model               | Alias                 | Strengths                                       |
| ------------------- | --------------------- | ----------------------------------------------- |
| `deepseek-chat`     | → `deepseek-v4-flash` | Fast general chat; tool use                     |
| `deepseek-reasoner` | → `deepseek-v4-pro`   | Multi-step reasoning; emits `reasoning_content` |

Set via the standard `model` field.

## Streaming

Pass `stream: true`. SSE chunks come back as `data: {...}\n\n`. Each
chunk has `choices[0].delta.content` for text deltas, and
`choices[0].delta.tool_calls[]` for partial tool calls.

`deepseek-reasoner` ALSO emits `choices[0].delta.reasoning_content` —
the thinking trace. UI should render this in a collapsible panel.

## Tool calling

Standard OpenAI shape:

```js
const r = await client.chat.completions.create({
  model: 'deepseek-chat',
  messages: [...],
  tools: [{
    type: 'function',
    function: {
      name: 'Read',
      description: '...',
      parameters: { type: 'object', properties: {...}, required: [...] }
    }
  }],
  tool_choice: 'auto',
});
```

Response includes `choices[0].message.tool_calls[]` when the model
chose to call a tool. Loop: send back `role: 'tool'` messages with the
`tool_call_id`, get next assistant message, repeat until no tool calls.

## Pricing (rough; verify on dashboard)

| Tier              | Input | Output | Reasoning |
| ----------------- | ----- | ------ | --------- |
| deepseek-chat     | 1¥/M  | 2¥/M   | —         |
| deepseek-reasoner | 1¥/M  | 16¥/M  | 4¥/M      |

## Common pitfalls

- **`temperature: 1.0` makes tool calls flaky** — drop to 0.3 for tool use.
- **Streaming + tool_use** — must accumulate tool args across chunks; the
  args field comes in pieces.
- **`reasoning_content` is not in messages** — it's separate; don't try
  to echo it back as a content block to the model.
