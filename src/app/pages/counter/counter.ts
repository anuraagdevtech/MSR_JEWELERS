import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ShopStore } from '../../core/store';
import { UiService } from '../../core/ui.service';
import { AuthService } from '../../core/auth.service';
import { PaymentMode } from '../../core/models';
import { Icon } from '../../shared/icon';
import { GramsPipe, InrPipe } from '../../shared/pipes';

interface Entry {
  id: string;
  time: string;
  kind: 'bill' | 'receipt';
  ref: string;
  customer: string;
  amount: number;
  detail: string;
  billId?: string;
}

/** Today at the counter: quick actions, today's bills and receipts, and cash to hand over. */
@Component({
  selector: 'app-counter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, InrPipe, GramsPipe],
  templateUrl: './counter.html',
  styleUrl: './counter.scss',
})
export class CounterPage {
  protected readonly store = inject(ShopStore);
  protected readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);

  protected readonly todayLabel = computed(() =>
    new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()),
  );

  private readonly bills = computed(() => this.store.bills().filter((b) => b.date === this.store.today()));
  private readonly payments = computed(() => this.store.payments().filter((p) => p.date === this.store.today()));

  protected readonly summary = computed(() => {
    const totals = this.store.billTotals();
    const byMode = new Map<PaymentMode, number>();
    for (const p of this.payments()) byMode.set(p.mode, (byMode.get(p.mode) ?? 0) + p.amount);
    return {
      bills: this.bills().length,
      billed: this.bills().reduce((s, b) => s + (totals.get(b.id)?.total ?? 0), 0),
      received: this.payments().reduce((s, p) => s + p.amount, 0),
      receipts: this.payments().length,
      cash: byMode.get('Cash') ?? 0,
      oldGold: this.payments().reduce((s, p) => s + (p.oldGold?.weight ?? 0), 0),
      modes: [...byMode.entries()].sort((a, b) => b[1] - a[1]).map(([mode, amount]) => ({ mode, amount })),
    };
  });

  protected readonly entries = computed<Entry[]>(() => {
    const customers = this.store.customerById();
    const totals = this.store.billTotals();
    const time = (stamp: string) => stamp.slice(11, 16);
    const list: Entry[] = [
      ...this.bills().map((b) => ({
        id: b.id,
        time: time(b.createdAt),
        kind: 'bill' as const,
        ref: b.billNo,
        customer: customers.get(b.customerId)?.name ?? '—',
        amount: totals.get(b.id)?.total ?? 0,
        detail: b.items.map((i) => i.description).join(', '),
        billId: b.id,
      })),
      ...this.payments().map((p) => ({
        id: p.id,
        time: time(p.createdAt),
        kind: 'receipt' as const,
        ref: p.receiptNo,
        customer: customers.get(p.customerId)?.name ?? '—',
        amount: p.amount,
        detail: p.mode + (p.reference ? ` · ${p.reference}` : ''),
        billId: p.billId,
      })),
    ];
    return list.sort((a, b) => b.time.localeCompare(a.time));
  });
}
