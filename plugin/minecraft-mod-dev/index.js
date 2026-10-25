import { defineTool } from '@deepseek-ai/dsh-tools';
import { createRuntime } from './core.js';

export const name = 'mcdev';
export const inject = ['tools'];

export function apply(ctx) {
  const runtime = createRuntime();
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => runtime.close());
  }
  for (const tool of runtime.tools) {
    ctx.tools.register(defineTool({
      ...tool,
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
    }));
  }
}
