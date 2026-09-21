import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { BillStatus } from '../core/models';
import { Icon, IconName } from './icon';

/** Bill state as a chip: icon + label so it never relies on colour alone. */
@Component({
  selector: 'app-status-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (view(); as v) {
      <span [class]="'chip chip-' + v.tone">
        <app-icon [name]="v.icon" [size]="13" />
        {{ v.label }}
      </span>
    }
  `,
})
export class StatusChip {
  readonly status = input<BillStatus | undefined>();

  protected readonly view = computed((): { label: string; tone: string; icon: IconName } | null => {
    const status = this.status();
    if (!status) return null;
    if (status.state === 'paid') return { label: 'Paid', tone: 'good', icon: 'check' };
    if (status.overdue) return { label: `Overdue · ${status.daysOpen}d`, tone: 'critical', icon: 'alert' };
    if (status.state === 'partial') return { label: 'Part paid', tone: 'warning', icon: 'halfCircle' };
    return { label: 'Unpaid', tone: 'neutral', icon: 'clock' };
  });
}
