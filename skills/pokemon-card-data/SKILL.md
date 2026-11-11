---
name: pokemon-card-data
description: Look up Pokémon trading cards, sets, illustrators, sealed products and their prices with the pokemontcgapi tools. Use when the user asks what a Pokémon card or booster box is worth, wants cards by name, set, artist, rarity or print region (international, Japanese, Simplified Chinese), or shows a photo of a card to identify.
---

# Pokémon card data

The `ptcg_*` tools read the catalogue at pokemontcgapi.com. They are all read-only. Most calls cost
credits on the user's account, so answer with the fewest calls that settle the question.

## Which tool

- A card by name, set, artist, rarity or region: `ptcg_search_cards`. Pass `region` (`WEST`, `JP`,
  `CN`) when the user names a print line; `lang` only picks the language of the name.
- Ids already known: `ptcg_get_cards`, up to 100 in one call. Both `base1-4` and `bs-4` resolve.
- What a card is worth: `ptcg_get_card_prices`.
- Sets: `ptcg_list_sets`. Illustrators: `ptcg_list_artists`.
- Booster boxes, packs, ETBs, tins: `ptcg_search_sealed`, then `ptcg_get_sealed_prices`.
- Unsure of a filter value (type, supertype, rarity): `ptcg_get_reference` first. It is free and
  returns the exact strings, so the filter is not guessed.
- Unsure whether the catalogue holds something at all: `ptcg_get_catalogue_status`.
- A photo of a card: `ptcg_identify_card_from_image`. 25 credits a call; do not retry it on your own.

## Reading prices

There is no printing filter. First Edition, Unlimited, holofoil, reverse holofoil and graded rows
come back together, so read `printing`, `condition` and `grading` on each row before quoting a
number, and say which row you quoted.

- Give the source and the `as_of` date with every price. Prices are at least a day old.
- `basis` is `GUIDE` for a figure published by the source and `DERIVED` for one computed by the API.
  `PTCG_INDEX` is the API's own composite in EUR and carries `sample_n`.
- eBay rows are asking prices, not sales. Say so when you quote one.
- A plan can withhold graded rows or non-English locales. The result names what was withheld. When
  it does, tell the user the rows are missing because of the plan, not that they do not exist.

## What the catalogue does not hold

- No Korean cards. A Korean filter returns nothing, not an error.
- Game text (attacks, abilities, weaknesses) exists for international printings only. On a Japanese
  or Chinese card a null `attacks` means the text is not held, not that the card has no attack.
- No format legalities. Questions about deck legality cannot be answered from here.

## Refusals

When a result starts with a `next_step.handoff` sentence, the account needs something only its owner
can do: checkout, email verification or a plan change. Show that sentence and its URL to the user as
written and stop. Do not retry the call.

The centering tools give a ceiling from centering alone. It is not a prediction of the final grade,
and a result is never "verified" or "certified".
