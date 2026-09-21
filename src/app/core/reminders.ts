import { Customer } from './models';
import { formatINR, phoneDigits } from './format';

/**
 * A wa.me link that opens WhatsApp with a polite dues reminder pre-filled.
 * Nothing is sent until the shop presses send in WhatsApp.
 */
export function whatsappReminderLink(customer: Customer, balance: number, shopName: string): string | null {
  const digits = phoneDigits(customer.phone).slice(-10);
  if (digits.length !== 10 || balance <= 0) return null;
  const firstName = customer.name.split(' ')[0];
  const message =
    `Namaskara ${firstName}, this is a gentle reminder from ${shopName}. ` +
    `A balance of ${formatINR(balance)} is pending on your account. ` +
    `Kindly pay at your convenience or visit the showroom. Thank you!`;
  return `https://wa.me/91${digits}?text=${encodeURIComponent(message)}`;
}
