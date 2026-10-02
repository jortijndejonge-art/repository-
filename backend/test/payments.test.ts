import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { MembershipPlan, Member } from '@hockey/contracts';
import type { DueMembership, PaymentInput, Repository } from '../src/db/repository';
import { buildApp } from '../src/app';
import { MemoryMailer } from '../src/services/mailer';
import {
  addInterval,
  DisabledProvider,
  PaymentService,
  StripeProvider,
  verifyStripeSignature,
  type PaymentProvider,
  type StripeEvent,
} from '../src/services/payments';

const plan: MembershipPlan = { id: 'plan-adult', clubId: 'club', name: 'Adult', amountPence: 9000, interval: 'quarter' };
const member: Member = { id: 'm1', clubId: 'club', firstName: 'Sam', lastName: 'Jones', email: 'sam@example.com' };
const NOW = new Date('2026-10-02T10:00:00Z');

function sign(body: string, secret: string, t = Math.floor(NOW.getTime() / 1000)) {
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/** Just the repository methods the payment service uses, held in memory. */
function fakeRepo(due: DueMembership[] = []) {
  const active = new Map<string, { status: string; due?: Date }>();
  const payments: PaymentInput[] = [];
  const reminded: string[] = [];
  const repo = {
    getMember: async (id: string) => (id === member.id ? member : null),
    getMembershipPlan: async (id: string) => (id === plan.id ? plan : null),
    getClub: async () => ({ id: 'club', name: 'Demo Hockey Club' }),
    activateMembership: async (m: string, p: string, d: Date) => void active.set(`${m}/${p}`, { status: 'active', due: d }),
    setMembershipStatus: async (m: string, p: string, status: string) => {
      const row = active.get(`${m}/${p}`);
      if (row) row.status = status;
    },
    recordPayment: async (p: PaymentInput) => {
      if (payments.some((x) => x.stripePaymentId === p.stripePaymentId)) return false;
      payments.push(p);
      return true;
    },
    listDueMemberships: async () => due,
    markReminded: async (m: string, p: string) => void reminded.push(`${m}/${p}`),
  };
  return { repo: repo as unknown as Repository, active, payments, reminded };
}

const fakeProvider = (calls: unknown[] = []): PaymentProvider => ({
  enabled: true,
  createCheckout: async (input) => {
    calls.push(input);
    return { url: 'https://checkout.test/session' };
  },
  verifyWebhook: () => {
    throw new Error('not used');
  },
});

describe('Stripe signature check', () => {
  const secret = 'whsec_test';
  const body = '{"id":"evt_1"}';

  it('accepts a correctly signed body', () => {
    expect(() => verifyStripeSignature(body, sign(body, secret), secret, NOW.getTime())).not.toThrow();
  });

  it('rejects a wrong secret, a tampered body, a missing header and an old timestamp', () => {
    expect(() => verifyStripeSignature(body, sign(body, 'other'), secret, NOW.getTime())).toThrow(/signature/i);
    expect(() => verifyStripeSignature(body + ' ', sign(body, secret), secret, NOW.getTime())).toThrow(/signature/i);
    expect(() => verifyStripeSignature(body, undefined, secret, NOW.getTime())).toThrow(/signature/i);
    const old = Math.floor(NOW.getTime() / 1000) - 3600;
    expect(() => verifyStripeSignature(body, sign(body, secret, old), secret, NOW.getTime())).toThrow(/signature/i);
  });
});

describe('StripeProvider', () => {
  it('creates a recurring GBP checkout carrying who is paying for what', async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      request = { url, init };
      return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/abc' }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new StripeProvider('sk_test_123', 'whsec_x', fetchImpl);

    const result = await provider.createCheckout({
      plan,
      member,
      clubName: 'Demo Hockey Club',
      successUrl: 'https://app/?payment=success',
      cancelUrl: 'https://app/?payment=cancelled',
    });

    expect(result.url).toBe('https://checkout.stripe.com/c/pay/abc');
    expect(request!.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect((request!.init.headers as Record<string, string>).authorization).toBe('Bearer sk_test_123');
    const form = new URLSearchParams(request!.init.body as URLSearchParams);
    expect(form.get('mode')).toBe('subscription');
    expect(form.get('line_items[0][price_data][currency]')).toBe('gbp');
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('9000');
    expect(form.get('line_items[0][price_data][recurring][interval]')).toBe('month');
    expect(form.get('line_items[0][price_data][recurring][interval_count]')).toBe('3');
    expect(form.get('metadata[memberId]')).toBe('m1');
    expect(form.get('subscription_data[metadata][planId]')).toBe('plan-adult');
    expect(form.get('customer_email')).toBe('sam@example.com');
  });

  it('turns a Stripe error into a 502 with its message', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 })) as unknown as typeof fetch;
    const provider = new StripeProvider('bad', 'whsec_x', fetchImpl);
    await expect(
      provider.createCheckout({ plan, member, clubName: 'C', successUrl: 's', cancelUrl: 'c' }),
    ).rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining('Invalid API Key') });
  });

  it('refuses webhooks when no webhook secret is configured', () => {
    expect(() => new StripeProvider('sk', undefined).verifyWebhook('{}', 'x')).toThrow(/not set up/i);
  });
});

