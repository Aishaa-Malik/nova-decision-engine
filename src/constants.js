export const EVENT_TYPES = Object.freeze({
  PRODUCT_VIEWED: 'PRODUCT_VIEWED',
  CHAT_STARTED: 'CHAT_STARTED',
  ADDED_TO_CART: 'ADDED_TO_CART',
  CHECKOUT_STARTED: 'CHECKOUT_STARTED',
  PURCHASE_COMPLETED: 'PURCHASE_COMPLETED',
  MESSAGE_REPLIED: 'MESSAGE_REPLIED',
  UNSUBSCRIBED: 'UNSUBSCRIBED',
  FOLLOWUP_SENT: 'FOLLOWUP_SENT',
});

export const CHANNELS = Object.freeze(['WEBSITE', 'WHATSAPP', 'EMAIL', 'VOICE']);

export const OUTBOUND_CHANNELS = Object.freeze(['WHATSAPP', 'EMAIL', 'VOICE']);

export const DECISIONS = Object.freeze({
  SEND: 'SEND',
  SUPPRESS: 'SUPPRESS',
  DEFER: 'DEFER',
});

export const CART_ACTIVITY_EVENTS = Object.freeze([
  EVENT_TYPES.ADDED_TO_CART,
  EVENT_TYPES.CHECKOUT_STARTED,
]);

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;

export const DEFAULT_SETTINGS = Object.freeze({
  abandonmentWindowMs: 30 * MINUTE,
  frequencyCapWindowMs: 24 * HOUR,
  maxFollowupsPerWindow: 1,
  defaultChannelPriority: ['WHATSAPP', 'EMAIL', 'VOICE'],
});
