import type { Envelope } from './api.js';

/**
 * Raccolta paginata con filtro locale.
 *
 * Serve perche' due filtri che un agente chiede continuamente — "carte
 * giapponesi" e "set usciti nel 2024" — l'endpoint non li accetta: la regione
 * sta sul set e non e' un campo della grammatica di ricerca delle carte, e le
 * finestre temporali sui set non sono parametri. Filtrare la PRIMA pagina e
 * basta e' cio' che faceva la versione precedente di questo server, e su un
 * elenco ordinato per data decrescente rispondeva "nessun risultato" a
 * "set giapponesi del 2024" — perche' la prima pagina e' fatta di set del 2026.
 *
 * Due garanzie, entrambe necessarie:
 *
 * - `stop` permette di terminare presto quando la lista e' ordinata e siamo
 *   usciti dalla finestra: senza, scorrere fino al 1996 per prendere il 2024
 *   costerebbe decine di richieste.
 * - `exhausted` dice se la scansione ha davvero visto tutto. Se e' falso il
 *   chiamante DEVE dirlo nella risposta: un elenco parziale presentato come
 *   completo e' il modo in cui un agente conclude che una carta non esiste.
 */
export interface Collected<T> {
  readonly rows: readonly T[];
  /** true se la scansione e' arrivata in fondo o ha incontrato `stop`. */
  readonly exhausted: boolean;
  readonly scannedPages: number;
  readonly nextCursor: string | undefined;
}

export type Verdict = 'keep' | 'skip' | 'stop';

export async function collect<T>(
  fetchPage: (cursor: string | undefined) => Promise<Envelope<T>>,
  verdict: (row: T) => Verdict,
  limit: number,
  maxPages = 8,
): Promise<Collected<T>> {
  const rows: T[] = [];
  let cursor: string | undefined;
  let pages = 0;
  let stopped = false;

  while (pages < maxPages) {
    const body = await fetchPage(cursor);
    pages += 1;

    for (const row of body.data) {
      const call = verdict(row);
      if (call === 'stop') {
        stopped = true;
        break;
      }
      if (call === 'keep') rows.push(row);
      if (rows.length >= limit) break;
    }

    const next = body.links?.next;
    if (stopped || rows.length >= limit || next === undefined) {
      return {
        rows,
        exhausted: stopped || next === undefined,
        scannedPages: pages,
        nextCursor: rows.length >= limit ? (next === undefined ? undefined : cursorOf(next)) : undefined,
      };
    }

    cursor = cursorOf(next);
    if (cursor === undefined) break;
  }

  return { rows, exhausted: false, scannedPages: pages, nextCursor: cursor };
}

/** Il cursore e' opaco: si estrae dall'URL che l'API ha costruito, mai ricomposto. */
export function cursorOf(nextUrl: string): string | undefined {
  try {
    return new URL(nextUrl).searchParams.get('cursor') ?? undefined;
  } catch {
    return undefined;
  }
}
