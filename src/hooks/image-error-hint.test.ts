import { describe, expect, it } from 'bun:test';
import {
  IMAGE_ERROR_HINT,
  isImageInputError,
  registerImageErrorHint,
} from './image-error-hint';

describe('isImageInputError', () => {
  it('识别宿主的 clipboard / image input 错误', () => {
    expect(
      isImageInputError({
        message: 'Cannot read "clipboard" (this model does not support image input).',
      }),
    ).toBe(true);
    expect(
      isImageInputError({ type: 'provider.invalid-request', message: 'image input not supported by model' }),
    ).toBe(true);
  });

  it('不误伤普通错误', () => {
    expect(isImageInputError({ message: 'rate limit exceeded' })).toBe(false);
    expect(isImageInputError({})).toBe(false);
  });
});

describe('registerImageErrorHint', () => {
  it('命中图片错误时注入 synthetic 提示，普通错误不注入', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const hooks: Array<{ name: string; cb: (e: never) => Promise<void> }> = [];
    await registerImageErrorHint(
      {
        hook: async (name, cb) => {
          hooks.push({ name, cb: cb as never });
        },
      },
      async (input) => {
        calls.push(input);
      },
    );
    expect(hooks).toHaveLength(1);
    expect(hooks[0].name).toBe('retry');

    await hooks[0].cb({
      sessionID: 'ses_1',
      error: { message: 'Cannot read "clipboard" (this model does not support image input).' },
    } as never);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe(IMAGE_ERROR_HINT);

    await hooks[0].cb({ sessionID: 'ses_1', error: { message: '429' } } as never);
    expect(calls).toHaveLength(1);
  });

  it('synthetic 抛错时 fail-open 不外抛', async () => {
    const hooks: Array<{ cb: (e: never) => Promise<void> }> = [];
    await registerImageErrorHint(
      {
        hook: async (_name, cb) => {
          hooks.push({ cb: cb as never });
        },
      },
      async () => {
        throw new Error('boom');
      },
      () => {},
    );
    await expect(
      hooks[0].cb({ sessionID: 's', error: { message: 'does not support image input' } } as never),
    ).resolves.toBeUndefined();
  });
});
