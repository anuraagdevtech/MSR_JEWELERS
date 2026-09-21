import {
  Bill,
  BillItem,
  Customer,
  ItemCategory,
  MakingType,
  Payment,
  PaymentMode,
  Purity,
  RateCard,
  ShopData,
  ShopSettings,
} from './models';
import { addDays, addMonths, daysBetween, financialYearLabel, parseISODate, startOfMonth, todayISO } from './dates';
import { computeBillTotals, deriveRates, metalOf, oldGoldValue } from './calc';

// Today's board rates for the demo (spot + import duty, rounded). Settings can re-base them
// on the live market reference.
const DEMO_GOLD_24K = 14_000;
const DEMO_SILVER_999 = 215;

export function defaultSettings(today = todayISO()): ShopSettings {
  return {
    shopName: 'MSR Jewelers',
    tagline: 'Gold · Diamond · Silver',
    address: '12, Sayyaji Rao Road, Mysuru, Karnataka 570001',
    phone: '0821 242 0000',
    gstin: '29ABCDE1234F1Z5',
    billPrefix: 'MSR',
    receiptPrefix: 'RC',
    creditDays: 30,
    gstPercent: 3,
    rates: deriveRates(DEMO_GOLD_24K, DEMO_SILVER_999),
    ratesUpdatedAt: `${today}T10:00:00`,
  };
}

export function emptyData(today = todayISO()): ShopData {
  return { version: 1, customers: [], bills: [], payments: [], settings: defaultSettings(today) };
}

type Profile = 'prompt' | 'installment' | 'slow' | 'wedding' | 'advance';

interface Template {
  category: ItemCategory;
  names: string[];
  purities: Purity[];
  weight?: [number, number];
  weightOptions?: number[];
  making: [number, number];
  makingType?: MakingType;
  stoneChance?: number;
  stone?: [number, number];
  pick: number;
}

const CATALOG: Template[] = [
  { category: 'Necklace', names: ['Lakshmi haram', 'Temple necklace', 'Kasu mala', 'Antique choker', 'Mango mala'], purities: ['22K'], weight: [14, 40], making: [10, 16], stoneChance: 0.35, stone: [4000, 28000], pick: 1 },
  { category: 'Chain', names: ['Rope chain', 'Box chain', 'Curb chain', 'Singapore chain', 'Figaro chain'], purities: ['22K'], weight: [5, 20], making: [7, 11], pick: 1.5 },
  { category: 'Ring', names: ['Solitaire ring', 'Signet ring', 'Navaratna ring', 'Couple bands', 'Cocktail ring'], purities: ['22K', '18K'], weight: [2.5, 8], making: [12, 18], stoneChance: 0.55, stone: [5000, 65000], pick: 1.6 },
  { category: 'Bangles', names: ['Kada (pair)', 'Plain bangles (pair)', 'Antique bangles (pair)', 'Kangan set'], purities: ['22K'], weight: [12, 40], making: [9, 14], pick: 1.1 },
  { category: 'Earrings', names: ['Jhumkas', 'Diamond studs', 'Chandbalis', 'Hoops', 'Ear cuffs'], purities: ['22K', '18K'], weight: [3, 14], making: [12, 18], stoneChance: 0.4, stone: [2000, 22000], pick: 1.5 },
  { category: 'Bracelet', names: ['Link bracelet', 'Diamond bracelet', 'Tennis bracelet'], purities: ['18K', '22K'], weight: [7, 18], making: [12, 18], stoneChance: 0.45, stone: [6000, 45000], pick: 0.7 },
  { category: 'Pendant', names: ['Lakshmi pendant', 'Initial pendant', 'Diamond pendant', 'Om pendant'], purities: ['22K', '18K'], weight: [1.5, 6], making: [12, 18], stoneChance: 0.35, stone: [2500, 18000], pick: 1 },
  { category: 'Mangalsutra', names: ['Mangalsutra', 'Thali chain', 'Karimani sara'], purities: ['22K'], weight: [10, 32], making: [9, 13], pick: 0.7 },
  { category: 'Coin', names: ['Lakshmi coin', 'Gold coin', 'Ganesha coin'], purities: ['24K'], weightOptions: [1, 2, 4, 5, 8, 10, 20], making: [3, 5], pick: 0.9 },
  { category: 'Anklet', names: ['Silver anklets (pair)', 'Payal (pair)', 'Kalungura (pair)'], purities: ['925'], weight: [40, 140], making: [25, 45], makingType: 'perGram', pick: 0.8 },
  { category: 'Silver article', names: ['Pooja thali set', 'Silver deepa (pair)', 'Kumkum bharani', 'Silver glass set'], purities: ['999', '925'], weight: [60, 420], making: [15, 35], makingType: 'perGram', pick: 0.6 },
];

