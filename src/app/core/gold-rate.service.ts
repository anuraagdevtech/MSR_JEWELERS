import { Injectable, signal } from '@angular/core';

const TROY_OUNCE_GRAMS = 31.1035;

export interface MarketReference {
  /** International spot converted to INR per gram of 24K. Excludes import duty and GST. */
  gold24PerGram: number;
  /** International silver spot converted to INR per gram of 999, when available. */
  silver999PerGram: number | null;
  fetchedAt: Date;
}

/**
 * Fetches a market reference so the counter can sanity-check its board rate.
 * It never changes the shop's rates on its own; staff apply it from Settings.
 */
@Injectable({ providedIn: 'root' })
export class GoldRateService {
  readonly reference = signal<MarketReference | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async refresh(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const [gold, silver, fx] = await Promise.all([
        fetch('https://api.gold-api.com/price/XAU').then((r) => (r.ok ? r.json() : null)),
        fetch('https://api.gold-api.com/price/XAG')
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch('https://open.er-api.com/v6/latest/USD').then((r) => (r.ok ? r.json() : null)),
      ]);
      const goldUsd = Number(gold?.price ?? 0);
      const silverUsd = Number(silver?.price ?? 0);
      const inr = Number(fx?.rates?.INR ?? 0);
      if (!goldUsd || !inr) throw new Error('incomplete');

      this.reference.set({
        gold24PerGram: Math.round((goldUsd * inr) / TROY_OUNCE_GRAMS),
        silver999PerGram: silverUsd ? Math.round(((silverUsd * inr) / TROY_OUNCE_GRAMS) * 10) / 10 : null,
        fetchedAt: new Date(),
      });
    } catch {
      this.error.set('Live market rate is unavailable right now. Enter today’s board rate manually.');
    } finally {
      this.loading.set(false);
    }
  }
}
