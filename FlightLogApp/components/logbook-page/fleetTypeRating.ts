// Typ-rating-status härledd ur utgångsdatum (ISO YYYY-MM-DD).
import { RATING_EXPIRY_WARN_DAYS } from './tokens';

export type RatingStatus = 'valid' | 'expiring' | 'expired' | 'none';

export function ratingStatus(expiry: string): RatingStatus {
  if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return 'none';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry + 'T00:00:00');
  const days = Math.round((exp.getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= RATING_EXPIRY_WARN_DAYS) return 'expiring';
  return 'valid';
}

export function ratingMeta(status: RatingStatus, Colors: any): { color: string; label: string } {
  switch (status) {
    case 'valid': return { color: Colors.success, label: 'Valid' };
    case 'expiring': return { color: Colors.warning, label: 'Expiring' };
    case 'expired': return { color: Colors.danger, label: 'Expired' };
    default: return { color: Colors.textMuted, label: 'No rating' };
  }
}