describe('PaymentService', () => {
  const service = (repo: Repository, provider: PaymentProvider, mailer = new MemoryMailer()) =>
    new PaymentService(repo, provider, mailer, 'https://www.example.com/myhockey/', () => NOW);

  it('reports payments as off until a provider is connected', () => {
    expect(service(fakeRepo().repo, new DisabledProvider()).config()).toEqual({ enabled: false });
    expect(service(fakeRepo().repo, fakeProvider()).config()).toEqual({ enabled: true });
  });

  it('starts a checkout that returns to the app, and refuses when payments are off', async () => {
    const calls: any[] = [];
    const url = await service(fakeRepo().repo, fakeProvider(calls)).checkout('m1', 'plan-adult');
    expect(url).toEqual({ url: 'https://checkout.test/session' });
    expect(calls[0].successUrl).toBe('https://www.example.com/myhockey/?payment=success');
    expect(calls[0].clubName).toBe('Demo Hockey Club');

    await expect(service(fakeRepo().repo, new DisabledProvider()).checkout('m1', 'plan-adult')).rejects.toMatchObject({
      statusCode: 503,
    });
    await expect(service(fakeRepo().repo, fakeProvider()).checkout('m1', 'nope')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('activates the membership when checkout completes, due one interval from now', async () => {
    const { repo, active } = fakeRepo();
    const event: StripeEvent = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'm1', metadata: { memberId: 'm1', planId: 'plan-adult' } } },
    };
    await service(repo, fakeProvider()).handleEvent(event);
    expect(active.get('m1/plan-adult')).toEqual({ status: 'active', due: new Date('2027-01-02T10:00:00Z') });
  });

  it('records a paid invoice once, even if Stripe delivers it twice', async () => {
    const { repo, payments } = fakeRepo();
    const event: StripeEvent = {
      id: 'evt_2',
      type: 'invoice.paid',
      data: { object: { id: 'in_1', amount_paid: 9000, subscription_details: { metadata: { memberId: 'm1', planId: 'plan-adult' } } } },
    };
    const svc = service(repo, fakeProvider());
    await svc.handleEvent(event);
    await svc.handleEvent(event);
    expect(payments).toEqual([
      { memberId: 'm1', planId: 'plan-adult', amountPence: 9000, status: 'succeeded', stripePaymentId: 'in_1' },
    ]);
  });

  it('marks a failed renewal overdue and a deleted subscription cancelled', async () => {
    const { repo, active, payments } = fakeRepo();
    const meta = { memberId: 'm1', planId: 'plan-adult' };
    const svc = service(repo, fakeProvider());
    await svc.handleEvent({ id: 'e1', type: 'checkout.session.completed', data: { object: { metadata: meta } } });
    await svc.handleEvent({
      id: 'e2',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_2', amount_due: 9000, subscription_details: { metadata: meta } } },
    });
    expect(active.get('m1/plan-adult')!.status).toBe('overdue');
    expect(payments[0]).toMatchObject({ status: 'failed', stripePaymentId: 'in_2:failed' });

    await svc.handleEvent({ id: 'e3', type: 'customer.subscription.deleted', data: { object: { metadata: meta } } });
    expect(active.get('m1/plan-adult')!.status).toBe('cancelled');
  });

  it('ignores events it does not use or that carry no member details', async () => {
    const { repo, active, payments } = fakeRepo();
    const svc = service(repo, fakeProvider());
    await svc.handleEvent({ id: 'e1', type: 'charge.refunded', data: { object: {} } });
    await svc.handleEvent({ id: 'e2', type: 'invoice.paid', data: { object: { id: 'in_9' } } });
    expect(active.size).toBe(0);
    expect(payments).toHaveLength(0);
  });

  it('emails members who are due soon or overdue and marks them reminded', async () => {
    const due: DueMembership[] = [
      { memberId: 'm1', planId: 'plan-adult', planName: 'Adult', amountPence: 9000, nextPaymentDue: '2026-10-05T00:00:00Z', firstName: 'Sam', email: 'sam@example.com' },
      { memberId: 'm2', planId: 'plan-adult', planName: 'Adult', amountPence: 9000, nextPaymentDue: '2026-09-28T00:00:00Z', firstName: 'Kim', email: 'kim@example.com' },
      { memberId: 'm3', planId: 'plan-adult', planName: 'Adult', amountPence: 9000, nextPaymentDue: '2026-10-04T00:00:00Z', firstName: 'No Email' },
    ];
    const { repo, reminded } = fakeRepo(due);
    const mailer = new MemoryMailer();
    const sent = await service(repo, fakeProvider(), mailer).sendDueReminders();
    expect(sent).toBe(2);
    expect(mailer.sent.map((m) => m.to)).toEqual(['sam@example.com', 'kim@example.com']);
    expect(mailer.sent[0]!.subject).toContain('renews soon');
    expect(mailer.sent[0]!.text).toContain('£90.00');
    expect(mailer.sent[1]!.subject).toContain('overdue');
    expect(reminded).toEqual(['m1/plan-adult', 'm2/plan-adult']);
  });
});