const WEDDING_SET: ItemCategory[] = ['Necklace', 'Bangles', 'Mangalsutra', 'Earrings', 'Chain', 'Ring'];

const PEOPLE: Array<[string, string, Profile]> = [
  ['Anjali Sharma', 'Mysuru', 'wedding'],
  ['Ramesh Kumar', 'Hubballi', 'prompt'],
  ['Lakshmi Narayan Rao', 'Bengaluru', 'installment'],
  ['Kavya Hegde', 'Udupi', 'prompt'],
  ['Suresh Gowda', 'Mandya', 'slow'],
  ['Meera Iyer', 'Bengaluru', 'prompt'],
  ['Prakash Shetty', 'Mangaluru', 'installment'],
  ['Divya Kulkarni', 'Belagavi', 'advance'],
  ['Venkatesh Reddy', 'Bengaluru', 'installment'],
  ['Pooja Nayak', 'Shivamogga', 'prompt'],
  ['Manjunath Patil', 'Davanagere', 'slow'],
  ['Sneha Bhat', 'Mysuru', 'wedding'],
  ['Raghavendra Joshi', 'Dharwad', 'prompt'],
  ['Bhavana Kamath', 'Udupi', 'installment'],
  ['Srinivas Murthy', 'Tumakuru', 'prompt'],
  ['Nandini Desai', 'Hubballi', 'installment'],
  ['Arjun Pai', 'Mangaluru', 'prompt'],
  ['Deepa Shenoy', 'Bengaluru', 'slow'],
  ['Mahesh Naik', 'Karwar', 'prompt'],
  ['Shruti Prabhu', 'Mangaluru', 'wedding'],
  ['Ganesh Hegde', 'Sirsi', 'installment'],
  ['Rekha Gowda', 'Hassan', 'prompt'],
  ['Naveen Rao', 'Bengaluru', 'advance'],
  ['Asha Kumari', 'Mysuru', 'installment'],
  ['Kiran Shetty', 'Udupi', 'prompt'],
  ['Padma Srinivasan', 'Bengaluru', 'slow'],
  ['Vijay Kulkarni', 'Belagavi', 'prompt'],
  ['Geetha Ramesh', 'Chikkamagaluru', 'installment'],
  ['Rohit Patil', 'Hubballi', 'prompt'],
  ['Sunitha Bhat', 'Shivamogga', 'wedding'],
  ['Anil Kumar', 'Tumakuru', 'slow'],
  ['Vani Hegde', 'Bengaluru', 'installment'],
  ['Sanjay Reddy', 'Ballari', 'prompt'],
  ['Hema Nagaraj', 'Mysuru', 'installment'],
  ['Ravi Shankar', 'Bengaluru', 'prompt'],
  ['Farhana Begum', 'Bengaluru', 'slow'],
  ['Joseph D’Souza', 'Mangaluru', 'advance'],
  ['Harpreet Kaur', 'Bengaluru', 'prompt'],
  // Walk-ins who first visited this month.
  ['Priya Menon', 'Bengaluru', 'prompt'],
  ['Abdul Rahman', 'Mysuru', 'installment'],
];

