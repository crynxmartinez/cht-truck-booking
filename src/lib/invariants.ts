export type HoldRow = {
  id: string;
  reference: string;
  truckId: string | null;
  blockStart: string;
  blockEnd: string;
  stage: string;
};
export type ExpectedEvent = { id: string; summary: string; colorId: string; status: string };
export type ActualEvent = { id: string; summary: string; colorId?: string; status?: string };

export function findOverlaps(_rows: HoldRow[]): Array<[HoldRow, HoldRow]> {
  return [];
}
export function wrongTruckCode(_body: string, _own: string | null, _others: string[]): boolean {
  return false;
}
export function diffCalendar(_e: ExpectedEvent[], _a: ActualEvent[]) {
  return { missing: [] as string[], wrong: [] as Array<{ id: string }>, orphans: [] as string[] };
}
