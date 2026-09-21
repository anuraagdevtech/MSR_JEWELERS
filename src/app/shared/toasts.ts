import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { UiService } from '../core/ui.service';
import { Icon } from './icon';

@Component({
  selector: 'app-toasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="toast-stack" role="status" aria-live="polite">
      @for (toast of ui.toasts(); track toast.id) {
        <div [class]="'toast toast-' + toast.tone">
          <app-icon [name]="toast.tone === 'error' ? 'alert' : toast.tone === 'info' ? 'info' : 'check'" [size]="16" />
          <span>{{ toast.message }}</span>
          <button type="button" class="icon-btn sm" (click)="ui.dismissToast(toast.id)" aria-label="Dismiss">
            <app-icon name="close" [size]="14" />
          </button>
        </div>
      }
    </div>
  `,
})
export class Toasts {
  protected readonly ui = inject(UiService);
}
