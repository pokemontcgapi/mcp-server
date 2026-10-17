import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/server';
import { createServer } from '../dist/server.js';

function fixture(name) {
  const publicPath = new URL(`./fixtures/centering-${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(existsSync(publicPath) ? publicPath : new URL(`../../fixtures/centering-${name}.json`, import.meta.url), 'utf8'));
}
function toolCalls(t) {
  const register = t.mock.method(McpServer.prototype, 'registerTool');
  const server = createServer();
  return {server, calls: register.mock.calls.map(({arguments: [name,config,handler]}) => ({name,config,handler}))};
}
test('centratura MCP: tre strumenti e nessuna attestazione confirm', async (t) => {
  const {server,calls} = toolCalls(t);
  try {
    const tools = calls.filter((c) => c.name.includes('centering'));
    assert.deepEqual(tools.map((c) => c.name), ['ptcg_measure_centering','ptcg_grade_centering','ptcg_get_centering_standards']);
    assert.equal(calls.some((c) => /confirm/.test(c.name)), false);
    assert.match(tools[0].config.description, /person checking or moving the lines in the app/);
    assert.match(tools[0].config.description, /needs-review/);
    for (const tool of tools) {
      assert.match(tool.config.description, /ceiling from centering alone, not a prediction of the final grade/);
      assert.match(tool.config.description, /Developer excluded/);
      assert.equal(tool.config.annotations.idempotentHint, false);
    }
  } finally { await server.close(); }
});
test('centratura MCP: multipart measure, JSON grade e query standards conservano dati e disclaimer', async (t) => {
  const {server,calls} = toolCalls(t);
  const recorded=[];
  t.mock.method(globalThis,'fetch',async (url,init) => {
    recorded.push({url:new URL(String(url)),init});
    const name = new URL(String(url)).pathname.split('/').at(-1);
    const sample = fixture(name);
    return Response.json(sample.body,{headers:sample.headers});
  });
  try {
    const corners=fixture('confirm-input').geometry.corners;
    const measure=await calls.find((c) => c.name==='ptcg_measure_centering').handler({image_base64:Buffer.from('synthetic').toString('base64'),face:'front',card_size:'standard',corners});
    assert.equal(measure.structuredContent.status,'needs-review');
    assert.equal(measure.structuredContent.ceilings,null);
    assert.deepEqual(measure.structuredContent.geometry,fixture('measure').body.data.geometry);
    assert.match(measure.content[0].text,/person must review/);
    const req=recorded[0];
    assert.equal(req.url.pathname,'/v1/centering/measure');
    assert.equal(req.init.method,'POST');
    assert.equal(new Headers(req.init.headers).has('content-type'),false);
    assert.equal(req.init.body.get('face'),'front');
    assert.equal(req.init.body.get('corners'),JSON.stringify(corners));
    assert.equal(req.init.body.get('image').name,'card');
    assert.equal(await req.init.body.get('image').text(),'synthetic');
    const ratios={front_lr:55,front_tb:52,house:'PSA'};
    const grade=await calls.find((c) => c.name==='ptcg_grade_centering').handler(ratios);
    assert.equal(recorded[1].url.pathname,'/v1/centering/grade');
    assert.equal(recorded[1].init.method,'POST');
    assert.equal(new Headers(recorded[1].init.headers).get('content-type'),'application/json');
    assert.deepEqual(JSON.parse(recorded[1].init.body),ratios);
    assert.deepEqual(grade.structuredContent,fixture('grade').body.data);
    assert.match(grade.content[0].text,/ceiling from centering alone, not a prediction of the final grade/);
    const standards=await calls.find((c) => c.name==='ptcg_get_centering_standards').handler({house:'PSA',face:'front'});
    assert.equal(recorded[2].url.pathname,'/v1/centering/standards');
    assert.equal(recorded[2].url.searchParams.get('house'),'PSA');
    assert.equal(recorded[2].url.searchParams.get('face'),'front');
    assert.deepEqual(standards.structuredContent,fixture('standards').body.data);
  } finally { await server.close(); }
});
test('centratura MCP: errore service_code e handoff non si perdono, POST senza retry', async (t) => {
  const {server,calls}=toolCalls(t);
  let requests=0;
  const details={service_code:'INVALID_RATIO',param:'front_lr'};
  t.mock.method(globalThis,'fetch',async () => {
    requests++;
    return Response.json({error:{code:'INVALID_PARAMETER',message:'Invalid ratio.',details}}, {status:400});
  });
  try {
    const result=await calls.find((c) => c.name==='ptcg_grade_centering').handler({front_lr:'invalid'});
    assert.equal(result.isError,true);
    assert.match(result.content[0].text,/INVALID_PARAMETER/);
    assert.ok(result.content[0].text.includes(JSON.stringify(details)));
    assert.equal(requests,1);
  } finally { await server.close(); }
});
