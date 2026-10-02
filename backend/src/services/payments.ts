import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BillingInterval, CheckoutSession, Id, MembershipPlan, Member, PaymentsConfig } from '@hockey/contracts';
import type { Repository } from '../db/repository';
import { badRequest, forbidden, HttpError, notFound } from './errors';
import type { Mailer } from './mailer';

/** The subset of a Stripe webhook event that we use. */
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, any> };
}

export interface CheckoutInput {
  plan: MembershipPlan;
  clubName: string;
  member: Member;
  successUrl: string;
  cancelUrl: string;
}

/** Everything the app needs from a payment processor, so Stripe can be swapped or faked. */
export interface PaymentProvider {
  readonly enabled: boolean;
  createCheckout(input: CheckoutInput): Promise<{ url: string }>;
  /** Check the signature and parse the event; throws a 400 HttpError if it isn't genuine. */
  verifyWebhook(rawBody: string, signatureHeader: string | undefined): StripeEvent;
}

const notSetUp = () => new HttpError(503, 'Online payments are not set up yet');

/** Used until a Stripe account is connected. */
export class DisabledProvider implements PaymentProvider {
  readonly enabled = false;
  async createCheckout(): Promise<{ url: string }> {
    throw notSetUp();
  }
  verifyWebhook(): StripeEvent {
    throw notSetUp();
  }
}

const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Verifies a `Stripe-Signature` header (t=…,v1=…) against the raw request body. */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowMs = Date.now()) {
  const bad = () => badRequest('Invalid Stripe signature');
  if (!header) throw bad();
  const parts = header.split(',').map((p) => p.trim().split('=') as [string, string]);
  const timestamp = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!timestamp || signatures.length === 0) throw bad();
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) throw bad();

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  const matches = signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matches) throw bad();
}

/** Stripe over its plain REST API (no SDK), using Checkout subscriptions. */
export class StripeProvider implements PaymentProvider {
  readonly enabled = true;

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createCheckout({ plan, clubName, member, successUrl, cancelUrl }: CheckoutInput) {
    const form = new URLSearchParams();
    const add = (key: string, value: string | number) => form.append(key, String(value));
    add('mode', 'subscription');
    add('success_url', successUrl);
    add('cancel_url', cancelUrl);
    add('client_reference_id', member.id);
    if (member.email) add('customer_email', member.email);
    add('line_items[0][quantity]', 1);
    add('line_items[0][price_data][currency]', 'gbp');
    add('line_items[0][price_data][unit_amount]', plan.amountPence);
    add('line_items[0][price_data][product_data][name]', `${clubName} – ${plan.name} membership`);
    add('line_items[0][price_data][recurring][interval]', plan.interval === 'year' ? 'year' : 'month');
    if (plan.interval === 'quarter') add('line_items[0][price_data][recurring][interval_count]', 3);
    // Carried on the session and the subscription, so every later webhook can tell who paid for what.
    for (const prefix of ['metadata', 'subscription_data[metadata]']) {
      add(`${prefix}[memberId]`, member.id);
      add(`${prefix}[planId]`, plan.id);
    }

    const res = await this.fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
    if (!res.ok || !body.url) {
      throw new HttpError(502, `Stripe could not start the payment: ${body.error?.message ?? res.statusText}`);
    }
    return { url: body.url };
  }

  verifyWebhook(rawBody: string, signatureHeader: string | undefined): StripeEvent {
    if (!this.webhookSecret) throw notSetUp();
    verifyStripeSignature(rawBody, signatureHeader, this.webhookSecret);
    try {
      return JSON.parse(rawBody) as StripeEvent;
    } catch {
      throw badRequest('Invalid webhook body');
    }
  }
}

