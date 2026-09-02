#!/usr/bin/env node
/**
 * Entry stdio.
 *
 * `serveStdio` riceve una FABBRICA e non un'istanza: nella v2 della libreria il
 * server e' senza sessione, e l'istanza viene fissata dall'apertura della
 * connessione. Passare un server gia' costruito e' il modo v1 di farlo, e qui
 * non funzionerebbe.
 *
 * Nessun `console.log` in questo processo, mai: su stdio quel canale E' il
 * protocollo, e una riga di log ci finisce dentro come frame malformato. La
 * diagnostica va su stderr.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';

const handle = serveStdio(() => createServer(), {
  onerror: (error) => {
    process.stderr.write(`[pokemontcgapi-mcp] ${error.message}\n`);
  },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void handle.close().finally(() => process.exit(0));
  });
}
