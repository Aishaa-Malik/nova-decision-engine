import { EVENT_TYPES, CHANNELS } from './constants.js';

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const EVENT_TYPE_SET = new Set(Object.values(EVENT_TYPES));
const CHANNEL_SET = new Set(CHANNELS);

export function normaliseEvent(raw) {
  if (!raw || typeof raw !== 'object') throw new ValidationError('Event must be an object');
  const { event_id, customer_id, event_type, timestamp, channel, metadata } = raw;
  if (typeof event_id !== 'string' || !event_id.trim()) {
    throw new ValidationError('event_id is required');
  }
  if (typeof customer_id !== 'string' || !customer_id.trim()) {
    throw new ValidationError('customer_id is required');
  }
  if (!EVENT_TYPE_SET.has(event_type)) {
    throw new ValidationError(`event_type must be one of ${[...EVENT_TYPE_SET].join(', ')}`);
  }
  if (!CHANNEL_SET.has(channel)) {
    throw new ValidationError(`channel must be one of ${CHANNELS.join(', ')}`);
  }
  const ts = new Date(timestamp).getTime();
  if (timestamp === undefined || timestamp === null || Number.isNaN(ts)) {
    throw new ValidationError('timestamp must be a valid ISO-8601 date');
  }
  if (metadata !== undefined && (metadata === null || typeof metadata !== 'object')) {
    throw new ValidationError('metadata must be an object if provided');
  }
  const needsCart = [
    EVENT_TYPES.ADDED_TO_CART,
    EVENT_TYPES.CHECKOUT_STARTED,
    EVENT_TYPES.PURCHASE_COMPLETED,
  ].includes(event_type);
  if (needsCart && !metadata?.cart_id) {
    throw new ValidationError(`${event_type} requires metadata.cart_id`);
  }
  return {
    event_id: event_id.trim(),
    customer_id: customer_id.trim(),
    event_type,
    timestamp: ts,
    channel,
    metadata: { ...(metadata ?? {}) },
  };
}

export function parseDecisionTime(at, clock) {
  if (at === undefined || at === null || at === '') return clock.now();
  const ts = new Date(at).getTime();
  if (Number.isNaN(ts)) throw new ValidationError('at must be a valid ISO-8601 date');
  return ts;
}
