# @pokemontcgapi/mcp

An [MCP](https://modelcontextprotocol.io) server for the Pokémon TCG API at
[pokemontcgapi.com](https://pokemontcgapi.com). It gives an agent eight tools over a
catalogue of **615 sets and 52,337 cards** — 379 Japanese sets, 176 international, 60 Simplified
Chinese — with card names in six languages, illustrators, images, and prices that carry their source,
basis, grade and sample size.

Unofficial. Not produced, endorsed, supported by or affiliated with Nintendo, Creatures Inc.,
GAME FREAK inc. or The Pokémon Company International. Pokémon and all related marks are trademarks of
their respective owners.

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

Environment: `PTCG_API_KEY` (optional today), `PTCG_BASE_URL` (defaults to
`https://api.pokemontcgapi.com`). Node ≥ 20.

## The tools

Eight tools, not one per endpoint. `tools/list` sits in the model's context on every turn, so the
whole surface is just over 9 KB, and each tool is shaped like a question rather than like a route —
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
| `ptcg_identify_card_from_image` | "Which card is this a photo of?" — ranked candidates, and an explicit refusal when reprints share the artwork. 25 credits a call |

Every tool is annotated `readOnlyHint: true` and `destructiveHint: false`. Nothing here writes.
`ptcg_identify_card_from_image` is the one marked `idempotentHint: false`, because the same photo costs
25 credits every time it is sent — a client must not retry it on its own.

## What this API does not have

The last tool exists because of this section, and it returns these facts from a live call rather
than leaving a model to infer them:

- **No Korean cards.** Zero `KR` sets and zero `ko` translations. The print region and the locale are
  modelled in the schema and carry no data, so filtering on them returns an empty result, not an error.
- **No card game text.** `attacks`, `abilities`, `weaknesses`, `resistances`, `subtypes`,
  `retreat_cost`, `rules`, `flavor_text` and `legalities` are empty for every card; `types` and
  `national_pokedex_numbers` are populated only on part of the Scarlet & Violet era. If the question
  is about what a card does in play, this API cannot answer it.

Both statements are measured, dated in the source, and repeated verbatim in the tool descriptions —
so an agent is told before it calls, not after.

## Reading prices correctly

There is no printing filter. First Edition, Unlimited, holofoil, reverse holofoil and graded rows all
come back together, so read `printing`, `condition` and `grading` on each row rather than taking the
first number. `basis` separates `GUIDE` (published upstream) from `DERIVED` (computed by us);
`PTCG_INDEX` is our own composite in EUR and carries `sample_n`. Every observation has an `as_of`
date and is delayed by at least a day — never quote a price without it.

## Context discipline

Results are capped at 50 rows regardless of what the API allows, sent as aligned tables rather than
JSON (about 40% fewer tokens, and models misread them less often), with a compact field projection.
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

Node >= 20. No test suite lives here yet: what CI enforces is that the package
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
