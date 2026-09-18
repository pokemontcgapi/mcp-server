export interface MissingCard {
  readonly id: string;
  readonly suggested_id?: string;
}

export interface BatchResult<T> {
  readonly data: readonly T[];
  readonly requested: number;
  readonly found: number;
  readonly missing?: readonly MissingCard[];
}

// Il campo della API prevale anche se una carta tornata porta l'alias escluso.
// Le versioni precedenti non lo hanno: conserviamo il confronto locale come
// ripiego, senza inventare suggerimenti o fare altre richieste.
export function batchMissing(
  ids: readonly string[],
  body: BatchResult<{ id: string; legacy_id?: string | null }>,
): readonly MissingCard[] {
  if (body.missing !== undefined) return body.missing;
  const seen = new Set<string>();
  for (const card of body.data) {
    seen.add(card.id.toLowerCase());
    if (card.legacy_id != null) seen.add(card.legacy_id.toLowerCase());
  }
  const missing: MissingCard[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    const key = id.toLowerCase();
    if (id !== '' && !seen.has(key)) {
      missing.push({ id });
      seen.add(key);
    }
  }
  return missing;
}

export function missingText(missing: readonly MissingCard[]): string {
  if (missing.length === 0) return '';
  return `\n\nNot found: ${missing.map((item) =>
    item.suggested_id === undefined ? item.id : `${item.id} (use ${item.suggested_id})`,
  ).join(', ')}`;
}
