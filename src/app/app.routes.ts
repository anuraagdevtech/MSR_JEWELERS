import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    title: 'Dashboard · MSR Jewelers',
    loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardPage),
  },
  {
    path: 'customers',
    title: 'Customers · MSR Jewelers',
    loadComponent: () => import('./pages/customers/customers').then((m) => m.CustomersPage),
  },
  {
    path: 'customers/:id',
    title: 'Customer statement · MSR Jewelers',
    loadComponent: () =>
      import('./pages/customer-detail/customer-detail').then((m) => m.CustomerDetailPage),
  },
  {
    path: 'bills',
    title: 'Bills · MSR Jewelers',
    loadComponent: () => import('./pages/bills/bills').then((m) => m.BillsPage),
  },
  {
    path: 'bills/new',
    title: 'New bill · MSR Jewelers',
    loadComponent: () => import('./pages/bill-form/bill-form').then((m) => m.BillFormPage),
  },
  {
    path: 'bills/:id',
    title: 'Bill · MSR Jewelers',
    loadComponent: () => import('./pages/bill-detail/bill-detail').then((m) => m.BillDetailPage),
  },
  {
    path: 'ledger',
    title: 'Credit & debit ledger · MSR Jewelers',
    loadComponent: () => import('./pages/ledger/ledger').then((m) => m.LedgerPage),
  },
  {
    path: 'settings',
    title: 'Settings · MSR Jewelers',
    loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: 'dashboard' },
];
