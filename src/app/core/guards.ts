import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { homeForRole } from './roles';

/** Signed in, past two-factor, and assigned an active role. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenSettled();
  if (auth.stage() === 'ready') return true;
  const next = state.url && state.url !== '/' ? { next: state.url } : {};
  return router.createUrlTree(['/login'], { queryParams: next });
};

/** Only Admin can manage settings and team access. */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAdmin() || inject(Router).createUrlTree([homeForRole(auth.role())]);
};

export const analyticsGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.canAnalyse() || inject(Router).createUrlTree([homeForRole(auth.role())]);
};

export const billingGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.canBill() || inject(Router).createUrlTree([homeForRole(auth.role())]);
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
 * The landing page for "/": dashboards for Admin/Analytics, the counter for Billing. A guard rather
 * than a redirect, because redirects are resolved before the session check has finished.
 */
export const homeGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenSettled();
  return router.createUrlTree([homeForRole(auth.role())]);
};
