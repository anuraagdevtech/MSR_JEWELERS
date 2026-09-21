import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ShopStore } from '../../core/store';
import { UiService } from '../../core/ui.service';
import { Customer, CustomerSummary } from '../../core/models';
import { initials, phoneDigits } from '../../core/format';
import { downloadCsv } from '../../core/csv';
import { todayISO } from '../../core/dates';
import { Icon, IconName } from '../../shared/icon';
import { BalancePipe, DayPipe, InrPipe, PhonePipe } from '../../shared/pipes';

type Segment = 'all' | 'dues' | 'overdue' | 'advance';
type SortKey = 'balance' | 'recent' | 'name' | 'value';

interface Row {
  customer: Customer;
  summary: CustomerSummary;
  initials: string;
  status: { label: string; tone: string; icon: IconName };
}

@Component({
  selector: 'app-customers',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, InrPipe, BalancePipe, DayPipe, PhonePipe],
  templateUrl: './customers.html',
  styles: `
    .status-cell {
      width: 1%;
    }
    @media (max-width: 860px) {
      .hide-md {
        display: none;
      }
    }
  `,
})
export class CustomersPage {
  private readonly store = inject(ShopStore);
  private readonly ui = inject(UiService);
  private readonly router = inject(Router);

  /** `?show=dues|overdue|advance` from dashboard links. */
  readonly show = input<string>();

  protected readonly segment = linkedSignal<Segment>(() => {
    const show = this.show();
    return show === 'dues' || show === 'overdue' || show === 'advance' ? show : 'all';
  });
  protected readonly query = signal('');
  protected readonly sort = signal<SortKey>('balance');

  private readonly allRows = computed<Row[]>(() => {
    const summaries = this.store.customerSummaries();
    return this.store.customers().map((customer) => {
      const summary = summaries.get(customer.id)!;
      return { customer, summary, initials: initials(customer.name), status: statusOf(summary) };
    });
  });

  protected readonly segments = computed(() => {
    const rows = this.allRows();
    return [
      { key: 'all' as Segment, label: 'All', count: rows.length },
      { key: 'dues' as Segment, label: 'With dues', count: rows.filter((r) => r.summary.balance > 0).length },
      { key: 'overdue' as Segment, label: 'Overdue', count: rows.filter((r) => r.summary.overdueAmount > 0).length },
      { key: 'advance' as Segment, label: 'Advance held', count: rows.filter((r) => r.summary.balance < 0).length },
    ];
  });

  protected readonly rows = computed(() => {
    const term = this.query().trim().toLowerCase();
    const digits = phoneDigits(term);
    const segment = this.segment();
    const filtered = this.allRows().filter(({ customer, summary }) => {
      if (segment === 'dues' && summary.balance <= 0) return false;
      if (segment === 'overdue' && summary.overdueAmount <= 0) return false;
      if (segment === 'advance' && summary.balance >= 0) return false;
      if (!term) return true;
      return (
        customer.name.toLowerCase().includes(term) ||
        customer.city.toLowerCase().includes(term) ||
        (digits.length >= 3 && phoneDigits(customer.phone).includes(digits))
      );
    });
    const sort = this.sort();
    return filtered.sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.customer.name.localeCompare(b.customer.name);
        case 'recent':
          return (b.summary.lastActivity ?? '').localeCompare(a.summary.lastActivity ?? '');
        case 'value':
          return b.summary.billed - a.summary.billed;
        default:
          return b.summary.balance - a.summary.balance || a.customer.name.localeCompare(b.customer.name);
      }
    });
  });

  protected readonly totals = computed(() =>
    this.rows().reduce(
      (acc, { summary }) => ({
        billed: acc.billed + summary.billed,
        paid: acc.paid + summary.paid,
        balance: acc.balance + summary.balance,
      }),
      { billed: 0, paid: 0, balance: 0 },
    ),
  );

  protected addCustomer(): void {
    this.ui.openCustomer({ onSaved: (id) => void this.router.navigate(['/customers', id]) });
  }

  protected open(row: Row): void {
    void this.router.navigate(['/customers', row.customer.id]);
  }

  protected exportCsv(): void {
    downloadCsv(
      `msr-customers-${todayISO()}.csv`,
      ['Name', 'Phone', 'City', 'Bills', 'Total billed', 'Total paid', 'Balance (Dr+ / Cr-)', 'Overdue', 'Last activity'],
      this.rows().map(({ customer, summary }) => [
        customer.name,
        customer.phone,
        customer.city,
        summary.billsCount,
        Math.round(summary.billed),
        Math.round(summary.paid),
        summary.balance,
        summary.overdueAmount,
        summary.lastActivity ?? '',
      ]),
    );
  }
}

function statusOf(summary: CustomerSummary): Row['status'] {
  if (summary.overdueAmount > 0) return { label: 'Overdue', tone: 'critical', icon: 'alert' };
  if (summary.balance > 0) return { label: 'Due', tone: 'warning', icon: 'clock' };
  if (summary.balance < 0) return { label: 'Advance', tone: 'info', icon: 'wallet' };
  return { label: 'Settled', tone: 'good', icon: 'check' };
}
