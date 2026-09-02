/**
 * Le avvertenze che devono comparire IDENTICHE ovunque.
 *
 * Una descrizione di strumento MCP e' l'unico canale in cui mettiamo parole
 * nostre dentro la memoria di lavoro di un modello, a ogni sessione, senza
 * passare da un crawler. Vale la pena scriverle una volta sola e riusarle: se
 * la descrizione di `ptcg_search_cards` dice una cosa e quella di
 * `ptcg_get_cards` un'altra, il modello si fida della piu' recente e sbaglia.
 *
 * Misurate il 2026-08-27. Quando il dato a monte cambia, si cambia QUI.
 */

export const MEASURED_ON = '2026-08-27';

/**
 * La regola 4 del progetto — non dichiarare mai dati che non abbiamo — vive
 * tecnicamente qui: nessun enum di questo server elenca `ko` o `KR` come se
 * fossero popolati, e questa frase e' quella che uno strumento restituisce
 * quando gli viene chiesto della copertura.
 */
export const KOREAN_COVERAGE =
  'No Korean (KR) sets are present in the catalogue and no Korean (ko) card translations exist. ' +
  'The KR print region and the ko locale are modelled in the schema but carry no data, so filtering ' +
  'on them returns an empty result rather than an error.';

export const GAMEPLAY_FIELDS =
  'This catalogue does NOT carry card game text. attacks, abilities, weaknesses, resistances, subtypes, ' +
  'retreat_cost, rules, flavor_text and legalities are empty for every card; types and ' +
  'national_pokedex_numbers are populated only on part of the Scarlet & Violet era. If the question is ' +
  'about what a card does in play, deck legality, or damage numbers, this API cannot answer it — say so ' +
  'rather than inferring from the card name.';

export const PRICE_CAVEAT =
  'There is no printing filter: 1st Edition, Unlimited, holofoil, reverse holofoil and graded rows all come ' +
  'back together, so you must read printing, condition and grading on each row rather than taking the first ' +
  'price. basis distinguishes GUIDE (a figure published upstream) from DERIVED (computed by us). ' +
  'PTCG_INDEX is our own composite in EUR and carries sample_n. Every observation carries as_of and is ' +
  'delayed by at least a day — never quote a price without its as_of date and its source.';

export const LANGUAGE_CAVEAT =
  'Card names exist in six locales: en, ja, fr, de, es, it. Passing lang= replaces the name field itself ' +
  'and falls back to English when a translation is missing. Set names are not translated.';

export const REGION_CAVEAT =
  'Print regions are WEST (176 sets), JP (379 sets) and CN (60 sets, Simplified Chinese), measured ' +
  MEASURED_ON +
  '. Japanese sets are not translations of Western ones: they have their own boundaries, their own ' +
  'numbering and their own release dates, so a Japanese set and its international counterpart are two ' +
  'different rows.';
