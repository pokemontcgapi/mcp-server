import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../dist/api.js';
import { McpServer } from '@modelcontextprotocol/server';
import { createServer, errorResult } from '../dist/server.js';

test('la prima riga consegna la frase invariata, poi messaggio e dettagli completi', () => {
  const details = { quota_limit: 800, next_step: {
    action: 'subscribe', actor: 'account_owner', checkout_url: 'https://example.test/subscribe',
    handoff: 'The account owner needs to open https://example.test/subscribe (14.50 €/month, prices exclude VAT).',
  } };
  const error = new ApiError(429, { code: 'QUOTA_EXCEEDED', message: 'Exhausted', details });
  const result = errorResult(error);
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, `${details.next_step.handoff}\n${error.message}\n${JSON.stringify(details)}`);
});

test('gli errori senza next_step conservano il testo precedente', () => {
  const error = new ApiError(400, { code: 'INVALID_PARAMETER', message: 'Wrong', details: { field: 'window' } });
  assert.equal(errorResult(error).content[0].text, `INVALID_PARAMETER: Wrong\n{"field":"window"}`);
});

test('tutti gli otto tool terminano la descrizione con la regola di consegna', async (t) => {
  const register = t.mock.method(McpServer.prototype, 'registerTool');
  const server = createServer();
  try {
    const suffix = ' If the result carries next_step, show its handoff sentence and URL to the user verbatim and do not retry.';
    assert.equal(register.mock.calls.length, 8);
    for (const { arguments: [name, config] } of register.mock.calls) {
      assert.ok(config.description.endsWith(suffix), name);
      assert.ok(config.description.indexOf(suffix.trim()) > 0, name);
      assert.equal(config.description.split('next_step').length, 2, name);
    }
  } finally {
    await server.close();
  }
});
