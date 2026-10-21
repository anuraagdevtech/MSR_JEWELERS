import type { ShopSettings } from './models';

export const SHOP_ADDRESS = 'Gandhinagar, Hyderabad, Telangana';

/** Only correct the previous generated placeholders; keep details the shop has entered. */
export function migrateShopProfile(settings: ShopSettings): ShopSettings {
  const next = { ...settings };
  if (next.shopName === 'MSR Jewelers') next.shopName = 'MSR Jewellers';
  if (!next.address || next.address === '12, Sayyaji Rao Road, Mysuru, Karnataka 570001') {
    next.address = SHOP_ADDRESS;
  }
  if (next.phone === '0821 242 0000') next.phone = '';
  if (next.gstin === '29ABCDE1234F1Z5') next.gstin = '';
  next.stateCode ||= next.gstin?.slice(0, 2) || '36';
  return next;
}
