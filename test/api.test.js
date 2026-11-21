import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { newEngine, cart, at } from './helpers.js';

let server;
let base;

before(async () => {
  server = createServer(newEngine());
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('POST /events then POST /decisions returns the example decision', async () => {
  const e = cart('CUST-101', 0, 'CART-API');
  const r1 = await post('/events', e);
  assert.equal(r1.status, 201);
  const r2 = await post('/events', e);
  assert.equal(r2.status, 200);
  assert.equal((await r2.json()).status, 'DUPLICATE');

  const r3 = await post('/decisions', { customer_id: 'CUST-101', at: at(35) });
  assert.equal(r3.status, 200);
  const d = await r3.json();
  assert.equal(d.decision, 'SEND');
  assert.equal(d.channel, 'WHATSAPP');

  const history = await (await fetch(`${base}/customers/CUST-101/events`)).json();
  assert.equal(history.length, 1);
  const decisions = await (await fetch(`${base}/customers/CUST-101/decisions`)).json();
  assert.equal(decisions.length, 1);
});

test('batch POST /events reports each event', async () => {
  const good = cart('CUST-102', 0, 'CART-B');
  const r = await post('/events', [good, { event_id: 'BAD' }]);
  assert.equal(r.status, 207);
  const { results } = await r.json();
  assert.deepEqual(
    results.map((x) => x.status),
    ['ACCEPTED', 'REJECTED'],
  );
});

test('bad input returns 400, conflicting duplicate returns 409', async () => {
  assert.equal((await post('/events', { event_id: 'X' })).status, 400);
  assert.equal((await post('/decisions', {})).status, 400);

  const e = cart('CUST-103', 0, 'CART-C');
  await post('/events', e);
  const r = await post('/events', { ...e, timestamp: at(9) });
  assert.equal(r.status, 409);
});