describe('addInterval', () => {
  it('adds one, three or twelve months', () => {
    const from = new Date('2026-01-15T00:00:00Z');
    expect(addInterval(from, 'month').toISOString()).toBe('2026-02-15T00:00:00.000Z');
    expect(addInterval(from, 'quarter').toISOString()).toBe('2026-04-15T00:00:00.000Z');
    expect(addInterval(from, 'year').toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });
});

describe('POST /webhooks/stripe', () => {
  const secret = 'whsec_route';
  const config = { appUrl: 'http://app.test', magicLinkTtlMinutes: 15, sessionTtlDays: 30, exposeDevLinks: true };
  const body = JSON.stringify({
    id: 'evt_route',
    type: 'checkout.session.completed',
    data: { object: { metadata: { memberId: 'm1', planId: 'plan-adult' } } },
  });
  const post = (app: ReturnType<typeof buildApp>, signature?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      headers: { 'content-type': 'application/json', ...(signature ? { 'stripe-signature': signature } : {}) },
      payload: body,
    });

  it('verifies the signature against the raw body and applies the event', async () => {
    const { repo, active } = fakeRepo();
    const app = buildApp({ repo, mailer: new MemoryMailer(), config, payments: new StripeProvider('sk', secret) });
    const ok = await post(app, sign(body, secret, Math.floor(Date.now() / 1000)));
    expect(ok.statusCode).toBe(200);
    expect(active.has('m1/plan-adult')).toBe(true);
  });

  it('rejects a bad or missing signature without changing anything', async () => {
    const { repo, active } = fakeRepo();
    const app = buildApp({ repo, mailer: new MemoryMailer(), config, payments: new StripeProvider('sk', secret) });
    expect((await post(app, sign(body, 'wrong'))).statusCode).toBe(400);
    expect((await post(app)).statusCode).toBe(400);
    expect(active.size).toBe(0);
  });

  it('answers 503 while payments are not set up', async () => {
    const app = buildApp({ repo: fakeRepo().repo, mailer: new MemoryMailer(), config });
    expect((await post(app, sign(body, secret, Math.floor(Date.now() / 1000)))).statusCode).toBe(503);
  });
});
