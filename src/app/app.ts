import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface Transaction {
  id: number;
  item: string;
  date: string;
  totalValue: number;
  cashPaid: number;
  rawGoldGrams: number;
  goldPurity: string;
  goldRate: number;
  goldReturnedGrams: number;
  notes: string;
}

interface Customer {
  id: number;
  name: string;
  phone: string;
  city: string;
  transactions: Transaction[];
}

interface TransactionForm {
  item: string;
  date: string;
  totalValue: number;
  cashPaid: number;
  rawGoldGrams: number;
  goldPurity: string;
  goldRate: number;
  goldReturnedGrams: number;
  notes: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly businessName = 'MSR Jewelers';

  protected readonly customers: Customer[] = [
    {
      id: 1,
      name: 'Customer A',
      phone: '98765 43210',
      city: 'Bengaluru',
      transactions: [
        {
          id: 1,
          item: 'Gold necklace',
          date: '2000-01-15',
          totalValue: 35000,
          cashPaid: 35000,
          rawGoldGrams: 0,
          goldPurity: '22K',
          goldRate: 4200,
          goldReturnedGrams: 0,
          notes: 'Full payment received in cash.'
        },
        {
          id: 2,
          item: 'Gold bracelet',
          date: '2009-03-18',
          totalValue: 18500,
          cashPaid: 10000,
          rawGoldGrams: 2.2,
          goldPurity: '22K',
          goldRate: 4200,
          goldReturnedGrams: 0,
          notes: 'Partial payment; balance due after gold settlement.'
        },
        {
          id: 3,
          item: 'Temple coin set',
          date: '2014-08-20',
          totalValue: 22000,
          cashPaid: 9000,
          rawGoldGrams: 3.5,
          goldPurity: '22K',
          goldRate: 4300,
          goldReturnedGrams: 0.5,
          notes: 'Gold received upfront; 0.5g returned to customer.'
        },
      ],
    },
    {
      id: 2,
      name: 'Anjali Sharma',
      phone: '90000 11122',
      city: 'Mysuru',
      transactions: [
        {
          id: 4,
          item: 'Diamond ring',
          date: '2023-03-02',
          totalValue: 42000,
          cashPaid: 42000,
          rawGoldGrams: 0,
          goldPurity: '18K',
          goldRate: 4800,
          goldReturnedGrams: 0,
          notes: 'Completed in one payment.'
        },
        {
          id: 5,
          item: 'Wedding bangles',
          date: '2024-11-14',
          totalValue: 54000,
          cashPaid: 25000,
          rawGoldGrams: 5.4,
          goldPurity: '22K',
          goldRate: 4500,
          goldReturnedGrams: 1.1,
          notes: 'Advance gold paid and balance to be returned.'
        },
      ],
    },
    {
      id: 3,
      name: 'Ramesh Kumar',
      phone: '88991 77888',
      city: 'Hubballi',
      transactions: [
        {
          id: 6,
          item: 'Chain set',
          date: '2025-02-10',
          totalValue: 31000,
          cashPaid: 31000,
          rawGoldGrams: 0,
          goldPurity: '22K',
          goldRate: 4700,
          goldReturnedGrams: 0,
          notes: 'Paid fully.'
        },
      ],
    },
  ];

  protected searchTerm = '';
  protected selectedCustomerId = 1;
  protected currentGoldRate = 4500;
  protected isLoadingGoldPrice = false;
  protected goldPriceMessage = 'Loading live gold price...';
  protected readonly purityOrder = ['24K', '22K', '18K'];

  protected newTransaction: TransactionForm = {
    item: '',
    date: new Date().toISOString().slice(0, 10),
    totalValue: 0,
    cashPaid: 0,
    rawGoldGrams: 0,
    goldPurity: '22K',
    goldRate: 0,
    goldReturnedGrams: 0,
    notes: '',
  };

  constructor() {
    this.newTransaction.goldRate = this.getGoldRateForPurity(this.newTransaction.goldPurity);
  }

  ngOnInit(): void {
    void this.fetchLiveGoldPrice();
  }

  protected getGoldRateForPurity(purity: string): number {
    const rate = Number(this.currentGoldRate) || 0;
    if (!rate) {
      return 0;
    }

    switch (purity) {
      case '24K':
        return rate;
      case '22K':
        return rate * (22 / 24);
      case '18K':
        return rate * (18 / 24);
      default:
        return rate;
    }
  }

  protected syncGoldRateFromPurity(): void {
    this.newTransaction.goldRate = this.getGoldRateForPurity(this.newTransaction.goldPurity);
  }

