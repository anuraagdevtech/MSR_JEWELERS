import { Routes } from '@angular/router';
import { authGuard, guestGuard, homeGuard, ownerGuard } from './core/guards';
import { Shell } from './layout/shell';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in · MSR Jewellers',
    canActivate: [guestGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginPage),
  },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      { path: '', pathMatch: 'full', canActivate: [homeGuard], children: [] },
      {
        path: 'dashboard',
        title: 'Dashboard · MSR Jewellers',
        canActivate: [ownerGuard],
        loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DashboardPage),
      },
      { path: 'reports', pathMatch: 'full', redirectTo: 'reports/sales' },
      {
        path: 'reports/:tab',
        title: 'Reports · MSR Jewellers',
        canActivate: [ownerGuard],
        loadComponent: () => import('./pages/reports/reports').then((m) => m.ReportsPage),
      },
      {
        path: 'customers',
        title: 'Customers · MSR Jewellers',
        canActivate: [ownerGuard],
        loadComponent: () => import('./pages/customers/customers').then((m) => m.CustomersPage),
      },
      {
        path: 'customers/:id',
        title: 'Customer statement · MSR Jewellers',
        canActivate: [ownerGuard],
        loadComponent: () =>
          import('./pages/customer-detail/customer-detail').then((m) => m.CustomerDetailPage),
      },
      {
        path: 'bills',
        title: 'Bills · MSR Jewellers',
        canActivate: [ownerGuard],
        loadComponent: () => import('./pages/bills/bills').then((m) => m.BillsPage),
      },
      {
        path: 'bills/new',
        title: 'New bill · MSR Jewellers',
        loadComponent: () => import('./pages/bill-form/bill-form').then((m) => m.BillFormPage),
      },
      {
        path: 'bills/:id',
        title: 'Bill · MSR Jewellers',
        loadComponent: () => import('./pages/bill-detail/bill-detail').then((m) => m.BillDetailPage),
      },
      {
        path: 'ledger',
        title: 'Credit & debit ledger · MSR Jewellers',
        canActivate: [ownerGuard],
        loadComponent: () => import('./pages/ledger/ledger').then((m) => m.LedgerPage),
      },
      {
        path: 'counter',
        title: 'Counter · MSR Jewellers',
        loadComponent: () => import('./pages/counter/counter').then((m) => m.CounterPage),
      },
      {
        path: 'settings',
        title: 'Settings · MSR Jewellers',
        canActivate: [ownerGuard],
        loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
