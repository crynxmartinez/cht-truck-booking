export const OVERLAP_CONSTRAINT = 'bookings_no_overlap';
export const OVERLAP_GUARD_SQL = '';
export function isOverlapViolation(_err: unknown): boolean {
  return false;
}
