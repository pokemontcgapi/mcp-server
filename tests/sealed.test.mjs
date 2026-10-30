import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/server';
import { createServer } from '../dist/server.js';

function fixture(name) {
  const publicPath = new URL(`./fixtures/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(existsSync(publicPath) ? publicPath : new URL(`../../fixtures/${name}.json`, import.meta.url), 'utf8'));
}

function toolCalls(t) {
  const register = t.mock.method(McpServer.prototype, 'registerTool');
  const server = createServer();
  return { server, calls: register.mock.calls.map(({ arguments: [name, config, handler] }) => ({ name, config, handler })) };
}

const product = (id, name, languages, extra = {}) => ({
  id, sku: id, slug: id, name, kind: 'BOOSTER_BOX', set_code: 'cn-sv8', set_name: 'Example', image_url: null,
  release_date: '2026-09-01', pack_count: 30, languages, index_eur: 128.5, last_price_at: '2026-10-29T00:00:00Z',
  created_at: '2026-10-30T00:00:00Z', updated_at: '2026-10-30T00:00:00Z', ...extra,
});

test('sigillati MCP: i due strumenti stanno nel registro e dichiarano i costi e la linea cinese', async (t) => {
  const { server, calls } = toolCalls(t);
  try {
    const names = calls.map((c) => c.name);
    assert.ok(names.includes('ptcg_search_sealed') && names.includes('ptcg_get_sealed_prices'));
    const search = calls.find((c) => c.name === 'ptcg_search_sealed').config;
    assert.match(search.description, /languages \["zh"\]/);
    assert.match(search.description, /2 credits each/);
    assert.equal(search.annotations.readOnlyHint, true);
    const prices = calls.find((c) => c.name === 'ptcg_get_sealed_prices').config;
    assert.match(prices.description, /3 credits/);
    assert.match(prices.description, /language the box is printed in/);
    assert.match(prices.description, /Never quote a price without its as_of date/);
  } finally {
    await server.close();
  }
});

test('sigillati MCP: il filtro di lingua scorre pagine da 100 con include=index e tiene solo le righe zh', async (t) => {
  const { server, calls } = toolCalls(t);
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = new URL(String(url));
    seen.push(u.pathname + u.search);
    const cursor = u.searchParams.get('cursor');
    if (cursor === null) {
      return Response.json({
        data: [product('en-box', 'English Box', ['en']), product('cn-box-1', 'Chinese Box 1', ['zh'])],
        meta: { limit: 100, count: 2, total_count: 3, has_more: true },
        links: { next: 'https://api.pokemontcgapi.com/v1/sealed?cursor=c2&include=index&limit=100' },
      });
    }
    assert.equal(cursor, 'c2');
    return Response.json({
      data: [product('cn-box-2', 'Chinese Box 2', ['zh'], { index_eur: null })],
      meta: { limit: 100, count: 1, total_count: 3, has_more: false },
    });
  });
  try {
    const handler = calls.find((c) => c.name === 'ptcg_search_sealed').handler;
    const result = await handler({ language: 'ZH', kind: 'booster_box', limit: 10 });
    assert.equal(seen[0], '/v1/sealed?kind=BOOSTER_BOX&limit=100&include=index');
    assert.equal(seen[1], '/v1/sealed?kind=BOOSTER_BOX&cursor=c2&limit=100&include=index');
    assert.deepEqual(result.structuredContent.products.map((p) => p.id), ['cn-box-1', 'cn-box-2']);
    assert.equal(result.structuredContent.complete, true);
    assert.match(result.content[0].text, /cn-box-1\s+Chinese Box 1\s+BOOSTER_BOX\s+cn-sv8\s+zh\s+2026-09-01\s+128\.5/);
    assert.doesNotMatch(result.content[0].text, /en-box/);
    assert.doesNotMatch(result.content[0].text, /More rows available/);

    // Senza lingua la pagina e' grande quanto il limite, e il cursore si consegna.
    seen.length = 0;
    const plain = await handler({ name: 'box', limit: 2 });
    assert.equal(seen[0], '/v1/sealed?q=box&limit=2&include=index');
    assert.equal(plain.structuredContent.products.length, 2);
    assert.equal(plain.structuredContent.complete, false);
    assert.match(plain.content[0].text, /More rows available\. Call again with cursor="c2"/);
  } finally {
    await server.close();
  }
});

test('sigillati MCP: i prezzi leggono prodotto e quotazioni, con indice, locale della scatola e trattenute del piano', async (t) => {
  const { server, calls } = toolCalls(t);
  const sample = fixture('prices-sealed-with-index');
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const u = new URL(String(url));
    seen.push(u.pathname);
    if (u.pathname.endsWith('/prices')) {
      return Response.json({ ...sample.body, meta: { ...sample.body.meta, withheld: ['non_english_locales'] } }, { headers: sample.headers });
    }
    return Response.json(product('cn-example-booster-box', 'Example Chinese Booster Box', ['zh']));
  });
  try {
    const handler = calls.find((c) => c.name === 'ptcg_get_sealed_prices').handler;
    const result = await handler({ id: 'cn-example-booster-box' });
    assert.deepEqual(seen, ['/v1/sealed/cn-example-booster-box', '/v1/sealed/cn-example-booster-box/prices']);
    const text = result.content[0].text;
    assert.match(text, /^Example Chinese Booster Box \(cn-example-booster-box\) — BOOSTER_BOX, set cn-sv8, languages zh; index 128\.5 EUR as of 2026-10-29/);
    assert.match(text, /CARDMARKET\s+LOW\s+ASKING\s+119\.9\s+EUR\s+zh\s+2026-10-29/);
    assert.match(text, /CARDMARKET\s+TREND\s+ASKING\s+128\.5\s+EUR\s+zh/);
    assert.match(text, /Withheld by the plan of this key, not missing from the catalogue: non_english_locales\./);
    assert.equal(result.structuredContent.product.languages[0], 'zh');
    assert.equal(result.structuredContent.index.eur, 128.5);
    assert.equal(result.structuredContent.prices.length, 2);
    assert.deepEqual(result.structuredContent.withheld, ['non_english_locales']);

    const usd = await handler({ id: 'cn-example-booster-box', currency: 'USD' });
    assert.equal(usd.structuredContent.prices.length, 0);
    assert.match(usd.content[0].text, /No rows\./);
  } finally {
    await server.close();
  }
});