  protected async fetchLiveGoldPrice(): Promise<void> {
    this.isLoadingGoldPrice = true;
    this.goldPriceMessage = 'Loading live gold price...';

    try {
      const [goldResponse, exchangeResponse] = await Promise.all([
        fetch('https://api.gold-api.com/price/XAU'),
        fetch('https://open.er-api.com/v6/latest/USD'),
      ]);

      if (!goldResponse.ok || !exchangeResponse.ok) {
        throw new Error('Live market data is unavailable right now.');
      }

      const goldData = await goldResponse.json();
      const exchangeData = await exchangeResponse.json();
      const usdGoldPricePerOunce = Number(goldData?.price ?? 0);
      const inrRate = Number(exchangeData?.rates?.INR ?? 0);

      if (!usdGoldPricePerOunce || !inrRate) {
        throw new Error('Live market data is incomplete.');
      }

      const inrPerGram = (usdGoldPricePerOunce * inrRate) / 31.1035;
      const normalizedRate = Number(inrPerGram.toFixed(2));

      this.currentGoldRate = normalizedRate;
      this.newTransaction.goldRate = this.getGoldRateForPurity(this.newTransaction.goldPurity);
      this.goldPriceMessage = `Live market rate: ${this.formatCurrency(normalizedRate)} / g`;
    } catch {
      this.goldPriceMessage = 'Live rate unavailable; override manually as needed.';
    } finally {
      this.isLoadingGoldPrice = false;
    }
  }

  protected updateGoldRate(): void {
    this.newTransaction.goldRate = this.getGoldRateForPurity(this.newTransaction.goldPurity);
  }

  protected get filteredCustomers(): Customer[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) {
      return this.customers;
    }

    return this.customers.filter((customer) => {
      return (
        customer.name.toLowerCase().includes(term) ||
        customer.phone.replace(/\s+/g, '').includes(term.replace(/\s+/g, '')) ||
        customer.city.toLowerCase().includes(term)
      );
    });
  }

  protected get selectedCustomer(): Customer | null {
    const selected = this.customers.find((customer) => customer.id === this.selectedCustomerId);
    if (selected) {
      return selected;
    }

    return this.filteredCustomers[0] ?? null;
  }

  protected selectCustomer(customerId: number): void {
    this.selectedCustomerId = customerId;
  }

  protected getTotalSales(customer: Customer): number {
    return customer.transactions.reduce((sum, transaction) => sum + transaction.totalValue, 0);
  }

  protected getTotalCashReceived(customer: Customer): number {
    return customer.transactions.reduce((sum, transaction) => sum + transaction.cashPaid, 0);
  }

  protected getNetGoldValue(transaction: Transaction): number {
    const netGoldGrams = Math.max(transaction.rawGoldGrams - transaction.goldReturnedGrams, 0);
    return netGoldGrams * transaction.goldRate;
  }

  protected getCustomerOutstanding(customer: Customer): number {
    const totalSales = this.getTotalSales(customer);
    const totalCash = this.getTotalCashReceived(customer);
    const totalGold = customer.transactions.reduce((sum, transaction) => sum + this.getNetGoldValue(transaction), 0);
    return totalSales - totalCash - totalGold;
  }

  protected getGoldBalance(customer: Customer): number {
    return customer.transactions.reduce((sum, transaction) => sum + (transaction.rawGoldGrams - transaction.goldReturnedGrams), 0);
  }

  protected transactionBalance(transaction: Transaction): number {
    const goldValue = this.getNetGoldValue(transaction);
    return transaction.totalValue - transaction.cashPaid - goldValue;
  }

  protected getDashboardRevenue(): number {
    return this.customers.reduce((sum, customer) => sum + customer.transactions.reduce((customerSum, transaction) => customerSum + transaction.totalValue, 0), 0);
  }

  protected getDashboardCredit(): number {
    return this.customers.reduce((sum, customer) => {
      const outstanding = customer.transactions.reduce((customerSum, transaction) => customerSum + this.transactionBalance(transaction), 0);
      return sum + Math.max(outstanding, 0);
    }, 0);
  }

  protected getDashboardGoldRates(): Record<string, number> {
    return {
      '24K': this.getGoldRateForPurity('24K'),
      '22K': this.getGoldRateForPurity('22K'),
      '18K': this.getGoldRateForPurity('18K'),
    };
  }

  protected addTransaction(): void {
    const customer = this.selectedCustomer;
    if (!customer || !this.newTransaction.item.trim()) {
      return;
    }

    const transaction: Transaction = {
      id: Date.now(),
      item: this.newTransaction.item.trim(),
      date: this.newTransaction.date,
      totalValue: Number(this.newTransaction.totalValue) || 0,
      cashPaid: Number(this.newTransaction.cashPaid) || 0,
      rawGoldGrams: Number(this.newTransaction.rawGoldGrams) || 0,
      goldPurity: this.newTransaction.goldPurity,
      goldRate: Number(this.newTransaction.goldRate) || 0,
      goldReturnedGrams: Number(this.newTransaction.goldReturnedGrams) || 0,
      notes: this.newTransaction.notes.trim(),
    };

    customer.transactions.push(transaction);
    this.newTransaction = {
      item: '',
      date: new Date().toISOString().slice(0, 10),
      totalValue: 0,
      cashPaid: 0,
      rawGoldGrams: 0,
      goldPurity: '22K',
      goldRate: Number(this.currentGoldRate) || 0,
      goldReturnedGrams: 0,
      notes: '',
    };
  }

  protected formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);
  }

  protected formatGold(value: number): string {
    return `${value.toFixed(2)} g`;
  }

  protected sortTransactions(transactions: Transaction[]): Transaction[] {
    return [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }
}
