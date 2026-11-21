import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newEngine, event, cart, at } from './helpers.js';
import { DecisionEngine, ConflictError } from '../src/engine.js';
import { ValidationError } from '../src/validation.js';

describe('Required scenarios', () => {
  test('1. cart abandoned for 30+ minutes -> SEND', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-101', 0));
    const d = engine.decide({ customer_id: 'CUST-101', at: at(35) });
    assert.equal(d.decision, 'SEND');
    assert.equal(d.channel, 'WHATSAPP');
    assert.match(d.reason, /abandoned for 35 minutes/);
  });

  test('2. decision before 30 minutes -> DEFER (not sent)', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-101', 0));
    const d = engine.decide({ customer_id: 'CUST-101', at: at(20) });
    assert.equal(d.decision, 'DEFER');
    assert.equal(d.channel, null);
    assert.equal(d.retry_after, at(30));
  });

  test('3. same cart purchased before the decision -> SUPPRESS', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-101', 0, 'CART-1'));
    engine.ingestEvent(
      event('CUST-101', 'PURCHASE_COMPLETED', 25, { metadata: { cart_id: 'CART-1' } }),
    );
    const d = engine.decide({ customer_id: 'CUST-101', at: at(35) });
    assert.equal(d.decision, 'SUPPRESS');
    assert.equal(d.decided_by_rule, 'PURCHASE_SUPPRESSION');
    assert.match(d.reason, /converted/);
  });

  test('4. customer unsubscribed before the decision -> SUPPRESS', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-101', 0));
    engine.ingestEvent(event('CUST-101', 'UNSUBSCRIBED', 10, { channel: 'EMAIL' }));
    const d = engine.decide({ customer_id: 'CUST-101', at: at(35) });
    assert.equal(d.decision, 'SUPPRESS');
    assert.equal(d.decided_by_rule, 'OPT_OUT_SUPPRESSION');
  });

  test('5. customer replied after abandoning the cart -> SUPPRESS', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-101', 0));
    engine.ingestEvent(event('CUST-101', 'MESSAGE_REPLIED', 15, { channel: 'WHATSAPP' }));
    const d = engine.decide({ customer_id: 'CUST-101', at: at(35) });
    assert.equal(d.decision, 'SUPPRESS');
    assert.equal(d.decided_by_rule, 'REPLY_SUPPRESSION');
  });

  test('6. same event submitted twice -> processed once, no duplicate follow-up', () => {
    const engine = newEngine();
    const e = cart('CUST-101', 0);
    assert.equal(engine.ingestEvent(e).status, 'ACCEPTED');
    assert.equal(engine.ingestEvent({ ...e }).status, 'DUPLICATE');
    assert.equal(engine.getHistory('CUST-101').length, 1);

    const first = engine.decide({ customer_id: 'CUST-101', at: at(35) });
    assert.equal(first.decision, 'SEND');
    engine.ingestEvent({ ...e });
    const second = engine.decide({ customer_id: 'CUST-101', at: at(36) });
    assert.equal(second.decision, 'SUPPRESS');
    assert.equal(second.decided_by_rule, 'ONE_FOLLOWUP_PER_CART');
    const sends = engine.getDecisions('CUST-101').filter((d) => d.decision === 'SEND');
    assert.equal(sends.length, 1);
  });

  test('7. events arriving out of order -> decision follows timestamps', () => {
    const engine = newEngine();
    engine.ingestEvent(
      event('CUST-101', 'PURCHASE_COMPLETED', 25, { metadata: { cart_id: 'CART-1' } }),
    );
    engine.ingestEvent(cart('CUST-101', 0, 'CART-1'));
    const history = engine.getHistory('CUST-101').map((e) => e.event_type);
    assert.deepEqual(history, ['ADDED_TO_CART', 'PURCHASE_COMPLETED']);
    const d = engine.decide({ customer_id: 'CUST-101', at: at(35) });
    assert.equal(d.decision, 'SUPPRESS');
    assert.equal(d.decided_by_rule, 'PURCHASE_SUPPRESSION');
  });

  test('8. no WhatsApp consent but email consent -> EMAIL', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-102', 0));
    const d = engine.decide({ customer_id: 'CUST-102', at: at(40) });
    assert.equal(d.decision, 'SEND');
    assert.equal(d.channel, 'EMAIL');
  });

  test('9. follow-up already sent in the last 24 hours -> SUPPRESS', () => {
    const engine = newEngine();
    engine.ingestEvent(
      event('CUST-101', 'FOLLOWUP_SENT', -120, {
        channel: 'WHATSAPP',
        metadata: { cart_id: 'CART-OLD' },
      }),
    );
    engine.ingestEvent(cart('CUST-101', 0, 'CART-NEW'));
    const d = engine.decide({ customer_id: 'CUST-101', at: at(35) });
    assert.equal(d.decision, 'SUPPRESS');
    assert.equal(d.decided_by_rule, 'FREQUENCY_CAP');
    assert.equal(d.next_eligible_at, at(-120 + 24 * 60));
  });

  test('10. no consented channel available -> SUPPRESS with reason', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-104', 0));
    const d = engine.decide({ customer_id: 'CUST-104', at: at(35) });
    assert.equal(d.decision, 'SUPPRESS');
    assert.equal(d.decided_by_rule, 'CHANNEL_SELECTION');
    assert.match(d.reason, /No eligible channel/);
    assert.match(d.reason, /WHATSAPP: not available/);
  });
});

