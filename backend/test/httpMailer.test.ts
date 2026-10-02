import { describe, expect, it } from 'vitest';
import { ResendMailer, resendSettingsFromEnv } from '../src/services/httpMailer';

describe('ResendMailer', () => {
  it('posts the message to the provider with the key, sender and reply-to', async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response('{"id":"abc"}', { status: 200 });
    }) as unknown as typeof fetch;
    const mailer = new ResendMailer({ apiKey: 're_123', from: 'MyHockey <noreply@example.com>', replyTo: 'club@example.com' }, fetchImpl);

    await mailer.send({ to: 'jo@example.com', subject: 'Hello', text: 'Body' });

    expect(sent!.url).toBe('https://api.resend.com/emails');
    expect((sent!.init.headers as Record<string, string>).authorization).toBe('Bearer re_123');
    expect(JSON.parse(sent!.init.body as string)).toEqual({
      from: 'MyHockey <noreply@example.com>',
      to: ['jo@example.com'],
      subject: 'Hello',
      text: 'Body',
      reply_to: 'club@example.com',
    });
  });

  it('throws with the provider message when the send is refused', async () => {
    const fetchImpl = (async () => new Response('{"message":"Domain not verified"}', { status: 403 })) as unknown as typeof fetch;
    const mailer = new ResendMailer({ apiKey: 'k', from: 'a@b.c' }, fetchImpl);
    await expect(mailer.send({ to: 'x@y.z', subject: 's', text: 't' })).rejects.toThrow(/403.*Domain not verified/);
  });

  it('is only configured when both the key and the sender are set', () => {
    expect(resendSettingsFromEnv({ RESEND_API_KEY: 're_1' } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(resendSettingsFromEnv({ MAIL_FROM: 'a@b.c' } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(resendSettingsFromEnv({ RESEND_API_KEY: 're_1', MAIL_FROM: 'a@b.c' } as NodeJS.ProcessEnv)).toEqual({
      apiKey: 're_1',
      from: 'a@b.c',
      replyTo: undefined,
    });
  });
});
