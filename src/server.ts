import { createRequire } from 'node:module';
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { Api, ApiError, DEFAULT_BASE_URL, type Envelope } from './api.js';
import {
  GAMEPLAY_FIELDS,
  KOREAN_COVERAGE,
  LANGUAGE_CAVEAT,
  MEASURED_ON,
  PRICE_CAVEAT,
  REGION_CAVEAT,
} from './caveats.js';
import { batchMissing, missingText, type BatchResult } from './batch.js';
import { collect, type Verdict } from './collect.js';
import { MAX_ROWS, clampLimit, moreLine, table } from './render.js';

/**
 * Sette strumenti, non sedici.
 *
 * La tentazione e' mappare uno strumento per endpoint: e' meccanico e sembra
 * completo. Costa due cose. La prima e' che `tools/list` sta nel contesto a
 * OGNI turno, quindi sedici schemi si pagano anche nelle conversazioni che non
 * toccano le carte. La seconda, peggiore, e' che costringe il modello a
 * incatenare chiamate — cerca il set, prendi il codice, elenca le carte,
 * prendi i prezzi — e ogni anello e' un punto in cui puo' sbagliare.
 *
 * Qui gli strumenti hanno la forma delle DOMANDE ("quali set giapponesi sono
 * usciti nel 2024", "quanto vale questo Charizard in euro"), e i parametri sono
 * enumerati dove l'API accetterebbe testo libero: un enum e' un errore che il
 * modello non puo' commettere.
 *
 * Cio' che NON e' esposto, e perche':
 * - gli endpoint di prezzo dedicati (`/v1/cards/{id}/prices`): rispondono 200,
 *   misurato il 2026-09-16, e sono l'unica strada per filtrare il locale delle
 *   quotazioni. Restano fuori perche' ptcg_get_card_prices fa lo stesso lavoro
 *   in una chiamata e a un credito invece di due; in cambio la tabella mostra
 *   il locale di ogni riga, che e' la cosa da non perdere;
 * - il feed delle modifiche: risponde benissimo (misurato il 2026-09-16:
 *   879.813 righe, ultima di stanotte), ed e' escluso per un'altra ragione,
 *   cioe' che serve a tenere allineata una copia locale e non a rispondere a
 *   una domanda dentro una conversazione. La frase «risponde 404» era falsa e
 *   stava nel sorgente pubblico;
 * - gli export bulk: un agente non deve tirarsi in contesto un dump.
 *
 * L'ottavo strumento e' il riconoscimento da foto, ed e' l'unico che non e' una
 * lettura. Sta qui perche' e' esattamente cio' che un agente multimodale non
 * puo' fare da solo: guardare una carta e riconoscerla dall'illustrazione e'
 * il compito su cui un modello generico allucina con la massima sicurezza —
 * dice "Charizard Base Set" davanti a una ristampa e non ha modo di sapere di
 * aver sbagliato. Qui la risposta e' misurata, e quando e' ambigua lo dichiara.
 */

const api = new Api();

/** Solo cio' che esiste davvero. Un enum e' una promessa. */
const REGIONS = ['WEST', 'JP', 'CN'] as const;
// Gli otto locali che hanno davvero righe in tabella, misurati il 2026-09-16:
// en 57.421, fr 42.858, de 42.604, ja 27.230, it 21.644, es 21.003, pt 13.822,
// zh 3.492. L'API ne accetta nove: `ko` resta fuori perche' ha zero righe, ed
// e' la regola per cui un enum non promette cio' che non esiste.
const LOCALES = ['en', 'fr', 'de', 'ja', 'it', 'es', 'pt', 'zh'] as const;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** Proiezione compatta: senza, ogni riga porta quaranta campi di cui il modello ne legge sei. */
const CARD_FIELDS = ['id', 'name', 'number', 'rarity', 'set_code', 'set_name', 'release_date', 'print_region', 'artist_name', 'index_eur'];

interface CardRow {
  id: string;
  /** L'id storico, quando esiste: `base1-4` per la carta che oggi e' `bs-4`. */
  legacy_id?: string | null;
  name: string;
  number: string;
  rarity: string | null;
  set_code: string;
  set_name: string;
  release_date: string | null;
  print_region: string;
  artist_name: string | null;
  index_eur: number | null;
}

