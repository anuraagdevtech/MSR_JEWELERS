import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Signed in, past two-factor, and holding an owner or staff role. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenSettled();
  if (auth.stage() === 'ready') return true;
  const next = state.url && state.url !== '/' ? { next: state.url } : {};
  return router.createUrlTree(['/login'], { queryParams: next });
};

/** Dashboards, balances, reports and settings are for owners; staff land on the counter. */
export const ownerGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isOwner() || inject(Router).createUrlTree(['/counter']);
};

/** Keeps signed-in users away from the login screen. */
export const guestGuard: CanActivateFn = async () => {
  // inject() only works before the first await.
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenSettled();
  return auth.stage() !== 'ready' || router.createUrlTree(['/']);
};

/**
 * The landing page for "/": the dashboard for owners, the counter for staff. A guard rather
 * than a redirect, because redirects are resolved before the session check has finished.
 */
export const homeGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenSettled();
  return router.createUrlTree([auth.isOwner() ? '/dashboard' : '/counter']);
};
