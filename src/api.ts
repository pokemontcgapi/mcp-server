/**
 * Client HTTP minimo verso api.pokemontcgapi.com.
 *
 * PERCHE' NON DIPENDE DA @pokemontcgapi/sdk, che pure esiste in questo repo:
 * questo server usa sei endpoint in sola lettura e non pagina mai in
 * profondita' (ogni risposta e' tagliata a 50 righe prima di tornare a un
 * modello), quindi dell'SDK userebbe il trasporto e nient'altro. In cambio
 * porterebbe un secondo pacchetto da tenere allineato in versione a ogni
 * pubblicazione. La copia e' ottanta righe e si legge tutta; la dipendenza
 * sarebbe piu' cara della copia. Se un giorno questo server dovesse iterare
 * collezioni intere, la scelta va rifatta al contrario.
 *
 * Provenienza: la gestione degli errori e la forma dell'envelope sono le stesse
 * di packages/sdk-typescript/src/{client,errors}.ts.
 */

const DEFAULT_BASE_URL = 'https://api.pokemontcgapi.com';
const TIMEOUT_MS = 20_000;

export interface ApiErrorShape {
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly request_id?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  readonly requestId: string | undefined;

  constructor(status: number, body: ApiErrorShape) {
    super(`${body.code}: ${body.message}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.request_id;
  }
}

export interface Envelope<T> {
  readonly data: readonly T[];
  readonly meta?: { readonly limit: number; readonly count: number; readonly total_count?: number; readonly has_more: boolean };
  readonly links?: { readonly next?: string };
}

export class Api {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(baseUrl = process.env['PTCG_BASE_URL'] ?? DEFAULT_BASE_URL, apiKey = process.env['PTCG_API_KEY']) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  async get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      search.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }

    const query = search.toString();
    const url = `${this.baseUrl}${path}${query === '' ? '' : `?${query}`}`;

    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': '@pokemontcgapi/mcp',
    };
    if (this.apiKey !== undefined) headers['x-api-key'] = this.apiKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, { headers, signal: controller.signal });

      if (!response.ok) {
        let body: ApiErrorShape = { code: `HTTP_${response.status}`, message: response.statusText };
        try {
          const parsed = (await response.json()) as { error?: ApiErrorShape };
          if (parsed.error?.code !== undefined) body = parsed.error;
        } catch {
          /* la risposta non era il nostro envelope: si tiene quella costruita sopra */
        }
        throw new ApiError(response.status, body);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * POST di un'immagine, per il riconoscimento.
   *
   * Metodo separato e non un parametro di `get`: la forma della richiesta e'
   * diversa in tutto — verbo, corpo, assenza di query — e schiacciarle in una
   * sola funzione produrrebbe una firma con quattro argomenti opzionali di cui
   * tre sempre inutilizzati.
   */
  async postImage<T>(path: string, image: Uint8Array, fields: Record<string, string> = {}): Promise<T> {
    const form = new FormData();
    // Il tipo generico e non `image/jpeg`: il formato lo riconosce il server
    // dai magic byte, e dichiarare quello sbagliato e' peggio che tacere.
    form.set('image', new Blob([image], { type: "application/octet-stream" }), 'card');
    for (const [key, value] of Object.entries(fields)) form.set(key, value);

    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': '@pokemontcgapi/mcp',
    };
    // Nessun content-type esplicito: il boundary del multipart lo scrive fetch,
    // e impostarlo a mano produce un corpo che il server non sa separare.
    if (this.apiKey !== undefined) headers['x-api-key'] = this.apiKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: form,
        signal: controller.signal,
      });

      if (!response.ok) {
        let body: ApiErrorShape = { code: `HTTP_${response.status}`, message: response.statusText };
        try {
          const parsed = (await response.json()) as { error?: ApiErrorShape };
          if (parsed.error?.code !== undefined) body = parsed.error;
        } catch {
          /* la risposta non era il nostro envelope */
        }
        throw new ApiError(response.status, body);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