interface SetRow {
  code: string;
  name: string;
  series: string | null;
  region: string;
  release_date: string | null;
  total: number | null;
  printed_total: number | null;
}

interface PriceRow {
  source: string;
  variant: string;
  basis: string;
  /** L'API risponde `amount`. Letto come `price`, la colonna usciva vuota. */
  amount: number;
  currency: string;
  /** Il locale della quotazione, che non e' la lingua del nome della carta. */
  locale: string | null;
  printing: string | null;
  condition: string | null;
  grading: { company: string | null; score: string } | null;
  as_of: string;
  sample_n: number | null;
  provenance: string;
}

function textResult(text: string, structured: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text }], structuredContent: structured };
}

/**
 * Il messaggio dell'API dice «mandala come header X-Api-Key»: giusto per un
 * client HTTP, sbagliato qui. Un modello non puo' mettere header su questo
 * trasporto, e provando a farlo gira a vuoto invece di chiedere la sola cosa
 * che sblocca la situazione, cioe' una variabile nella configurazione.
 */
const MISSING_KEY_HELP = [
  'PTCG_API_KEY is not set for this MCP server. Seven of the eight tools will fail without it. The exception is ptcg_get_reference, which reads a public route; ptcg_get_catalogue_status is not an exception, because after the public /v1/status it reads one set per print region, which is not public.',
  'This cannot be fixed from inside the conversation: it is an environment variable in the MCP client configuration.',
  'Ask the user to add it, then restart the client. A signup takes one call, no dashboard and no card:',
  '',
  'Generate the Idempotency-Key once per signup and keep it with the request body:',
  '',
  'IDEM=$(uuidgen)',
  '',
  `curl -s -X POST "${process.env['PTCG_BASE_URL'] ?? DEFAULT_BASE_URL}/v1/accounts/free" \\`,
  '  -H "Content-Type: application/json" \\',
  '  -H "Idempotency-Key: $IDEM" \\',
  '  -d \'{"email":"you@example.com"}\'',
  '',
  'Lost the response? Repeat the exact same request (same Idempotency-Key, same body byte for byte, same network: same public IPv4 or the same IPv6 /64) within 24 hours and the response comes back, if stored, secret included; it is the original response, so a key rotated or revoked since then is not revived. A new Idempotency-Key for the same email returns 409 ACCOUNT_EXISTS; the same key with a different body returns 409 IDEMPOTENCY_CONFLICT.',
  'We store only a hash of the key; the signup response is kept for 24 hours so the same request can be replayed. Save `data.key.secret` now.',
  'If each command runs in a fresh shell, store the Idempotency-Key with the request body, privately: it is enough to fetch the secret again.',
  'If replay is unavailable, [sign in](https://pokemontcgapi.com/account) and rotate the key, or use /v1/accounts/recover with an already verified email to get a new secret.',
  'Put data.key.secret in PTCG_API_KEY. Details: https://pokemontcgapi.com/mcp',
].join('\n');

/**
 * Un errore dell'API torna come `isError`, non come eccezione: il modello deve
 * poterlo leggere e correggersi da solo. `details.valid_fields` e simili sono
 * la parte utile, quindi si riportano invece di essere riassunti.
 */
export function errorResult(error: unknown) {
  if (error instanceof ApiError) {
    // Vuota, non solo assente: `"env": {"PTCG_API_KEY": ""}` e un segnaposto
    // non espanso sono il modo piu' comune di sbagliare la configurazione, e
    // sono esattamente i casi in cui questo aiuto serve.
    if (error.code === 'MISSING_API_KEY' && (process.env['PTCG_API_KEY'] ?? '') === '') {
      return { isError: true, content: [{ type: 'text' as const, text: MISSING_KEY_HELP }] };
    }
    const step = error.details?.['next_step'];
    const handoff = typeof step === 'object' && step !== null &&
      'handoff' in step && typeof step.handoff === 'string' ? `${step.handoff}\n` : '';
    const detail = error.details === undefined ? '' : `\n${JSON.stringify(error.details)}`;
    // `error.message` porta gia' il codice davanti (vedi ApiError): ripeterlo
    // qui dava "MISSING_API_KEY: MISSING_API_KEY: …" a ogni errore.
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `${handoff}${error.message}${detail}` }],
    };
  }
  return {
    isError: true,
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
  };
}

