/**
 * Counts events per key over a sliding window, in memory. Enough to slow down guessing and spamming on one
 * server; a restart forgets everything, which is fine for these short windows.
 */
export class Throttle {
  private readonly events = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  /** How many events for this key happened in the last `windowMs`. */
  count(key: string, windowMs: number): number {
    const recent = (this.events.get(key) ?? []).filter((t) => t > this.now() - windowMs);
    if (recent.length === 0) this.events.delete(key);
    else this.events.set(key, recent);
    return recent.length;
  }

  record(key: string): void {
    this.events.set(key, [...(this.events.get(key) ?? []), this.now()]);
    // Now and then, forget keys nobody has used for a day, so the map cannot grow without bound.
    if (this.events.size > 5000) {
      for (const [k, times] of this.events) if ((times[times.length - 1] ?? 0) < this.now() - 86_400_000) this.events.delete(k);
    }
  }

  /** Records an event and says whether it is within `limit` for the window. */
  allow(key: string, limit: number, windowMs: number): boolean {
    const ok = this.count(key, windowMs) < limit;
    if (ok) this.record(key);
    return ok;
  }

  clear(key: string): void {
    this.events.delete(key);
  }
}
