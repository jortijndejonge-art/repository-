import { useCallback, useEffect, useState } from 'react';
import type { BillingInterval, MembershipPlan, MembershipRecord, Me, PaymentsConfig } from '@hockey/contracts';
import { api } from '../../api-client';
import { isClubAdmin } from '../../core/auth';
import { useToast } from '../../core/Toast';
import './membership.css';

const INTERVAL_LABEL: Record<BillingInterval, string> = { month: 'month', quarter: '3 months', year: 'year' };
const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function Membership({ me }: { me: Me }) {
  const toast = useToast();
  const [config, setConfig] = useState<PaymentsConfig | null>(null);
  const [plans, setPlans] = useState<MembershipPlan[] | null>(null);
  const [mine, setMine] = useState<MembershipRecord[]>([]);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, p, m] = await Promise.all([
      api.getPaymentsConfig(),
      api.getMembershipPlans(me.club.id),
      api.getMyMemberships(),
    ]);
    setConfig(c);
    setPlans(p);
    setMine(m);
  }, [me.club.id]);

  useEffect(() => {
    load().catch(() => toast('Could not load memberships'));
  }, [load, toast]);

  // Back from the payment page: say so once, then tidy the address bar.
  useEffect(() => {
    const result = new URLSearchParams(location.search).get('payment');
    if (!result) return;
    toast(result === 'success' ? 'Thanks! Your payment is being confirmed.' : 'Payment cancelled. You have not been charged.');
    history.replaceState(null, '', location.pathname);
  }, [toast]);

  const pay = async (plan: MembershipPlan) => {
    setBusyPlan(plan.id);
    try {
      const session = await api.startCheckout(plan.id);
      if (session.url) {
        location.href = session.url;
        return;
      }
      await load();
      toast(`Demo payment recorded for ${plan.name}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start the payment');
    } finally {
      setBusyPlan(null);
    }
  };

  const planFor = (id: string) => plans?.find((p) => p.id === id);
  const demo = api.mode === 'mock';

  return (
    <section className="membership">
      {config && !config.enabled && (
        <p className="membership__notice" role="status">
          Online payments aren&apos;t switched on yet. Your club will turn them on once its payment account is connected.
        </p>
      )}
      {demo && (
        <p className="membership__notice" role="status">
          Demo mode: payments are simulated and nobody is charged.
        </p>
      )}

      <h2 className="membership__heading">Your membership</h2>
      {mine.length === 0 ? (
        <p className="muted">You don&apos;t have a membership yet. Pick a plan below.</p>
      ) : (
        <ul className="membership__list">
          {mine.map((r) => (
            <li key={r.planId} className="membership__card">
              <div>
                <strong>{planFor(r.planId)?.name ?? 'Membership'}</strong>
                {r.nextPaymentDue && r.status !== 'cancelled' && (
                  <div className="muted small">Next payment {longDate(r.nextPaymentDue)}</div>
                )}
              </div>
              <span className={`membership__status membership__status--${r.status}`}>{r.status}</span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="membership__heading">Plans</h2>
      {plans === null ? (
        <p className="muted">Loading plans…</p>
      ) : plans.length === 0 ? (
        <p className="muted">Your club hasn&apos;t added any plans yet.</p>
      ) : (
        <ul className="membership__list">
          {plans.map((plan) => {
            const record = mine.find((r) => r.planId === plan.id);
            const active = record?.status === 'active';
            return (
              <li key={plan.id} className="membership__card">
                <div>
                  <strong>{plan.name}</strong>
                  <div className="muted small">
                    {money(plan.amountPence)} every {INTERVAL_LABEL[plan.interval]}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={active || busyPlan !== null || !config?.enabled}
                  onClick={() => pay(plan)}
                >
                  {active ? 'Active' : record ? 'Pay again' : 'Join'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {isClubAdmin(me) && (
        <AddPlan
          onAdd={async (plan) => {
            const created = await api.createMembershipPlan(me.club.id, plan);
            setPlans((cur) => [...(cur ?? []), created]);
            toast(`Added ${created.name}`);
          }}
        />
      )}
    </section>
  );
}

function AddPlan({ onAdd }: { onAdd: (plan: { name: string; amountPence: number; interval: BillingInterval }) => Promise<void> }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const pounds = Number(price);
  const valid = name.trim() !== '' && Number.isFinite(pounds) && pounds > 0;

  const submit = async () => {
    setBusy(true);
    try {
      await onAdd({ name: name.trim(), amountPence: Math.round(pounds * 100), interval });
      setName('');
      setPrice('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add the plan');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="membership__add">
      <h2 className="membership__heading">Add a plan (club admin)</h2>
      <div className="membership__form">
        <label className="field">
          <span className="field__label">Name</span>
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Price (£)</span>
          <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Charged every</span>
          <select value={interval} onChange={(e) => setInterval(e.target.value as BillingInterval)}>
            <option value="month">Month</option>
            <option value="quarter">3 months</option>
            <option value="year">Year</option>
          </select>
        </label>
        <button type="button" className="btn btn--primary" disabled={!valid || busy} onClick={submit}>
          Add plan
        </button>
      </div>
    </div>
  );
}
