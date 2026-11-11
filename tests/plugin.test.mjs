// I manifest dei plugin (Claude e Cursor) lanciano il pacchetto npm a una
// versione esatta: le directory rifiutano un npx senza pin. Un rilascio che
// alza package.json e dimentica i manifest pubblicherebbe un plugin che
// installa la versione vecchia, e nessuno se ne accorgerebbe.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

const pkg = read('package.json');
const pinned = `${pkg.name}@${pkg.version}`;

test('il plugin Claude lancia la versione di package.json', () => {
  const manifest = read('.claude-plugin/plugin.json');
  assert.equal(manifest.version, pkg.version);
  const server = manifest.mcpServers.pokemontcgapi;
  assert.deepEqual(server.args, ['-y', pinned]);
  // La chiave arriva dal campo sensibile del plugin, mai dall'ambiente di chi installa.
  assert.equal(server.env.PTCG_API_KEY, '${user_config.api_key}');
  assert.equal(manifest.userConfig.api_key.sensitive, true);
});

test('il plugin Cursor lancia la versione di package.json', () => {
  const manifest = read('.cursor-plugin/plugin.json');
  assert.equal(manifest.version, pkg.version);
  const server = read('mcp.json').mcpServers.pokemontcgapi;
  assert.deepEqual(server.args, ['-y', pinned]);
  // Ogni ${VAR} di mcp.json deve essere dichiarata nel manifest.
  for (const value of Object.values(server.env)) {
    const name = /^\$\{(\w+)\}$/.exec(value)?.[1];
    assert.ok(name && manifest.variables.properties[name], `variabile non dichiarata: ${value}`);
  }
});
