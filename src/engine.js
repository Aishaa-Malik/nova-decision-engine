import { DEFAULT_SETTINGS, DECISIONS } from './constants.js';
import { DEFAULT_RULES } from './rules.js';
import { buildContext } from './context.js';
import { normaliseEvent, parseDecisionTime, ValidationError } from './validation.js';
import { InMemoryStore } from './store.js';

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
  }
}

export const systemClock = { now: () => Date.now() };

export class DecisionEngine {
  constructor({ store, rules, settings, clock } = {}) {
    this.store = store ?? new InMemoryStore();
    this.rules = rules ?? DEFAULT_RULES;
    this.settings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
    this.clock = clock ?? systemClock;
    this.decisionsByRequestId = new Map();
  }

  seedProfiles(profiles) {
    for (const p of profiles) this.store.upsertProfile(p);
  }

  ingestEvent(raw) {
    const event = normaliseEvent(raw);
    const existing = this.store.getEvent(event.event_id);
    if (existing) {
      if (sameEvent(existing, event)) return { status: 'DUPLICATE', event: existing };
      throw new ConflictError(
        `event_id ${event.event_id} was already received with different content`,
      );
    }
    const stored = { ...event, received_at: this.clock.now() };
    this.store.addEvent(stored);
    return { status: 'ACCEPTED', event: stored };
  }

  decide({ customer_id, at, request_id } = {}) {
    if (typeof customer_id !== 'string' || !customer_id.trim()) {
      throw new ValidationError('customer_id is required');
    }
    if (request_id && this.decisionsByRequestId.has(request_id)) {
      return { ...this.decisionsByRequestId.get(request_id), replayed: true };
    }
    const now = parseDecisionTime(at, this.clock);
    const ctx = buildContext({
      customerId: customer_id,
      now,
      events: this.store.getCustomerEvents(customer_id),
      profile: this.store.getProfile(customer_id),
      decisions: this.store.getDecisions(customer_id),
      settings: this.settings,
    });
    const checks = [];
    let outcome = null;
    for (const rule of this.rules) {
      const result = rule.evaluate(ctx);
      checks.push({ rule: rule.name, result: result ? result.decision : 'PASS' });
      if (result) {
        outcome = { ...result, rule: rule.name };
        break;
      }
    }
    if (!outcome) {
      const idleMin = Math.round((now - ctx.targetCart.last_activity_at) / 60000);
      outcome = {
        decision: DECISIONS.SEND,
        channel: ctx.selectedChannel,
        rule: 'ALL_RULES_PASSED',
        reason:
          `Cart ${ctx.targetCart.cart_id} has been abandoned for ${idleMin} minutes (more than ` +
          `${Math.round(this.settings.abandonmentWindowMs / 60000)}). The customer has valid consent ` +
          `for ${ctx.selectedChannel}, and no purchase, reply or recent follow-up was found.`,
      };
    }
    const record = this.store.addDecision({
      customer_id,
      decision: outcome.decision,
      channel: outcome.channel ?? null,
      reason: outcome.reason,
      decided_by_rule: outcome.rule,
      cart_id: ctx.targetCart?.cart_id ?? null,
      decided_at: now,
      ...(outcome.retry_after ? { retry_after: outcome.retry_after } : {}),
      ...(outcome.next_eligible_at ? { next_eligible_at: outcome.next_eligible_at } : {}),
      checks,
      ...(ctx.channelCheck ? { channel_check: ctx.channelCheck } : {}),
      ...(request_id ? { request_id } : {}),
    });
    const response = toResponse(record);
    if (request_id) this.decisionsByRequestId.set(request_id, response);
    return response;
  }

  getHistory(customerId) {
    return this.store.getCustomerEvents(customerId).map(toEventResponse);
  }

  getDecisions(customerId) {
    return this.store.getDecisions(customerId).map(toResponse);
  }
}

function sameEvent(a, b) {
  return (
    a.customer_id === b.customer_id &&
    a.event_type === b.event_type &&
    a.timestamp === b.timestamp &&
    a.channel === b.channel &&
    JSON.stringify(sortKeys(a.metadata)) === JSON.stringify(sortKeys(b.metadata))
  );
}

function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([x], [y]) => x.localeCompare(y)));
}

function toResponse(d) {
  return { ...d, decided_at: new Date(d.decided_at).toISOString() };
}

function toEventResponse(e) {
  return {
    ...e,
    timestamp: new Date(e.timestamp).toISOString(),
    received_at: new Date(e.received_at).toISOString(),
  };
}
