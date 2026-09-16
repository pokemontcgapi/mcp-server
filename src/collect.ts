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
  /**
   * true quando il limite si e' riempito a meta' di una pagina.
   *
   * E' il caso in cui NON si puo' consegnare un cursore: `links.next` punta
   * alla pagina dopo, quindi riprendere da li' salterebbe le righe rimaste in
   * quella corrente. Succede solo quando la pagina chiesta e' piu' grande del
   * limite, cioe' quando si filtra per regione (pagine da 100, limite 50).
   */
  readonly truncatedMidPage: boolean;
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
  let truncatedMidPage = false;

  while (pages < maxPages) {
    const body = await fetchPage(cursor);
    pages += 1;

    let seen = 0;
    for (const row of body.data) {
      seen += 1;
      const call = verdict(row);
      if (call === 'stop') {
        stopped = true;
        break;
      }
      if (call === 'keep') rows.push(row);
      if (rows.length >= limit) break;
    }
    truncatedMidPage = !stopped && rows.length >= limit && seen < body.data.length;

    const next = body.links?.next;
    if (stopped || rows.length >= limit || next === undefined) {
      return {
        rows,
        // Fermarsi a meta' pagina NON e' aver visto tutto, nemmeno sull'ultima
        // pagina: senza questa condizione `complete: true` dichiarava completa
        // una risposta che si era fermata a meta' dell'ultimo blocco.
        exhausted: (stopped || next === undefined) && !truncatedMidPage,
        scannedPages: pages,
        // Un cursore si consegna SOLO se la pagina e' stata letta per intero.
        // `links.next` punta alla pagina successiva: darlo dopo essersi
        // fermati a meta' fa saltare in silenzio le righe rimaste, ed e'
        // esattamente il modo in cui un agente conclude che una carta non
        // esiste. Meglio nessun cursore e dirlo.
        nextCursor:
          rows.length >= limit && !truncatedMidPage && next !== undefined ? cursorOf(next) : undefined,
        truncatedMidPage,
      };
    }

    cursor = cursorOf(next);
    if (cursor === undefined) break;
  }

  return { rows, exhausted: false, scannedPages: pages, nextCursor: cursor, truncatedMidPage: false };
}

/** Il cursore e' opaco: si estrae dall'URL che l'API ha costruito, mai ricomposto. */
export function cursorOf(nextUrl: string): string | undefined {
  try {
    return new URL(nextUrl).searchParams.get('cursor') ?? undefined;
  } catch {
    return undefined;
  }
}
