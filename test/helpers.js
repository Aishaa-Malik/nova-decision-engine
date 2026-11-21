import { DecisionEngine } from '../src/engine.js';
import { SEED_PROFILES } from '../src/profiles.seed.js';

export const BASE = Date.parse('2026-11-17T10:00:00.000Z');
export const at = (minutesAfterBase) => new Date(BASE + minutesAfterBase * 60000).toISOString();

export function newEngine(opts = {}) {
  const engine = new DecisionEngine({ clock: { now: () => BASE }, ...opts });
  engine.seedProfiles(SEED_PROFILES);
  return engine;
}

let seq = 0;
export function event(customer_id, event_type, minute, extra = {}) {
  seq += 1;
  return {
    event_id: extra.event_id ?? `EVT-${seq}`,
    customer_id,
    event_type,
    timestamp: at(minute),
    channel: extra.channel ?? 'WEBSITE',
    metadata: extra.metadata ?? {},
  };
}

export const cart = (customer, minute, cart_id = 'CART-1', extra = {}) =>
  event(customer, 'ADDED_TO_CART', minute, { ...extra, metadata: { cart_id, ...(extra.metadata ?? {}) } });
