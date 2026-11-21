import { DecisionEngine } from './engine.js';
import { SEED_PROFILES } from './profiles.seed.js';

const engine = new DecisionEngine();
engine.seedProfiles(SEED_PROFILES);

const day = '2026-11-17';
const t = (hhmm) => `${day}T${hhmm}:00.000Z`;

function show(title, decision) {
  console.log(`\n=== ${title}`);
  console.log(
    JSON.stringify(
      {
        customer_id: decision.customer_id,
        decision: decision.decision,
        channel: decision.channel,
        reason: decision.reason,
        ...(decision.retry_after ? { retry_after: decision.retry_after } : {}),
      },
      null,
      2,
    ),
  );
}

engine.ingestEvent({
  event_id: 'EVT-1',
  customer_id: 'CUST-101',
  event_type: 'ADDED_TO_CART',
  timestamp: t('10:00'),
  channel: 'WEBSITE',
  metadata: { cart_id: 'CART-1', product_id: 'SKU-9' },
});
show('CUST-101 asked at 10:20 (too early)', engine.decide({ customer_id: 'CUST-101', at: t('10:20') }));
show('CUST-101 asked at 10:35', engine.decide({ customer_id: 'CUST-101', at: t('10:35') }));
show('CUST-101 asked again at 10:40', engine.decide({ customer_id: 'CUST-101', at: t('10:40') }));

engine.ingestEvent({
  event_id: 'EVT-2',
  customer_id: 'CUST-102',
  event_type: 'ADDED_TO_CART',
  timestamp: t('10:00'),
  channel: 'WEBSITE',
  metadata: { cart_id: 'CART-2' },
});
engine.ingestEvent({
  event_id: 'EVT-3',
  customer_id: 'CUST-102',
  event_type: 'PURCHASE_COMPLETED',
  timestamp: t('10:25'),
  channel: 'WEBSITE',
  metadata: { cart_id: 'CART-2' },
});
show('CUST-102 purchased the cart at 10:25', engine.decide({ customer_id: 'CUST-102', at: t('10:35') }));

engine.ingestEvent({
  event_id: 'EVT-4',
  customer_id: 'CUST-103',
  event_type: 'CHECKOUT_STARTED',
  timestamp: t('10:00'),
  channel: 'WHATSAPP',
  metadata: { cart_id: 'CART-3' },
});
show('CUST-103 WhatsApp unavailable', engine.decide({ customer_id: 'CUST-103', at: t('11:00') }));

engine.ingestEvent({
  event_id: 'EVT-5',
  customer_id: 'CUST-104',
  event_type: 'ADDED_TO_CART',
  timestamp: t('10:00'),
  channel: 'WEBSITE',
  metadata: { cart_id: 'CART-4' },
});
show('CUST-104 no eligible channel', engine.decide({ customer_id: 'CUST-104', at: t('11:00') }));
