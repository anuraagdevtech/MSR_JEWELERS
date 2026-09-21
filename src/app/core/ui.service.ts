import { Injectable, effect, signal } from '@angular/core';

export type ThemePreference = 'auto' | 'light' | 'dark';

export interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
}

export interface PaymentDialogOptions {
  customerId?: string;
  billId?: string;
}

export interface CustomerDialogOptions {
  customerId?: string;
  /** Whatever was typed into a customer search: prefilled as the phone or the name. */
  initialQuery?: string;
  /** Called with the saved customer's id, e.g. to select them on a new bill. */
  onSaved?: (customerId: string) => void;
}

const THEME_KEY = 'msr-jewelers:theme';

function readTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

@Injectable({ providedIn: 'root' })
export class UiService {
  readonly toasts = signal<Toast[]>([]);
  readonly paymentDialog = signal<PaymentDialogOptions | null>(null);
  readonly customerDialog = signal<CustomerDialogOptions | null>(null);
  readonly navOpen = signal(false);
  readonly theme = signal<ThemePreference>(readTheme());

  private nextToastId = 1;

  constructor() {
    effect(() => {
      const theme = this.theme();
      const root = document.documentElement;
      if (theme === 'auto') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', theme);
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch {
        // Theme is a convenience; ignore blocked storage.
      }
    });
  }

  toast(message: string, tone: Toast['tone'] = 'success'): void {
    const id = this.nextToastId++;
    this.toasts.update((list) => [...list, { id, message, tone }]);
    setTimeout(() => this.dismissToast(id), tone === 'error' ? 6000 : 3500);
  }

  dismissToast(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  openPayment(options: PaymentDialogOptions = {}): void {
    this.paymentDialog.set({ ...options });
  }

  openCustomer(options: CustomerDialogOptions = {}): void {
    this.customerDialog.set({ ...options });
  }
}
