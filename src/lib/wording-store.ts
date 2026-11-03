import type { Wording } from './wording-fill';

/**
 * Wording the office has changed, held in memory for this request.
 *
 * messages.ts reads through here, the same way config.ts reads through the
 * settings store, so every place that sends a message picks up an edit without
 * changing. Replaced wholesale on each load, never merged, so putting a message
 * back to the original really does.
 */
type Edits = Readonly<Record<string, Wording>>;

let edits: Edits = Object.freeze({});

export function applyWording(next: Record<string, Wording>): void {
  edits = Object.freeze({ ...next });
}

export function wordingFor(key: string): Wording | undefined {
  return edits[key];
}

export function editedKeys(): string[] {
  return Object.keys(edits);
}
