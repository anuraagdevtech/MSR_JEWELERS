import { Pipe, PipeTransform } from '@angular/core';
import {
  formatBalance,
  formatDate,
  formatGrams,
  formatINR,
  formatINRCompact,
  formatPhone,
  formatShortDate,
} from '../core/format';

@Pipe({ name: 'inr' })
export class InrPipe implements PipeTransform {
  transform(value: number | null | undefined, withPaise = false): string {
    return formatINR(value ?? 0, withPaise);
  }
}

@Pipe({ name: 'inrCompact' })
export class InrCompactPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatINRCompact(value ?? 0);
  }
}

@Pipe({ name: 'balance' })
export class BalancePipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatBalance(value ?? 0);
  }
}

@Pipe({ name: 'grams' })
export class GramsPipe implements PipeTransform {
  transform(value: number | null | undefined, digits = 3): string {
    return formatGrams(value ?? 0, digits);
  }
}

@Pipe({ name: 'day' })
export class DayPipe implements PipeTransform {
  transform(value: string | null | undefined, style: 'long' | 'short' = 'long'): string {
    return style === 'short' ? formatShortDate(value) : formatDate(value);
  }
}

@Pipe({ name: 'phone' })
export class PhonePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return value ? formatPhone(value) : '';
  }
}

export const FORMAT_PIPES = [InrPipe, InrCompactPipe, BalancePipe, GramsPipe, DayPipe, PhonePipe] as const;
