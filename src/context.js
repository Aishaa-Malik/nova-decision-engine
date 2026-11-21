import { EVENT_TYPES, CART_ACTIVITY_EVENTS, DECISIONS } from './constants.js';

export function buildContext({ customerId, now, events, profile, decisions, settings }) {
  const visible = events.filter((e) => e.timestamp <= now);
  const carts = new Map();
  for (const e of visible) {
    if (!CART_ACTIVITY_EVENTS.includes(e.event_type)) continue;
    const id = e.metadata.cart_id;
    const cart = carts.get(id) ?? { cart_id: id, first_activity_at: e.timestamp };
    cart.last_activity_at = e.timestamp;
    cart.last_activity_type = e.event_type;
    cart.last_activity_event_id = e.event_id;
    carts.set(id, cart);
  }
  let targetCart = null;
  for (const cart of carts.values()) {
    if (!targetCart || cart.last_activity_at >= targetCart.last_activity_at) targetCart = cart;
  }
  const purchase = targetCart
    ? visible.find(
        (e) =>
          e.event_type === EVENT_TYPES.PURCHASE_COMPLETED &&
          e.metadata.cart_id === targetCart.cart_id,
      ) ?? null
    : null;
  const unsubscribe =
    visible.find((e) => e.event_type === EVENT_TYPES.UNSUBSCRIBED) ?? null;
  const replyAfterAbandonment = targetCart
    ? visible.find(
        (e) =>
          e.event_type === EVENT_TYPES.MESSAGE_REPLIED &&
          e.timestamp > targetCart.last_activity_at,
      ) ?? null
    : null;
  const sendDecisions = decisions.filter(
    (d) => d.decision === DECISIONS.SEND && d.decided_at <= now,
  );
  const ourDecisionIds = new Set(sendDecisions.map((d) => d.decision_id));
  const followups = [
    ...sendDecisions.map((d) => ({
      source: 'DECISION',
      id: d.decision_id,
      at: d.decided_at,
      cart_id: d.cart_id,
      channel: d.channel,
    })),
    ...visible
      .filter(
        (e) =>
          e.event_type === EVENT_TYPES.FOLLOWUP_SENT &&
          !ourDecisionIds.has(e.metadata.decision_id),
      )
      .map((e) => ({
        source: 'EVENT',
        id: e.event_id,
        at: e.timestamp,
        cart_id: e.metadata.cart_id ?? null,
        channel: e.channel,
      })),
  ].sort((a, b) => a.at - b.at);
  return {
    customerId,
    now,
    settings,
    profile,
    events: visible,
    carts,
    targetCart,
    purchase,
    unsubscribe,
    replyAfterAbandonment,
    followups,
  };
}
