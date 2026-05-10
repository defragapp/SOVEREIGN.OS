/**
 * ai_client.test.ts — Unit tests for CF Workers AI client
 * Uses vitest with mocked env.AI binding
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  generateObject,
  streamText,
  generateEmbedding,
  selectModel,
  CF_MODEL_STANDARD,
  CF_MODEL_FAST,
  CF_EMBED_MODEL,
  type AiEnv,
} from '../src/ai_client';

// ── Mock AI binding ───────────────────────────────────────────────────────────
function makeEnv(runImpl: (model: string, opts: any) => any): AiEnv {
  return { AI: { run: vi.fn(runImpl) } };
}

// ── selectModel ───────────────────────────────────────────────────────────────
describe('selectModel', () => {
  it('returns standard model for covenant', () => {
    expect(selectModel('covenant')).toBe(CF_MODEL_STANDARD);
  });
  it('returns standard model for alignment/deep', () => {
    expect(selectModel('alignment', 'deep')).toBe(CF_MODEL_STANDARD);
  });
  it('returns fast model for alignment/standard', () => {
    expect(selectModel('alignment', 'standard')).toBe(CF_MODEL_FAST);
  });
  it('returns standard model for the_loop', () => {
    expect(selectModel('the_loop')).toBe(CF_MODEL_STANDARD);
  });
  it('returns fast model for defrag', () => {
    expect(selectModel('defrag')).toBe(CF_MODEL_FAST);
  });
  it('returns fast model for launcher', () => {
    expect(selectModel('launcher')).toBe(CF_MODEL_FAST);
  });
  it('returns fast model for compression', () => {
    expect(selectModel('compression')).toBe(CF_MODEL_FAST);
  });
  it('returns fast model for simulator', () => {
    expect(selectModel('simulator')).toBe(CF_MODEL_FAST);
  });
  it('returns fast model for unknown space', () => {
    expect(selectModel('unknown')).toBe(CF_MODEL_FAST);
  });
});

// ── generateObject ────────────────────────────────────────────────────────────
describe('generateObject', () => {
  const TestSchema = z.object({ answer: z.string(), score: z.number() });

  it('parses clean JSON response', async () => {
    const env = makeEnv(() => ({ response: '{"answer":"yes","score":9}' }));
    const result = await generateObject(env, {
      messages: [{ role: 'user', content: 'test' }],
      schema: TestSchema,
    });
    expect(result).toEqual({ answer: 'yes', score: 9 });
  });

  it('strips markdown fences from response', async () => {
    const env = makeEnv(() => ({
      response: '```json\n{"answer":"maybe","score":5}\n```',
    }));
    const result = await generateObject(env, {
      messages: [{ role: 'user', content: 'test' }],
      schema: TestSchema,
    });
    expect(result.answer).toBe('maybe');
    expect(result.score).toBe(5);
  });

  it('extracts JSON from prose response', async () => {
    const env = makeEnv(() => ({
      response: 'Here is my answer: {"answer":"extracted","score":7} Hope that helps.',
    }));
    const result = await generateObject(env, {
      messages: [{ role: 'user', content: 'test' }],
      schema: TestSchema,
    });
    expect(result.answer).toBe('extracted');
  });

  it('uses default standard model when model not specified', async () => {
    const mockRun = vi.fn(() => ({ response: '{"answer":"ok","score":1}' }));
    const env = { AI: { run: mockRun } };
    await generateObject(env, {
      messages: [{ role: 'user', content: 'test' }],
      schema: TestSchema,
    });
    expect(mockRun.mock.calls[0][0]).toBe(CF_MODEL_STANDARD);
  });

  it('uses specified model override', async () => {
    const mockRun = vi.fn(() => ({ response: '{"answer":"ok","score":1}' }));
    const env = { AI: { run: mockRun } };
    await generateObject(env, {
      model: CF_MODEL_FAST,
      messages: [{ role: 'user', content: 'test' }],
      schema: TestSchema,
    });
    expect(mockRun.mock.calls[0][0]).toBe(CF_MODEL_FAST);
  });

  it('injects JSON hint into existing system message', async () => {
    const mockRun = vi.fn(() => ({ response: '{"answer":"ok","score":1}' }));
    const env = { AI: { run: mockRun } };
    await generateObject(env, {
      messages: [
        { role: 'system', content: 'You are a test assistant.' },
        { role: 'user', content: 'test' },
      ],
      schema: TestSchema,
      schemaDescription: '{"answer":string,"score":number}',
    });
    const calledMessages = mockRun.mock.calls[0][1].messages;
    expect(calledMessages[0].role).toBe('system');
    expect(calledMessages[0].content).toContain('You are a test assistant.');
    expect(calledMessages[0].content).toContain('valid JSON');
  });

  it('prepends system message when none exists', async () => {
    const mockRun = vi.fn(() => ({ response: '{"answer":"ok","score":1}' }));
    const env = { AI: { run: mockRun } };
    await generateObject(env, {
      messages: [{ role: 'user', content: 'test' }],
      schema: TestSchema,
    });
    const calledMessages = mockRun.mock.calls[0][1].messages;
    expect(calledMessages[0].role).toBe('system');
    expect(calledMessages.length).toBe(2);
  });

  it('throws when no JSON found in response', async () => {
    const env = makeEnv(() => ({ response: 'I cannot answer that question.' }));
    await expect(
      generateObject(env, {
        messages: [{ role: 'user', content: 'test' }],
        schema: TestSchema,
      }),
    ).rejects.toThrow('No JSON object found');
  });

  it('throws when JSON fails Zod validation', async () => {
    const env = makeEnv(() => ({ response: '{"answer":"ok","score":"not-a-number"}' }));
    await expect(
      generateObject(env, {
        messages: [{ role: 'user', content: 'test' }],
        schema: TestSchema,
      }),
    ).rejects.toThrow();
  });

  it('passes response_format: json_object to AI binding', async () => {
    const mockRun = vi.fn(() => ({ response: '{"answer":"ok","score":1}' }));
    const env = { AI: { run: mockRun } };
    await generateObject(env, {
      messages: [{ role: 'user', content: 'test' }],
      schema: TestSchema,
    });
    expect(mockRun.mock.calls[0][1].response_format).toEqual({ type: 'json_object' });
  });
});

// ── streamText ────────────────────────────────────────────────────────────────
describe('streamText', () => {
  it('returns a ReadableStream', async () => {
    const fakeStream = new ReadableStream();
    const env = makeEnv(() => fakeStream);
    const result = await streamText(env, {
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result).toBeInstanceOf(ReadableStream);
  });

  it('passes stream: true to AI binding', async () => {
    const mockRun = vi.fn(() => new ReadableStream());
    const env = { AI: { run: mockRun } };
    await streamText(env, {
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(mockRun.mock.calls[0][1].stream).toBe(true);
  });

  it('uses standard model by default', async () => {
    const mockRun = vi.fn(() => new ReadableStream());
    const env = { AI: { run: mockRun } };
    await streamText(env, { messages: [{ role: 'user', content: 'hello' }] });
    expect(mockRun.mock.calls[0][0]).toBe(CF_MODEL_STANDARD);
  });
});

// ── generateEmbedding ─────────────────────────────────────────────────────────
describe('generateEmbedding', () => {
  it('returns 768-dim vector', async () => {
    const fakeVec = Array.from({ length: 768 }, (_, i) => i / 768);
    const env = makeEnv(() => ({ data: [fakeVec] }));
    const result = await generateEmbedding(env, 'hello world');
    expect(result).toHaveLength(768);
    expect(result[0]).toBeCloseTo(0);
  });

  it('uses bge-base-en-v1.5 model', async () => {
    const mockRun = vi.fn(() => ({ data: [new Array(768).fill(0)] }));
    const env = { AI: { run: mockRun } };
    await generateEmbedding(env, 'test');
    expect(mockRun.mock.calls[0][0]).toBe(CF_EMBED_MODEL);
  });

  it('throws when model returns no data', async () => {
    const env = makeEnv(() => ({ data: [] }));
    await expect(generateEmbedding(env, 'test')).rejects.toThrow('no data');
  });

  it('passes text as array to AI binding', async () => {
    const mockRun = vi.fn(() => ({ data: [new Array(768).fill(0)] }));
    const env = { AI: { run: mockRun } };
    await generateEmbedding(env, 'hello');
    expect(mockRun.mock.calls[0][1].text).toEqual(['hello']);
  });
});
