export type Metal = 'Gold' | 'Silver';
export type GoldPurity = '24K' | '22K' | '18K';
export type SilverPurity = '999' | '925';
export type Purity = GoldPurity | SilverPurity;

export type PaymentMode = 'Cash' | 'UPI' | 'Card' | 'Bank transfer' | 'Cheque' | 'Old gold';

export type ItemCategory =
  | 'Necklace'
  | 'Chain'
  | 'Ring'
  | 'Bangles'
  | 'Earrings'
  | 'Bracelet'
  | 'Pendant'
  | 'Mangalsutra'
  | 'Anklet'
  | 'Coin'
  | 'Silver article'
  | 'Other';

export type MakingType = 'percent' | 'perGram';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  city: string;
  address?: string;
  gstin?: string;
  /** Dues carried over from the old paper khata. Positive = customer owes, negative = advance. */
  openingBalance: number;
  notes?: string;
  createdAt: string;
}

export interface BillItem {
  id: string;
  description: string;
  category: ItemCategory;
  purity: Purity;
  huid?: string;
  pieces: number;
  grossWeight: number;
  netWeight: number;
  /** Metal rate per gram used on this bill. */
  rate: number;
  makingType: MakingType;
  makingValue: number;
  stoneCharges: number;
}

export interface Bill {
  id: string;
  billNo: string;
  customerId: string;
  date: string;
  items: BillItem[];
  discount: number;
  gstPercent: number;
  notes?: string;
  createdAt: string;
}

export interface OldGoldDetail {
  weight: number;
  purity: Purity;
  rate: number;
}

export interface Payment {
  id: string;
  receiptNo: string;
  customerId: string;
  /** When set, the payment is adjusted against this bill first. */
  billId?: string;
  date: string;
  amount: number;
  mode: PaymentMode;
  reference?: string;
  oldGold?: OldGoldDetail;
  notes?: string;
  createdAt: string;
}

export type RateCard = Record<Purity, number>;

export interface ShopSettings {
  shopName: string;
  tagline: string;
  address: string;
  phone: string;
  gstin: string;
  billPrefix: string;
  receiptPrefix: string;
  creditDays: number;
  gstPercent: number;
  rates: RateCard;
  ratesUpdatedAt: string;
}

export interface ShopData {
  version: 1;
  /** Set while the book holds generated sample records rather than the shop's own. */
  demo?: boolean;
  customers: Customer[];
  bills: Bill[];
  payments: Payment[];
  settings: ShopSettings;
}

export type BillState = 'paid' | 'partial' | 'unpaid';

export interface BillTotals {
  metalValue: number;
  making: number;
  stones: number;
  subtotal: number;
  discount: number;
  taxable: number;
  /** Central and state halves, each computed on the taxable value as printed on the invoice. */
  cgst: number;
  sgst: number;
  gst: number;
  roundOff: number;
  total: number;
  netWeight: number;
}

export interface BillStatus {
  total: number;
  paid: number;
  balance: number;
  state: BillState;
  overdue: boolean;
  daysOpen: number;
}

export interface CustomerSummary {
  billed: number;
  paid: number;
  balance: number;
  billsCount: number;
  lastBillDate?: string;
  lastPaymentDate?: string;
  lastActivity?: string;
  overdueAmount: number;
  oldestDueDays: number;
  goldExchangedGrams: number;
}

export interface LedgerEntry {
  id: string;
  date: string;
  createdAt: string;
  customerId: string;
  type: 'debit' | 'credit';
  source: 'bill' | 'payment' | 'opening';
  ref: string;
  particulars: string;
  amount: number;
  mode?: PaymentMode;
  billId?: string;
  paymentId?: string;
}