const NEW_THIS_MONTH = 2;

// Relative footfall by calendar month: weddings (Nov–Feb), Akshaya Tritiya (Apr–May),
// Dasara / Dhanteras / Diwali (Oct–Nov); monsoon months are quiet.
const SEASON = [1.1, 1.2, 0.8, 1.3, 1.2, 0.7, 0.6, 0.9, 0.8, 1.4, 1.5, 1.2];

interface PaymentSeed extends Omit<Payment, 'id' | 'receiptNo' | 'createdAt'> {
  order: number;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds ~18 months of believable counter activity ending on `today`: festive and
 * wedding-season peaks, old-gold exchanges, prompt payers, instalment customers,
 * a few slow payers with overdue khata, and advances booked against custom orders.
 */
export function generateDemoData(
  today = todayISO(),
  base: { gold24: number; silver999: number } = { gold24: DEMO_GOLD_24K, silver999: DEMO_SILVER_999 },
): ShopData {
  const rand = mulberry32(20_260_921);
  const between = (min: number, max: number) => min + rand() * (max - min);
  const int = (min: number, max: number) => Math.floor(between(min, max + 1));
  const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
  const chance = (p: number) => rand() < p;
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  const roundTo = (v: number, step: number) => Math.round(v / step) * step;

  const start = addMonths(today, -18);
  const span = Math.max(daysBetween(start, today), 1);

  const ratesOn = (date: string): RateCard => {
    const t = Math.min(Math.max(daysBetween(start, date) / span, 0), 1);
    const wobble = Math.sin(t * 11) * 0.015;
    // Gold climbed roughly a third and silver roughly doubled over the 18 months.
    return deriveRates(
      base.gold24 * (0.66 + 0.34 * t + wobble * (1 - t)),
      base.silver999 * (0.5 + 0.5 * t + wobble * (1 - t)),
    );
  };

  const seasonalDate = (from: string, to: string): string => {
    const days = Math.max(daysBetween(from, to), 0);
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = addDays(from, int(0, days));
      if (rand() * 1.5 <= SEASON[parseISODate(candidate).getMonth()]) return candidate;
    }
    return addDays(from, int(0, days));
  };