export function addInterval(from: Date, interval: BillingInterval): Date {
  const months = interval === 'month' ? 1 : interval === 'quarter' ? 3 : 12;
  const next = new Date(from);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

const REMIND_WITHIN_DAYS = 7;
const REMIND_EVERY_DAYS = 6;
const DAY_MS = 86_400_000;

export const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export class PaymentService {
  constructor(
    private readonly repo: Repository,
    private readonly provider: PaymentProvider,
    private readonly mailer: Mailer,
    private readonly appUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  config(): PaymentsConfig {
    return { enabled: this.provider.enabled };
  }

  async checkout(memberId: Id, planId: Id): Promise<CheckoutSession> {
    const [member, plan] = await Promise.all([this.repo.getMember(memberId), this.repo.getMembershipPlan(planId)]);
    if (!member || !plan) throw notFound('Membership plan not found');
    if (member.clubId !== plan.clubId) throw forbidden('This plan belongs to another club');
    if (plan.amountPence <= 0) throw badRequest('This plan is free, so there is nothing to pay');
    const club = await this.repo.getClub(plan.clubId);
    const base = this.appUrl.replace(/\/+$/, '');
    return this.provider.createCheckout({
      plan,
      member,
      clubName: club?.name ?? 'Club',
      successUrl: `${base}/?payment=success`,
      cancelUrl: `${base}/?payment=cancelled`,
    });
  }

  /** Apply a verified Stripe event. Safe to receive more than once. */
  async handleEvent(event: StripeEvent): Promise<void> {
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        const who = this.who(obj.metadata, obj.client_reference_id);
        if (!who) return;
        const plan = await this.repo.getMembershipPlan(who.planId);
        if (plan) await this.repo.activateMembership(who.memberId, plan.id, addInterval(this.now(), plan.interval));
        return;
      }
      case 'invoice.paid': {
        const who = this.who(obj.subscription_details?.metadata ?? obj.metadata);
        if (!who) return;
        const plan = await this.repo.getMembershipPlan(who.planId);
        if (!plan) return;
        const isNew = await this.repo.recordPayment({
          ...who,
          amountPence: obj.amount_paid ?? plan.amountPence,
          status: 'succeeded',
          stripePaymentId: obj.id,
        });
        if (isNew) await this.repo.activateMembership(who.memberId, plan.id, addInterval(this.now(), plan.interval));
        return;
      }
      case 'invoice.payment_failed': {
        const who = this.who(obj.subscription_details?.metadata ?? obj.metadata);
        if (!who) return;
        await this.repo.recordPayment({
          ...who,
          amountPence: obj.amount_due ?? 0,
          status: 'failed',
          stripePaymentId: `${obj.id}:failed`,
        });
        await this.repo.setMembershipStatus(who.memberId, who.planId, 'overdue');
        return;
      }
      case 'customer.subscription.deleted': {
        const who = this.who(obj.metadata);
        if (who) await this.repo.setMembershipStatus(who.memberId, who.planId, 'cancelled');
        return;
      }
      default:
        return; // events we don't need
    }
  }

  /** Email members whose payment falls due within a week (or is overdue). Returns how many were emailed. */
  async sendDueReminders(): Promise<number> {
    const now = this.now();
    const due = await this.repo.listDueMemberships(
      new Date(now.getTime() + REMIND_WITHIN_DAYS * DAY_MS),
      new Date(now.getTime() - REMIND_EVERY_DAYS * DAY_MS),
    );
    let sent = 0;
    for (const m of due) {
      if (!m.email) continue;
      const overdue = new Date(m.nextPaymentDue) < now;
      const date = new Date(m.nextPaymentDue).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
      await this.mailer.send({
        to: m.email,
        subject: overdue ? `Your ${m.planName} membership payment is overdue` : `Your ${m.planName} membership renews soon`,
        text: `Hi ${m.firstName},\n\nYour ${m.planName} membership (${formatMoney(m.amountPence)}) ${
          overdue ? `was due on ${date}` : `is due on ${date}`
        }. You can check it or pay here:\n${this.appUrl.replace(/\/+$/, '')}/\n`,
      });
      await this.repo.markReminded(m.memberId, m.planId, now);
      sent++;
    }
    return sent;
  }

  private who(metadata: Record<string, string> | undefined, fallbackMemberId?: string) {
    const memberId = metadata?.memberId ?? fallbackMemberId;
    const planId = metadata?.planId;
    return memberId && planId ? { memberId, planId } : null;
  }
}
