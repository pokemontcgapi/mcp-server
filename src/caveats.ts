/**
 * Le avvertenze che devono comparire IDENTICHE ovunque.
 *
 * Una descrizione di strumento MCP e' l'unico canale in cui mettiamo parole
 * nostre dentro la memoria di lavoro di un modello, a ogni sessione, senza
 * passare da un crawler. Vale la pena scriverle una volta sola e riusarle: se
 * la descrizione di `ptcg_search_cards` dice una cosa e quella di
 * `ptcg_get_cards` un'altra, il modello si fida della piu' recente e sbaglia.
 *
 * Misurate il 2026-09-16 sul database di produzione. Quando il dato a monte
 * cambia, si cambia QUI.
 *
 * La data precedente era il 2026-08-27, cioe' PRIMA del 2026-09-03 in cui il
 * testo di gioco e' arrivato: le percentuali erano calcolate su un catalogo di
 * 52.337 carte mentre oggi sono 57.450, e uscivano tre o quattro punti alte.
 */

export const MEASURED_ON = '2026-09-16';

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
  'Card game text is present since 2026-09-03, in English, and unevenly. Measured ' + MEASURED_ON + ': ' +
  'attacks on 29.9% of the catalogue, subtypes on 35.0%, weaknesses on 28.0%, flavor_text on 17.9%, ' +
  'abilities on 7.0%, rules on 5.1%. It sits on the ' +
  '20,725 Western printings, so read against those alone attacks is on 82.9% of them, while Japanese and ' +
  'Chinese printings carry none. Check the field on the card in hand rather than assuming: a null attacks ' +
  'means we do not hold it, never that the card has no attack. Still empty for every card: level, and ' +
  'legalities — deck legality is a question this API cannot answer, so say so rather than inferring it.';

export const PRICE_CAVEAT =
  'There is no printing filter: 1st Edition, Unlimited, holofoil, reverse holofoil and graded rows all come ' +
  'back together, so you must read printing, condition and grading on each row rather than taking the first ' +
  'price. basis distinguishes GUIDE (a figure published upstream) from DERIVED (computed by us). ' +
  'PTCG_INDEX is our own composite in EUR and carries sample_n. Every observation carries as_of and is ' +
  'delayed by at least a day — never quote a price without its as_of date and its source. Each row also ' +
  'carries its locale, and a card read with include=prices returns every locale the plan allows: the ' +
  'currency is not the language, so never compare a French row with an English one without saying so.';

export const LANGUAGE_CAVEAT =
  'Card names exist in eight locales, and they are far from equally filled. Measured ' + MEASURED_ON + ' ' +
  'against 57,450 cards: en 57,421, fr 42,858, de 42,604, ja 27,230, it 21,644, es 21,003, pt 13,822, ' +
  'zh 3,492. Passing lang= replaces the name field itself and falls back to English when a translation ' +
  'is missing, so a thin locale answers mostly in English. Set names are not translated.';

export const REGION_CAVEAT =
  'Print regions are WEST (176 sets), JP (379 sets) and CN (96 sets, Simplified Chinese), measured ' +
  MEASURED_ON +
  '. Japanese sets are not translations of Western ones: they have their own boundaries, their own ' +
  'numbering and their own release dates, so a Japanese set and its international counterpart are two ' +
  'different rows.';