  const phone = () => `${pick(['9', '8', '7', '6'])}${Array.from({ length: 9 }, () => int(0, 9)).join('')}`;
  const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join('');
  const huid = () =>
    Array.from({ length: 6 }, () => pick('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.split(''))).join('');

  const customers: Customer[] = PEOPLE.map(([name, city], index) => {
    const joinOffset = Math.floor(Math.pow(rand(), 2.2) * (span - 45));
    return {
      id: `c${String(index + 1).padStart(3, '0')}`,
      name,
      phone: phone(),
      city,
      openingBalance: 0,
      createdAt: addDays(start, joinOffset),
    };
  });

  const monthStart = startOfMonth(today);
  for (const customer of customers.slice(-NEW_THIS_MONTH)) {
    const joined = addDays(monthStart, int(0, 12));
    customer.createdAt = joined < today ? joined : today;
  }

  // A few long-standing customers carried dues over from the paper khata.
  for (const index of [4, 10, 25]) {
    customers[index].createdAt = start;
    customers[index].openingBalance = roundTo(between(18_000, 85_000), 500);
    customers[index].notes = 'Balance carried forward from the old khata book.';
  }
  customers[0].notes = 'Daughter’s wedding in the family. Prefers bank transfer.';
  customers[7].notes = 'Custom bridal set on order. Advance received.';
  customers[22].notes = 'Diamond solitaire on order. Advance received.';
  customers[36].notes = 'Anniversary order. Advance received.';

  const billSeeds: Array<Omit<Bill, 'billNo' | 'createdAt'> & { time: string }> = [];
  const paymentSeeds: PaymentSeed[] = [];
  let billCounter = 0;
  let order = 0;

  const makeItem = (template: Template, date: string): BillItem => {
    const purity = pick(template.purities);
    const rates = ratesOn(date);
    const net = template.weightOptions
      ? pick(template.weightOptions)
      : round3(between(template.weight![0], template.weight![1]));
    const description = pick(template.names);
    const stoneByName = /Diamond|Solitaire|Navaratna|Tennis|Cocktail/.test(description);
    const hasStones = template.stoneChance !== undefined && (stoneByName || chance(template.stoneChance));
    const stoneCharges = hasStones ? roundTo(between(template.stone![0], template.stone![1]), 100) : 0;
    const makingType = template.makingType ?? 'percent';
    const makingValue =
      makingType === 'perGram'
        ? int(template.making[0], template.making[1])
        : roundTo(between(template.making[0], template.making[1]), 0.5);
    return {
      id: `i${billCounter}-${int(1000, 9999)}`,
      description,
      category: template.category,
      purity: stoneByName && template.purities.includes('18K') ? '18K' : purity,
      huid: metalOf(purity) === 'Gold' && template.category !== 'Coin' ? huid() : undefined,
      pieces: description.includes('(pair)') ? 2 : 1,
      grossWeight: hasStones ? round3(net + between(0.2, 1.8)) : net,
      netWeight: net,
      rate: rates[stoneByName && template.purities.includes('18K') ? '18K' : purity],
      makingType,
      makingValue,
      stoneCharges,
    };
  };

  const pickTemplate = (): Template => {
    const total = CATALOG.reduce((sum, t) => sum + t.pick, 0);
    let roll = rand() * total;
    for (const template of CATALOG) {
      roll -= template.pick;
      if (roll <= 0) return template;
    }
    return CATALOG[0];
  };

  const modeFor = (amount: number): PaymentMode => {
    if (amount > 150_000) return pick(['Bank transfer', 'Bank transfer', 'Bank transfer', 'Card', 'UPI', 'Cheque']);
    const roll = rand();
    if (roll < 0.38) return 'UPI';
    if (roll < 0.6) return 'Cash';
    if (roll < 0.82) return 'Card';
    if (roll < 0.95) return 'Bank transfer';
    return 'Cheque';
  };

  const referenceFor = (mode: PaymentMode): string | undefined => {
    switch (mode) {
      case 'UPI':
        return `UPI ${digits(12)}`;
      case 'Card':
        return `Card ··${digits(4)}`;
      case 'Bank transfer':
        return `${pick(['NEFT', 'IMPS', 'RTGS'])} ${digits(10)}`;
      case 'Cheque':
        return `Chq ${digits(6)} · ${pick(['SBI', 'Canara Bank', 'HDFC Bank', 'Karnataka Bank'])}`;
      default:
        return undefined;
    }
  };

  const addPayment = (seed: Omit<PaymentSeed, 'order' | 'reference'> & { reference?: string }) => {
    if (seed.date > today || seed.amount <= 0) return;
    paymentSeeds.push({ ...seed, reference: seed.reference ?? referenceFor(seed.mode), order: order++ });
  };

  const settle = (customer: Customer, profile: Profile, billId: string, date: string, total: number, wedding: boolean) => {
    let due = total;
    const rates = ratesOn(date);

    if (total > 30_000 && (wedding || chance(profile === 'prompt' ? 0.2 : 0.3))) {
      const rate = roundTo(rates['22K'] * 0.97, 5);
      const maxWeight = (total * 0.55) / rate;
      const weight = round3(Math.min(between(4, wedding ? 55 : 22), maxWeight));
      const amount = oldGoldValue(weight, rate);
      addPayment({
        customerId: customer.id,
        billId,
        date,
        amount,
        mode: 'Old gold',
        oldGold: { weight, purity: '22K', rate },
        notes: `${weight.toFixed(3)} g old 22K gold exchanged`,
      });
      due -= amount;
    }

    const pay = (when: string, amount: number, linked = true, notes?: string) => {
      const value = Math.min(Math.round(amount), Math.round(due));
      if (value <= 0 || when > today) return false;
      const mode = modeFor(value);
      addPayment({
        customerId: customer.id,
        billId: linked ? billId : undefined,
        date: when,
        amount: value,
        mode: mode === 'Cash' && value >= 199_000 ? 'Bank transfer' : mode,
        notes,
      });
      due -= value;
      return true;
    };

    const instalments = (
      gapMin: number,
      gapMax: number,
      shareMin: number,
      shareMax: number,
      limit: number,
      clearOnLast = true,
    ) => {
      let when = date;
      for (let i = 0; i < limit && due > 1; i++) {
        when = addDays(when, int(gapMin, gapMax));
        const last = clearOnLast && (i === limit - 1 || due < 8_000);
        const amount = last ? due : Math.max(roundTo(due * between(shareMin, shareMax), 500), 1000);
        if (!pay(when, amount, !chance(0.35), 'Instalment towards dues')) break;
      }
    };

    switch (profile) {
      case 'prompt':
      case 'advance':
        if (due > 100_000 && chance(0.5)) {
          pay(date, roundTo(due * between(0.5, 0.7), 1000));
        }
        if (chance(0.85)) {
          pay(date, due);
        } else {
          pay(date, roundTo(due * 0.8, 500));
          pay(addDays(date, int(6, 20)), due, true, 'Balance cleared');
        }
        break;
      case 'installment':
        if (chance(0.85)) pay(date, roundTo(due * between(0.35, 0.6), 500), true, 'Advance at billing');
        instalments(20, 40, 0.25, 0.45, 6);
        break;
      case 'wedding':
        pay(date, roundTo(due * between(0.4, 0.55), 1000), true, 'Advance at billing');
        instalments(25, 35, 0.3, 0.45, 5);
        break;
      case 'slow':
        if (chance(0.6)) pay(date, roundTo(due * between(0.1, 0.3), 500), true, 'Part payment at billing');
        instalments(45, 110, 0.1, 0.25, int(0, 2), false);
        break;
    }
  };

  const addBill = (customer: Customer, profile: Profile, date: string, wedding: boolean) => {
    billCounter++;
    const id = `b${String(billCounter).padStart(4, '0')}`;
    const items: BillItem[] = [];
    if (wedding) {
      const count = int(3, 5);
      for (const category of WEDDING_SET.slice(0, count)) {
        items.push(makeItem(CATALOG.find((t) => t.category === category)!, date));
      }
    } else {
      const count = chance(0.15) ? 3 : chance(0.55) ? 1 : 2;
      for (let i = 0; i < count; i++) items.push(makeItem(pickTemplate(), date));
    }
    const gstPercent = 3;
    const provisional = computeBillTotals({ items, discount: 0, gstPercent });
    const discount = provisional.subtotal > 20_000 && chance(0.3)
      ? roundTo(provisional.subtotal * between(0.005, 0.02), 100)
      : 0;
    const notes = wedding
      ? 'Wedding set · all items BIS hallmarked'
      : chance(0.12)
        ? pick(['Gift wrap requested', 'Resizing done free of cost', 'Delivered at home', 'Festival offer applied'])
        : undefined;
    const bill = {
      id,
      customerId: customer.id,
      date,
      items,
      discount,
      gstPercent,
      notes,
      time: `${String(int(10, 20)).padStart(2, '0')}:${String(int(0, 59)).padStart(2, '0')}`,
    };
    billSeeds.push(bill);
    const total = computeBillTotals(bill).total;
    settle(customer, profile, id, date, total, wedding);
  };

  customers.forEach((customer, index) => {
    const profile = PEOPLE[index][2];
    const count =
      profile === 'prompt' ? int(3, 7)
        : profile === 'installment' ? int(2, 5)
          : profile === 'slow' ? int(1, 3)
            : profile === 'wedding' ? int(2, 4)
              : int(1, 3);
    const isNew = index >= customers.length - NEW_THIS_MONTH;
    const latest = addDays(today, -3);
    const to = customer.createdAt < latest ? latest : today;
    const dates = Array.from({ length: isNew ? 1 : count }, () => seasonalDate(customer.createdAt, to)).sort();
    dates.forEach((date, i) => addBill(customer, profile, date, profile === 'wedding' && i === 0));

    if (customer.openingBalance > 0) {
      let when = customer.createdAt;
      for (let i = 0; i < int(1, 3); i++) {
        when = addDays(when, int(30, 120));
        addPayment({
          customerId: customer.id,
          date: when,
          amount: roundTo(customer.openingBalance * between(0.15, 0.3), 500),
          mode: pick<PaymentMode>(['Cash', 'UPI']),
          notes: 'Towards old khata balance',
        });
      }
    }

    if (profile === 'advance') {
      const amount = roundTo(between(25_000, 150_000), 1000);
      const mode = amount > 100_000 ? 'Bank transfer' : pick<PaymentMode>(['UPI', 'Bank transfer', 'Card']);
      addPayment({
        customerId: customer.id,
        date: addDays(today, -int(3, 40)),
        amount,
        mode,
        notes: 'Advance for custom order',
      });
    }
  });

  // Make sure the current month always has some counter activity to show.
  const regulars = customers.filter((_, i) => ['prompt', 'installment'].includes(PEOPLE[i][2]));
  for (let i = 0; i < 6; i++) {
    const customer = regulars[(i * 5 + 3) % regulars.length];
    const profile = PEOPLE[customers.indexOf(customer)][2];
    addBill(customer, profile, seasonalDate(monthStart, today), false);
  }

  // Number bills and receipts sequentially within each financial year, oldest first.
  const billTime = new Map<string, string>();
  const bills: Bill[] = billSeeds
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .map(({ time, ...seed }) => {
      const createdAt = `${seed.date}T${time}:00`;
      billTime.set(seed.id, createdAt);
      return { ...seed, billNo: '', createdAt };
    });
  const billSeq = new Map<string, number>();
  for (const bill of bills) {
    const fy = financialYearLabel(bill.date);
    const next = (billSeq.get(fy) ?? 0) + 1;
    billSeq.set(fy, next);
    bill.billNo = `MSR/${fy}/${String(next).padStart(4, '0')}`;
  }

  const receiptSeq = new Map<string, number>();
  const payments: Payment[] = paymentSeeds
    .map((seed) => {
      const sameDayAsBill = seed.billId && billTime.get(seed.billId)?.startsWith(seed.date);
      const createdAt = sameDayAsBill
        ? billTime.get(seed.billId!)!.replace(/:00$/, `:${String(10 + (seed.order % 40)).padStart(2, '0')}`)
        : `${seed.date}T${String(10 + (seed.order % 10)).padStart(2, '0')}:${String(seed.order % 60).padStart(2, '0')}:00`;
      return { seed, createdAt };
    })
    .sort((a, b) => a.seed.date.localeCompare(b.seed.date) || a.createdAt.localeCompare(b.createdAt))
    .map(({ seed, createdAt }, index) => {
      const { order: _order, ...rest } = seed;
      const fy = financialYearLabel(seed.date);
      const next = (receiptSeq.get(fy) ?? 0) + 1;
      receiptSeq.set(fy, next);
      return {
        ...rest,
        id: `p${String(index + 1).padStart(4, '0')}`,
        receiptNo: `RC/${fy}/${String(next).padStart(4, '0')}`,
        createdAt,
      };
    });

  const settings = defaultSettings(today);
  settings.rates = deriveRates(base.gold24, base.silver999);
  return { version: 1, demo: true, customers, bills, payments, settings };
}
