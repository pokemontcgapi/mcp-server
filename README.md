# @pokemontcgapi/mcp

[![npm](https://img.shields.io/npm/v/%40pokemontcgapi%2Fmcp)](https://www.npmjs.com/package/@pokemontcgapi/mcp) [![license](https://img.shields.io/npm/l/%40pokemontcgapi%2Fmcp)](./LICENSE) [![Glama](https://glama.ai/mcp/servers/pokemontcgapi/mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/pokemontcgapi/mcp-server)

An [MCP](https://modelcontextprotocol.io) server for the Pokémon TCG API at
[pokemontcgapi.com](https://pokemontcgapi.com). It gives an agent eight tools over the whole
catalogue: international, Japanese and Simplified Chinese print lines, card names in
eight locales, illustrators, images, and prices that carry their source, basis, grade and sample
size. The current counts are live at
[/v1/status](https://api.pokemontcgapi.com/v1/status) and broken down on
[coverage.json](https://pokemontcgapi.com/coverage.json).

Unofficial. Not produced, endorsed, supported by or affiliated with Nintendo, Creatures Inc.,
GAME FREAK inc. or The Pokémon Company International. Pokémon and all related marks are trademarks of
their respective owners.

## Get a key

Generate the Idempotency-Key once per signup and keep it with the request body:

```bash
IDEM=$(uuidgen)
```

```bash
curl -s -X POST "https://api.pokemontcgapi.com/v1/accounts/free" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEM" \
  -d '{"email":"you@example.com"}'
```

Lost the response? Repeat the exact same request (same Idempotency-Key, same body byte for byte, same network: same public IPv4 or the same IPv6 /64) within 24 hours and the response comes back, if stored, secret included; it is the original response, so a key rotated or revoked since then is not revived. A new Idempotency-Key for the same email returns 409 ACCOUNT_EXISTS; the same key with a different body returns 409 IDEMPOTENCY_CONFLICT.

We store only a hash of the key; the signup response is kept for 24 hours so the same request can be replayed. Save `data.key.secret` now.

If replay is unavailable, [sign in](https://pokemontcgapi.com/account) and rotate the key, or use /v1/accounts/recover with an already verified email to get a new secret.

The key comes back in `data.key.secret`. Confirming the address we email raises the trial from
80 to 800 credits, and the trial ends 30 days after signup. Paid plans start at 29 EUR a month:
[pricing](https://pokemontcgapi.com/pricing).

## Install

Claude Code:

```bash
claude mcp add pokemontcgapi --env PTCG_API_KEY=your-key -- npx -y @pokemontcgapi/mcp
```

Claude Desktop — `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pokemontcgapi": {
      "command": "npx",
      "args": ["-y", "@pokemontcgapi/mcp"],
      "env": { "PTCG_API_KEY": "your-key" }
    }
  }
}
```

Cursor — `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pokemontcgapi": {
      "command": "npx",
      "args": ["-y", "@pokemontcgapi/mcp"],
      "env": { "PTCG_API_KEY": "${env:PTCG_API_KEY}" }
    }
  }
}
```

VS Code — `.vscode/mcp.json`. Note the top-level key is `servers`, not `mcpServers`, and `inputs`
keeps the key out of the committed file:

```json
{
  "inputs": [
    { "id": "ptcg-key", "type": "promptString", "description": "pokemontcgapi key", "password": true }
  ],
  "servers": {
    "pokemontcgapi": {
      "command": "npx",
      "args": ["-y", "@pokemontcgapi/mcp"],
      "env": { "PTCG_API_KEY": "${input:ptcg-key}" }
    }
  }
}
```

Environment: `PTCG_API_KEY`, needed by seven of the eight tools, and `PTCG_BASE_URL` (defaults to
`https://api.pokemontcgapi.com`). Node ≥ 20. The exception is `ptcg_get_reference`, which reads a
public route. `ptcg_get_catalogue_status` is not an exception: it starts on the public `/v1/status`
and then reads one set per print region, which needs the key. Without it the server starts and lists
its tools, then those seven calls come back asking for it.

## The tools

Eight tools, not one per endpoint. `tools/list` sits in the model's context on every turn, so the
whole surface is about 11 KB, and each tool is shaped like a question rather than like a route —
the model does not have to chain four calls to answer one thing.

| Tool | Answers |
|---|---|
| `ptcg_search_cards` | "Charizard cards from Japanese sets", by name, set, region, rarity, artist or release window |
| `ptcg_get_cards` | Up to 100 ids in one call; `base1-4` and `bs-4` both resolve |
| `ptcg_get_card_prices` | Every current observation for a card, with printing, grade, `as_of` and `sample_n` |
| `ptcg_list_sets` | "Every Japanese set released in 2024" |
| `ptcg_get_reference` | The exact strings for types, supertypes and rarities, so filters are not guessed |
| `ptcg_list_artists` | Illustrators and how many cards each drew |
| `ptcg_get_catalogue_status` | What the catalogue does and does **not** contain, measured live |
| `ptcg_identify_card_from_image` | "Which card is this a photo of?" — ranked candidates, and an explicit refusal when reprints share the artwork. 25 credits a call, and included from the Growth plan up |

Every tool is annotated `readOnlyHint: true` and `destructiveHint: false`. Nothing here writes.
`ptcg_identify_card_from_image` is the one marked `idempotentHint: false`, because the same photo costs
25 credits every time it is sent — a client must not retry it on its own.

Commercial refusals put `next_step.handoff` on the first line of the tool result, followed by the API message and complete details. Show that sentence and its URL to the account owner verbatim and do not retry. The owner completes checkout, email verification or the contact step.

## Importing a card catalogue

For a complete card import, use the REST API directly:
`GET /v1/cards?limit=250&orderBy=id`, then follow `links.next` verbatim. The flat list fills pages
across set boundaries and uses fewer requests than a separate card loop for every set.
Add `include=translations` for names at the plain catalogue cost. Priced includes have separate tariffs.
For a single print region, add `q=set.region:JP` or `q=set.region:CN`; `lang` only selects a name translation.
Use `/v1/sets/{code}/cards` when you need a particular set and `/v1/sets?region=JP` to browse set metadata.

The [quickstart](https://pokemontcgapi.com/docs/quickstart#page-the-whole-catalogue) contains both
paging loops and dated measurements. The
[migration guide](https://pokemontcgapi.com/docs/migrate-from-pokemontcg-io) explains how to capture
a change feed watermark before importing and maintain the replica afterwards.
The MCP search tool is intended for bounded interactive searches; its `region` argument is sent to
the API as `set.region:JP` (or `CN`, `WEST`), so a Japanese search reads Japanese rows only. Use REST
for a complete import.

## What this API does not have

The last tool exists because of this section, and it returns these facts from a live call rather
than leaving a model to infer them:

- **No Korean cards.** Zero `KR` sets and zero `ko` translations. The print region and the locale are
  modelled in the schema and carry no data, so filtering on them returns an empty result, not an error.
- **Card game text is English, and uneven.** `attacks`, `abilities`, `weaknesses`, `resistances`,
  `subtypes`, `retreat_cost`, `rules` and `flavor_text` carry rows since 3 September 2026, on the
  20,725 Western printings. Measured on 16 September 2026 against 57,450 cards: `attacks` on 29.9% of
  the whole catalogue and 82.9% of the Western part, `subtypes` 35.0%, `weaknesses` 28.0%,
  `flavor_text` 17.9%, `abilities` 7.0%, `rules` 5.1%. Japanese and Chinese printings carry none, so a
  null `attacks` means we do not hold it, never that the card has no attack.
- **No format legalities.** The card object carries no `legalities` field, and `level` is empty. If the
  question is about deck legality, this API cannot answer it.

All three are measured, dated in the source, and repeated verbatim in the tool descriptions, so an
agent is told before it calls rather than after.

## Reading prices correctly

There is no printing filter. First Edition, Unlimited, holofoil, reverse holofoil and graded rows all
come back together, so read `printing`, `condition` and `grading` on each row rather than taking the
first number. `basis` separates `GUIDE` (published upstream) from `DERIVED` (computed by us);
`PTCG_INDEX` is our own composite in EUR and carries `sample_n`. Every observation has an `as_of`
date and is delayed by at least a day — never quote a price without it.

What the plan withholds is named rather than hidden: `graded` and `non_english_locales` for a trial
key, `graded` on Developer, nothing from Growth up. The API says so in `meta.withheld` on the prices
route, in the `X-Plan-Withheld` header when prices ride on a card, and in a top-level `withheld`
field on the batch. So a card with no graded rows may be the plan speaking, not the catalogue.

For `ptcg_get_cards`, the API's `missing` field is authoritative when present, including its
`suggested_id` values. The tool keeps its existing `missing` array of strings and adds
`missing_details`, an array of `{ id, suggested_id? }`; the text also shows each suggestion.
If the API omits `missing`, the tool falls back to comparing requested ids with returned `id`
and `legacy_id`, ignoring case and repeated ids. This supports older API versions without
another request, but cannot discover their unreported canonical-set collisions or suggestions.
The current API omits `missing` when every id resolves, so that fallback then returns an empty array.
`ptcg_get_card_prices` reads a card with its prices, so the exclusions arrive in that header.

## Context discipline

Results are capped at 50 rows regardless of what the API allows, sent as aligned tables rather than
JSON, with a compact field projection. A table is shorter than the same rows as JSON because the keys
are not repeated on every row; we do not publish a percentage, because we have no reproducible
measurement to show next to it.
Truncation is always announced along with the cursor to continue. Price rows are the one thing never
truncated.

## Protocol

Built on `@modelcontextprotocol/server` v2, which negotiates the
[2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) revision and accepts clients
down to `2024-10-07`. stdio transport.

The revision is the library's, not a claim of our own: `SUPPORTED_PROTOCOL_VERSIONS` in
`@modelcontextprotocol/server@2.0.0` tops out at `2025-11-25`, so a client that asks for anything
newer is answered with that. Verified against the published package, not read off a changelog.

## Also available

- **TypeScript SDK**, zero runtime dependencies: [`@pokemontcgapi/sdk`](https://www.npmjs.com/package/@pokemontcgapi/sdk) — [source](https://github.com/pokemontcgapi/sdk-typescript)
- **Docs**: <https://pokemontcgapi.com/docs>
- **Coverage, measured live**: <https://pokemontcgapi.com/coverage>

## Build from source

```bash
npm ci
npm run typecheck
npm run build
```

Node >= 20. `npm test` runs the unit tests in `tests/`. What CI enforces is that the package
typechecks and builds on both Node 20 and Node 22, and that `npm pack` produces
the file list the registry is meant to receive.

This package is developed inside the private monorepo that runs
[pokemontcgapi.com](https://pokemontcgapi.com) and mirrored here on each release,
so a merged pull request travels back by hand rather than by merge button. That
is not a reason to send patches elsewhere — open the issue or the PR here, it is
the address that gets read.

## Licence

MIT. Data served by the API carries per-source redistribution terms — see
<https://pokemontcgapi.com/legal/attribution>.