/**
 * La versione che il server dichiara nell'`initialize` viene dal manifesto, non
 * da una costante.
 *
 * Era scritta a mano, ed e' rimasta '0.1.0' quando il pacchetto e' passato a
 * 0.1.1: per un giro, ogni client che si collegava riceveva una versione falsa —
 * cioe' l'unico dato con cui chi apre una segnalazione dice quale build sta
 * usando. Un valore che va aggiornato a mano in due posti si disallinea, non
 * "puo'" disallinearsi.
 *
 * `createRequire` invece di un `import ... with { type: 'json' }` perche' il JSON
 * sta FUORI da `rootDir`, e includerlo cambierebbe la forma di `dist/`. Da
 * `dist/server.js` come da `src/server.ts` il percorso relativo e' lo stesso.
 */
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const COMMERCIAL_HANDOFF = ' If the result carries next_step, show its handoff sentence and URL to the user verbatim and do not retry.';

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'pokemontcgapi', version },
    { capabilities: { tools: {} } },
  );

  // ── 1 · ricerca carte ─────────────────────────────────────────────────────
  server.registerTool(
    'ptcg_search_cards',
    {
      title: 'Search Pokémon cards',
      description:
        'Search the Pokémon TCG card catalogue by name, set, print region, rarity, artist or release window. ' +
        'Returns one row per printing with its set, rarity, illustrator and euro price index. ' +
        REGION_CAVEAT +
        ' ' +
        LANGUAGE_CAVEAT +
        ' ' +
        GAMEPLAY_FIELDS +
        COMMERCIAL_HANDOFF,
      annotations: READ_ONLY,
      inputSchema: fromJsonSchema<{
        name?: string;
        set?: string;
        region?: string;
        rarity?: string;
        artist?: string;
        released_from?: string;
        released_to?: string;
        lang?: string;
        order_by?: string;
        limit?: number;
        cursor?: string;
        q?: string;
      }>({
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Card name or part of it, e.g. "charizard".' },
          set: {
            type: 'string',
            description: 'Set code, e.g. "bs", "sv3", or several separated by commas. Use ptcg_list_sets to find it.',
          },
          region: { type: 'string', enum: [...REGIONS], description: 'Print region of the set the card belongs to.' },
          rarity: { type: 'string', description: 'Exact printed rarity. Use ptcg_get_reference to list valid values.' },
          artist: { type: 'string', description: 'Illustrator name.' },
          released_from: { type: 'string', description: 'ISO date, inclusive lower bound on the set release date.' },
          released_to: { type: 'string', description: 'ISO date, inclusive upper bound on the set release date.' },
          lang: { type: 'string', enum: [...LOCALES], description: 'Return card names in this locale.' },
          order_by: { type: 'string', description: 'e.g. "-set.releaseDate", "name". Sorting always ends with id.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_ROWS, description: `Rows, capped at ${MAX_ROWS}.` },
          cursor: { type: 'string', description: 'Opaque cursor from a previous call. Never construct one.' },
          q: {
            type: 'string',
            description:
              'Escape hatch: raw Lucene-style query. Field names are camelCase and dotted (set.code, ' +
              'set.releaseDate, nationalPokedexNumbers) while response keys are snake_case. Only use this ' +
              'when the named arguments above cannot express the question.',
          },
        },
        additionalProperties: false,
      }),
    },
    async (args) => {
      try {
        const clauses: string[] = [];
        // Niente wildcard iniziali: l'API le rifiuta con QUERY_UNSUPPORTED, e
        // ha ragione — un pattern che comincia per "*" non ha prefisso su cui
        // cercare. `name:charizard` gia' matcha come sottostringa.
        if (args.name !== undefined && args.name !== '') clauses.push(`name:${JSON.stringify(args.name)}`);
        if (args.rarity !== undefined && args.rarity !== '') clauses.push(`rarity:${JSON.stringify(args.rarity)}`);
        if (args.artist !== undefined && args.artist !== '') clauses.push(`artist:${JSON.stringify(args.artist)}`);
        if (args.released_from !== undefined) clauses.push(`set.releaseDate:[${args.released_from} TO *]`);
        if (args.released_to !== undefined) clauses.push(`set.releaseDate:[* TO ${args.released_to}]`);
        // La regione filtra l'API (`set.region` e' nella grammatica): scorrerla
        // qui voleva dire pagare 2 crediti a pagina per scartare righe WEST.
        if (args.region !== undefined) clauses.push(`set.region:${args.region}`);
        if (args.q !== undefined && args.q !== '') clauses.push(args.q);

        const limit = clampLimit(args.limit);

        const collected = await collect<CardRow>(
          (cursor) =>
            api.get<Envelope<CardRow>>('/v1/cards', {
              q: clauses.length === 0 ? undefined : clauses.join(' '),
              set: args.set,
              lang: args.lang,
              orderBy: args.order_by,
              cursor: cursor ?? args.cursor,
              limit,
              // Dal 2026-09-10 l'indice sulle righe di lista si chiede: 1 credito
              // ogni 50 righe. Senza, `index_eur` in `select` torna righe senza
              // il campo e `meta.withheld: ["index"]`.
              include: 'index',
              select: CARD_FIELDS,
            }),
          (): Verdict => 'keep',
          limit,
        );

        const rows = collected.rows;
        const trailer =
          collected.nextCursor !== undefined
            ? `

More rows available. Call again with cursor="${collected.nextCursor}".`
            : collected.exhausted
              ? ''
              : collected.truncatedMidPage
                ? `

The row limit filled in the middle of a page, so there is no cursor to continue from: one here would skip the rest of that page. Narrow the query (a set, a rarity, a tighter release window) or raise limit.`
                : `

Scan stopped after ${collected.scannedPages} pages without reaching the end of the catalogue; there may be more matches.`;

        const text =
          table(
            ['id', 'name', 'set', 'rarity', 'region', 'released', 'EUR idx'],
            rows.map((c) => [c.id, c.name, c.set_code, c.rarity, c.print_region, c.release_date, c.index_eur]),
          ) + trailer;

        return textResult(text, { cards: rows, complete: collected.exhausted });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ── 2 · carte per id ──────────────────────────────────────────────────────
  server.registerTool(
    'ptcg_get_cards',
    {
      title: 'Get Pokémon cards by id',
      description:
        'Fetch one or many cards by id, in a single call. Ids join set code and collector number, ' +
        'e.g. "bs-4"; the historical alias "base1-4" resolves on the same route. ' +
        'A canonical set prefix resolves only inside that set. Unresolved ids are listed in missing, ' +
        'with existing historical alternatives in missing_details when the API provides them. ' +
        GAMEPLAY_FIELDS +
        COMMERCIAL_HANDOFF,
      annotations: READ_ONLY,
      inputSchema: fromJsonSchema<{ ids: string[]; lang?: string; include_prices?: boolean }>({
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 100,
            description: 'Card ids, 1 to 100.',
          },
          lang: { type: 'string', enum: [...LOCALES] },
          include_prices: { type: 'boolean', description: 'Attach the full price list to each card.' },
        },
        required: ['ids'],
        additionalProperties: false,
      }),
    },
    async (args) => {
      try {
        const ids = args.ids.slice(0, 100);
        const body = await api.get<BatchResult<CardRow>>('/v1/cards/batch', {
          ids,
          lang: args.lang,
          include: args.include_prices === true ? 'prices' : 'index',
          // `legacy_id` sta nella proiezione perche' serve a dire chi manca:
          // `base1-4` torna come `bs-4`, e senza il confronto sull'alias il
          // server dichiarava mancante una carta che aveva in mano.
          select: args.include_prices === true ? undefined : [...CARD_FIELDS, 'legacy_id'],
        });

        const missingDetails = batchMissing(ids, body);
        // Manteniamo l'array di stringhe del tool per i client MCP esistenti.
        const missing = missingDetails.map((item) => item.id);
        const text =
          table(
            ['id', 'name', 'set', 'rarity', 'region', 'released', 'EUR idx'],
            body.data.map((c) => [c.id, c.name, c.set_code, c.rarity, c.print_region, c.release_date, c.index_eur]),
          ) +
          missingText(missingDetails);

        return textResult(text, { cards: body.data, requested: body.requested, found: body.found, missing, missing_details: missingDetails });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ── 3 · prezzi ────────────────────────────────────────────────────────────
  server.registerTool(
    'ptcg_get_card_prices',
    {
      title: 'Get prices for a Pokémon card',
      description:
        'Every current price observation for one card, each with its source, basis, printing, grade, sample ' +
        'size and the day it is for. ' +
        PRICE_CAVEAT +
        COMMERCIAL_HANDOFF,
      annotations: READ_ONLY,
      inputSchema: fromJsonSchema<{ id: string; currency?: string }>({
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Card id, e.g. "bs-4" or "base1-4".' },
          currency: {
            type: 'string',
            enum: ['EUR', 'USD'],
            description: 'Only show rows already denominated in this currency. Nothing is ever converted.',
          },
        },
        required: ['id'],
        additionalProperties: false,
      }),
    },
    async (args) => {
      try {
        const { body: card, withheld } = await api.getWithWithheld<{ id: string; name: string; index_eur: number | null; last_price_at: string | null; prices?: PriceRow[] }>(
          `/v1/cards/${encodeURIComponent(args.id)}`,
          { include: 'prices' },
        );

        const all = card.prices ?? [];
        const rows = args.currency === undefined ? all : all.filter((p) => p.currency === args.currency);

        // I prezzi non si tagliano: vedi il commento in render.ts.
        const text =
          `${card.name} (${card.id}) — composite index ${card.index_eur ?? '—'} EUR, last recomputed ${card.last_price_at ?? '—'}\n\n` +
          table(
            // `loc` e' in tabella perche' senza il modello confronta una
            // quotazione francese con una inglese come se fossero la stessa
            // cosa: `include=prices` su una carta restituisce ogni locale che
            // il piano concede, e la valuta non dice la lingua.
            ['source', 'variant', 'basis', 'price', 'cur', 'loc', 'printing', 'grade', 'as_of', 'n'],
            rows.map((p) => [
              p.source,
              p.variant,
              p.basis,
              p.amount,
              p.currency,
              p.locale,
              p.printing,
              p.grading === null ? null : `${p.grading.company ?? 'any grader'} ${p.grading.score}`,
              p.as_of,
              p.sample_n,
            ]),
          ) +
          (withheld.length === 0
            ? ''
            : `\n\nWithheld by the plan of this key, not missing from the catalogue: ${withheld.join(', ')}.`);

        return textResult(text, {
          card: { id: card.id, name: card.name, index_eur: card.index_eur, last_price_at: card.last_price_at },
          prices: rows,
          ...(withheld.length === 0 ? {} : { withheld }),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ── 4 · set ───────────────────────────────────────────────────────────────
  server.registerTool(
    'ptcg_list_sets',
    {
      title: 'List Pokémon TCG sets',
      description:
        'Every set with its code, series, print region, release date and, where we hold it, printed total: no Japanese set has one. One call answers ' +
        'questions like "every Japanese set released in 2024". ' +
        REGION_CAVEAT +
        COMMERCIAL_HANDOFF,
      annotations: READ_ONLY,
      inputSchema: fromJsonSchema<{
        region?: string;
        series?: string;
        name?: string;
        released_from?: string;
        released_to?: string;
        order_by?: string;
        limit?: number;
        cursor?: string;
      }>({
        type: 'object',
        properties: {
          region: { type: 'string', enum: [...REGIONS] },
          series: { type: 'string', description: 'Era or series name, e.g. "Scarlet & Violet".' },
          name: { type: 'string', description: 'Set name or part of it.' },
          released_from: { type: 'string', description: 'ISO date, inclusive lower bound.' },
          released_to: { type: 'string', description: 'ISO date, inclusive upper bound.' },
          order_by: { type: 'string', description: 'e.g. "-release_date" (default) or "release_date".' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_ROWS },
          cursor: { type: 'string' },
        },
        additionalProperties: false,
      }),
    },
    async (args) => {
      try {
        const limit = clampLimit(args.limit);
        const orderBy = args.order_by ?? '-release_date';
        // L'ordinamento di default e' per data decrescente: appena una riga e'
        // piu' vecchia del limite inferiore, tutte le successive lo sono, e la
        // scansione puo' fermarsi. E' cio' che rende praticabile "i set
        // giapponesi del 2024" in una sola chiamata.
        const descendingByDate = orderBy === '-release_date';

        const collected = await collect<SetRow>(
          (cursor) =>
            api.get<Envelope<SetRow>>('/v1/sets', {
              region: args.region,
              series: args.series,
              // `q` su /v1/sets e' testo libero, NON la grammatica a campi
              // delle carte: `name:Base` non trova nulla, `Base` si'.
              q: args.name,
              orderBy,
              // `cursor ?? args.cursor`: quello locale vale dalla seconda
              // pagina in poi, ma la PRIMA richiesta deve partire da dove il
              // chiamante ha detto. Senza, un client che continua ricominciava
              // dall'inizio e rileggeva le stesse righe per sempre.
              cursor: cursor ?? args.cursor,
              limit: 100,
            }),
          (set): Verdict => {
            if (set.release_date === null) {
              return args.released_from === undefined && args.released_to === undefined ? 'keep' : 'skip';
            }
            if (args.released_to !== undefined && set.release_date > args.released_to) return 'skip';
            if (args.released_from !== undefined && set.release_date < args.released_from) {
              return descendingByDate ? 'stop' : 'skip';
            }
            return 'keep';
          },
          limit,
        );

        const rows = collected.rows;
        const trailer =
          collected.nextCursor !== undefined
            ? `

More rows available. Call again with cursor="${collected.nextCursor}".`
            : collected.exhausted
              ? ''
              : collected.truncatedMidPage
                ? `

The row limit filled in the middle of a page, so there is no cursor to continue from: one here would skip the rest of that page. Narrow the window or raise limit.`
                : `

Scan stopped after ${collected.scannedPages} pages; there may be more matching sets.`;

        const text =
          table(
            ['code', 'name', 'region', 'released', 'printed', 'total'],
            rows.map((set) => [set.code, set.name, set.region, set.release_date, set.printed_total, set.total]),
          ) + trailer;

        return textResult(text, { sets: rows, complete: collected.exhausted });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ── 5 · vocabolari ────────────────────────────────────────────────────────
  server.registerTool(
    'ptcg_get_reference',
    {
      title: 'List the closed vocabularies',
      description:
        'The exact strings the catalogue uses for types, supertypes, subtypes and rarities. Call this before ' +
        'filtering on a rarity or a type rather than guessing the wording — "Rare Rainbow" and "Rainbow Rare" ' +
        'are not the same string, and only one of them matches.' +
        COMMERCIAL_HANDOFF,
      annotations: READ_ONLY,
      inputSchema: fromJsonSchema<{ vocabulary: string }>({
        type: 'object',
        properties: {
          vocabulary: { type: 'string', enum: ['types', 'supertypes', 'rarities', 'subtypes'] },
        },
        required: ['vocabulary'],
        additionalProperties: false,
      }),
    },
    async (args) => {
      try {
        // Da `/v1/reference`, non da `/v1/<vocabolario>`: quelle quattro rotte
        // non esistono e non sono mai esistite. Vedi `Api.reference()`.
        const vocabularies = await api.reference();
        const values = vocabularies[args.vocabulary];
        if (values === undefined) {
          // Non un 404 travestito: se un giorno l'API rinomina una chiave,
          // questo dice QUALI ci sono invece di lasciare l'agente a indovinare.
          return textResult(
            `Unknown vocabulary "${args.vocabulary}". The catalogue publishes: ` +
              `${Object.keys(vocabularies).sort().join(', ')}.`,
            { vocabulary: args.vocabulary, available: Object.keys(vocabularies).sort() },
          );
        }
        const note = values.length === 0 ? ' (this vocabulary is not populated in the catalogue today)' : '';
        return textResult(`${args.vocabulary}${note}:\n${values.join('\n')}`, {
          vocabulary: args.vocabulary,
          values,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ── 6 · illustratori ──────────────────────────────────────────────────────
  server.registerTool(
    'ptcg_list_artists',
    {
      title: 'List card illustrators',
      description:
        'Illustrators with the number of cards each has drawn, deduplicated across 30 years of printings. ' +
        'Use the returned name with the artist argument of ptcg_search_cards to get their cards.' +
        COMMERCIAL_HANDOFF,
      annotations: READ_ONLY,
      inputSchema: fromJsonSchema<{ name?: string; limit?: number; cursor?: string }>({
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Illustrator name or part of it.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_ROWS },
          cursor: { type: 'string' },
        },
        additionalProperties: false,
      }),
    },
    async (args) => {
      try {
        const body = await api.get<Envelope<{ slug: string; name: string; card_count: number }>>('/v1/artists', {
          q: args.name,
          limit: clampLimit(args.limit),
          cursor: args.cursor,
        });

        const text =
          table(['slug', 'name', 'cards'], body.data.map((a) => [a.slug, a.name, a.card_count])) +
          moreLine(body.meta, body.links?.next);

        return textResult(text, { artists: body.data, meta: body.meta ?? null });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ── 7 · copertura ─────────────────────────────────────────────────────────
  /**
   * Questo strumento esiste per una ragione sola, ed e' la regola 4.
   *
   * Un modello a cui viene chiesto "questa API ha le carte coreane?" altrimenti
   * risponderebbe deducendolo da un enum o da un nome di prodotto, cioe'
   * inventando. Qui la risposta e' un fatto misurato che arriva da una chiamata,
   * ed e' scritta a lettere.
   */
  server.registerTool(
    'ptcg_get_catalogue_status',
    {
      title: 'What this catalogue actually covers',
      description:
        'Live counts and coverage for the catalogue: sets per print region, card total, which locales carry ' +
        'card names, and which data is explicitly NOT present. Call this before telling a user what the API ' +
        'can and cannot answer.' +
        COMMERCIAL_HANDOFF,
      annotations: READ_ONLY,
      inputSchema: fromJsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
    },
    async () => {
      try {
        const status = await api.get<{ catalog: { sets: number; cards: number; sealed: number }; sources: unknown[] }>(
          '/v1/status',
        );

        const perRegion = await Promise.all(
          (['WEST', 'JP', 'CN', 'KR'] as const).map(async (region) => {
            const body = await api.get<Envelope<SetRow>>('/v1/sets', { region, limit: 1 });
            return { region, sets: body.meta?.total_count ?? 0 };
          }),
        );

        const coverage = {
          measured_at: new Date().toISOString(),
          sets: status.catalog.sets,
          cards: status.catalog.cards,
          sealed_products: status.catalog.sealed,
          sets_by_print_region: Object.fromEntries(perRegion.map((r) => [r.region, r.sets])),
          card_name_locales: [...LOCALES],
          // I valori ammessi da `?source=`, copiati da `validSources` nel Go.
          // Diceva `EBAY_SOLD`, che non esiste e fa prendere un 400 a chi ci
          // filtra, e ometteva PRICECHARTING, che e' la seconda fonte per volume.
          price_sources: ['TCGPLAYER', 'PRICECHARTING', 'CARDMARKET', 'CARDTRADER', 'EBAY', 'COMMUNITY', 'PTCG_INDEX'],
          coverage_notes: [KOREAN_COVERAGE, GAMEPLAY_FIELDS, LANGUAGE_CAVEAT],
        };

        const text = [
          `Catalogue: ${status.catalog.sets} sets, ${status.catalog.cards} cards, ${status.catalog.sealed} sealed products.`,
          '',
          table(['print region', 'sets'], perRegion.map((r) => [r.region, r.sets])),
          '',
          `Card-name locales: ${LOCALES.join(', ')}`,
          `Price sources: ${coverage.price_sources.join(', ')}`,
          '',
          KOREAN_COVERAGE,
          '',
          GAMEPLAY_FIELDS,
        ].join('\n');

        return textResult(text, coverage);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // ── 8 · riconoscimento da foto ────────────────────────────────────────────
  /**
   * L'unico strumento che scrive qualcosa (un'immagine) e l'unico che costa 25
   * crediti invece di uno. Entrambe le cose stanno nella descrizione, perche' un
   * modello che non le sa lo mette in un ciclo.
   *
   * Il contratto verso il modello e' scritto per essere difficile da sbagliare:
   * la risposta dice a lettere cosa fare in ognuno dei tre casi, invece di
   * lasciare che sia il modello a dedurre cosa significhi `ambiguous`. Un
   * assistente che consegna la ristampa sbagliata in una collezione fa un danno
   * che l'utente scopre mesi dopo, quando prova a venderla.
   */
  server.registerTool(
    'ptcg_identify_card_from_image',
    {
      title: 'Identify a card from a photo',
      description:
        'Recognise a Pokemon card from a photograph and return ranked candidates. Use this instead of guessing ' +
        'from what you see in an image: reprints share their artwork, so visual identification alone cannot ' +
        'name a printing, and this tool says so when it cannot. Costs 25 credits per call against 1 for a ' +
        'lookup — do not call it in a loop. Pass `set` or `region` when the user has told you either. ' +
        'Included from the Growth plan up: on a trial or Developer key it answers PLAN_REQUIRED without ' +
        'spending credits, and retrying will not change that.' +
        COMMERCIAL_HANDOFF,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        // NON idempotente: la stessa foto costa 25 crediti ogni volta che la
        // mandi. Dichiararlo idempotente inviterebbe un client a ritentare.
        idempotentHint: false,
        openWorldHint: true,
      },
      inputSchema: fromJsonSchema<{ image_base64: string; set?: string; region?: string; top_k?: number }>({
        type: 'object',
        properties: {
          image_base64: {
            type: 'string',
            description: 'The photograph, base64-encoded. A data: URL prefix is accepted and stripped.',
          },
          set: { type: 'string', description: 'Set code to restrict to, e.g. "sv3". Resolves reprint ties.' },
          region: { type: 'string', enum: [...REGIONS], description: 'Print region to restrict to.' },
          top_k: { type: 'integer', minimum: 1, maximum: 10, description: 'Candidates to return. Default 3.' },
        },
        required: ['image_base64'],
        additionalProperties: false,
      }),
    },
    async ({ image_base64, set, region, top_k }) => {
      try {
        const cleaned = image_base64.includes(',') && image_base64.startsWith('data:')
          ? image_base64.slice(image_base64.indexOf(',') + 1)
          : image_base64;
        const bytes = Uint8Array.from(Buffer.from(cleaned, 'base64'));
        if (bytes.byteLength === 0) {
          throw new ApiError(400, { code: 'INVALID_PARAMETER', message: 'image_base64 decoded to nothing.' });
        }

        const fields: Record<string, string> = {};
        if (set !== undefined) fields['set'] = set;
        if (region !== undefined) fields['region'] = region;
        if (top_k !== undefined) fields['top_k'] = String(top_k);

        const body = await api.postImage<{
          data: {
            decision: 'match' | 'ambiguous' | 'no_match';
            id: string | null;
            candidates: {
              id: string;
              name: string;
              number: string;
              set: { code: string; name: string; print_region: string };
              rarity: string | null;
              distance: number;
              confidence: number;
            }[];
          };
          meta: { regions_detected: number; cards_indexed: number };
        }>('/v1/vision/identify', bytes, fields);

        // La riga di istruzione viene PRIMA della tabella, non dopo: un modello
        // che legge dall'alto deve incontrare il vincolo prima dei dati su cui
        // sarebbe tentato di agire.
        const verdict =
          body.data.decision === 'match'
            ? `MATCH — one candidate is clearly closest. Safe to treat ${body.data.id} as the card.`
            : body.data.decision === 'ambiguous'
              ? 'AMBIGUOUS — two or more printings share this illustration and cannot be told apart from the ' +
                'image. Do NOT pick one. Present the candidates to the user, or ask which set it came from ' +
                'and call again with `set`.'
              : body.meta.regions_detected === 0
                ? 'NO MATCH — and no card-shaped region was found in the photo at all. Ask for a photo where ' +
                  'the card fills more of the frame, on a plain background. This is a framing problem, not ' +
                  'evidence that the card is missing from the catalogue.'
                : 'NO MATCH — a card was found in the photo but nothing in the catalogue is close enough. ' +
                  'Do not guess a name from what you see.';

        const rows = body.data.candidates.map((c) => [
          c.id,
          c.name,
          `${c.set.code} ${c.number}`,
          c.set.print_region,
          c.rarity ?? '—',
          c.distance,
        ]);

        const text = [
          verdict,
          '',
          rows.length === 0
            ? 'No candidates within range.'
            : table(['id', 'name', 'set / no.', 'region', 'rarity', 'distance'], rows),
          '',
          'distance is 0-512, lower is closer; real matches land well under 150. ' +
            `Compared against ${body.meta.cards_indexed} indexed card images.`,
        ].join('\n');

        return textResult(text, body.data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

export { MEASURED_ON };
