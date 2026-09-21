import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UiService } from './core/ui.service';
import { Toasts } from './shared/toasts';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Toasts],
  template: `
    <router-outlet />
    <app-toasts />
  `,
})
export class App {
  // Applies the saved light/dark preference before any page renders.
  protected readonly ui = inject(UiService);
}