describe('Extra scenarios', () => {
  test('preferred channel unavailable -> falls back to another eligible channel', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-103', 0));
    const d = engine.decide({ customer_id: 'CUST-103', at: at(35) });
    assert.equal(d.decision, 'SEND');
    assert.equal(d.channel, 'EMAIL');
    assert.deepEqual(
      d.channel_check.map((c) => [c.channel, c.why]),
      [
        ['WHATSAPP', 'not available'],
        ['EMAIL', 'consented and available'],
      ],
    );
  });

  test('checkout started later resets the abandonment clock', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-101', 0, 'CART-1'));
    engine.ingestEvent(
      event('CUST-101', 'CHECKOUT_STARTED', 20, { metadata: { cart_id: 'CART-1' } }),
    );
    const d = engine.decide({ customer_id: 'CUST-101', at: at(35) });
    assert.equal(d.decision, 'DEFER');
    assert.equal(d.retry_after, at(50));
  });

  test('purchase of a DIFFERENT cart does not suppress', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-101', 0, 'CART-1'));
    engine.ingestEvent(
      event('CUST-101', 'PURCHASE_COMPLETED', 5, { metadata: { cart_id: 'CART-OTHER' } }),
    );
    const d = engine.decide({ customer_id: 'CUST-101', at: at(35) });
    assert.equal(d.decision, 'SEND');
  });

  test('a reply BEFORE the cart was abandoned does not suppress', () => {
    const engine = newEngine();
    engine.ingestEvent(event('CUST-101', 'MESSAGE_REPLIED', -60, { channel: 'WHATSAPP' }));
    engine.ingestEvent(cart('CUST-101', 0));
    const d = engine.decide({ customer_id: 'CUST-101', at: at(35) });
    assert.equal(d.decision, 'SEND');
  });

  test('a late-arriving purchase stops a follow-up that was deferred', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-101', 0));
    assert.equal(engine.decide({ customer_id: 'CUST-101', at: at(10) }).decision, 'DEFER');
    engine.ingestEvent(
      event('CUST-101', 'PURCHASE_COMPLETED', 20, { metadata: { cart_id: 'CART-1' } }),
    );
    assert.equal(engine.decide({ customer_id: 'CUST-101', at: at(35) }).decision, 'SUPPRESS');
  });

  test('events after the decision time are ignored for that decision', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-101', 0));
    engine.ingestEvent(
      event('CUST-101', 'PURCHASE_COMPLETED', 50, { metadata: { cart_id: 'CART-1' } }),
    );
    assert.equal(engine.decide({ customer_id: 'CUST-101', at: at(35) }).decision, 'SEND');
  });

  test('frequency cap expires after 24 hours (new cart)', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-101', 0, 'CART-1'));
    assert.equal(engine.decide({ customer_id: 'CUST-101', at: at(35) }).decision, 'SEND');
    engine.ingestEvent(cart('CUST-101', 23 * 60, 'CART-2'));
    assert.equal(
      engine.decide({ customer_id: 'CUST-101', at: at(23 * 60 + 40) }).decision,
      'SUPPRESS',
    );
    engine.ingestEvent(cart('CUST-101', 25 * 60, 'CART-3'));
    const d = engine.decide({ customer_id: 'CUST-101', at: at(25 * 60 + 40) });
    assert.equal(d.decision, 'SEND');
  });

  test('FOLLOWUP_SENT that confirms our own decision is not counted twice', () => {
    const engine = newEngine({ settings: { maxFollowupsPerWindow: 2 } });
    engine.ingestEvent(cart('CUST-101', 0, 'CART-1'));
    const d1 = engine.decide({ customer_id: 'CUST-101', at: at(35) });
    engine.ingestEvent(
      event('CUST-101', 'FOLLOWUP_SENT', 36, {
        channel: 'WHATSAPP',
        metadata: { cart_id: 'CART-1', decision_id: d1.decision_id },
      }),
    );
    engine.ingestEvent(cart('CUST-101', 60, 'CART-2'));
    assert.equal(engine.decide({ customer_id: 'CUST-101', at: at(95) }).decision, 'SEND');
  });

  test('same event_id with different content is rejected', () => {
    const engine = newEngine();
    const e = cart('CUST-101', 0);
    engine.ingestEvent(e);
    assert.throws(
      () => engine.ingestEvent({ ...e, timestamp: at(5) }),
      ConflictError,
    );
  });

  test('same request_id returns the same decision (idempotent API calls)', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-101', 0));
    const a = engine.decide({ customer_id: 'CUST-101', at: at(35), request_id: 'REQ-1' });
    const b = engine.decide({ customer_id: 'CUST-101', at: at(35), request_id: 'REQ-1' });
    assert.equal(a.decision_id, b.decision_id);
    assert.equal(b.replayed, true);
    assert.equal(engine.getDecisions('CUST-101').length, 1);
  });

  test('customer with no promotional consent -> SUPPRESS', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-105', 0));
    const d = engine.decide({ customer_id: 'CUST-105', at: at(35) });
    assert.equal(d.decision, 'SUPPRESS');
    assert.match(d.reason, /not consented/);
  });

  test('no cart activity -> SUPPRESS (nothing to follow up)', () => {
    const engine = newEngine();
    engine.ingestEvent(event('CUST-101', 'PRODUCT_VIEWED', 0, { metadata: { product_id: 'P1' } }));
    const d = engine.decide({ customer_id: 'CUST-101', at: at(35) });
    assert.equal(d.decision, 'SUPPRESS');
    assert.equal(d.decided_by_rule, 'CART_ACTIVITY');
  });

  test('invalid events are rejected', () => {
    const engine = newEngine();
    assert.throws(() => engine.ingestEvent({ event_id: 'X' }), ValidationError);
    assert.throws(
      () => engine.ingestEvent({ ...cart('CUST-101', 0), channel: 'SMS' }),
      ValidationError,
    );
    assert.throws(
      () => engine.ingestEvent({ ...cart('CUST-101', 0), metadata: {} }),
      /requires metadata.cart_id/,
    );
  });

  test('rules are pluggable: a brand can add its own rule', () => {
    const quietHours = {
      name: 'QUIET_HOURS',
      evaluate: (ctx) =>
        new Date(ctx.now).getUTCHours() >= 22
          ? { decision: 'DEFER', reason: 'Quiet hours (22:00-08:00 UTC).' }
          : null,
    };
    const base = newEngine();
    const engine = new DecisionEngine({
      store: base.store,
      rules: [...base.rules.slice(0, -1), quietHours, base.rules.at(-1)],
      clock: base.clock,
    });
    engine.ingestEvent(cart('CUST-101', 12 * 60));
    const d = engine.decide({ customer_id: 'CUST-101', at: at(12 * 60 + 40) });
    assert.equal(d.decision, 'DEFER');
    assert.equal(d.decided_by_rule, 'QUIET_HOURS');
  });

  test('every decision lists the rules that were checked', () => {
    const engine = newEngine();
    engine.ingestEvent(cart('CUST-101', 0));
    const d = engine.decide({ customer_id: 'CUST-101', at: at(35) });
    assert.ok(d.checks.every((c) => c.result === 'PASS'));
    assert.equal(d.checks.length, 8);
  });
});
