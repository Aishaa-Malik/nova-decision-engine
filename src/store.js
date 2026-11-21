export class InMemoryStore {
  constructor() {
    this.eventsById = new Map();
    this.eventsByCustomer = new Map();
    this.profiles = new Map();
    this.decisionsByCustomer = new Map();
    this.decisionSeq = 0;
  }

  getEvent(eventId) {
    return this.eventsById.get(eventId);
  }

  addEvent(event) {
    this.eventsById.set(event.event_id, event);
    const list = this.eventsByCustomer.get(event.customer_id) ?? [];
    let i = list.length;
    while (i > 0 && list[i - 1].timestamp > event.timestamp) i--;
    list.splice(i, 0, event);
    this.eventsByCustomer.set(event.customer_id, list);
  }

  getCustomerEvents(customerId) {
    return [...(this.eventsByCustomer.get(customerId) ?? [])];
  }

  upsertProfile(profile) {
    this.profiles.set(profile.customer_id, { ...profile });
  }

  getProfile(customerId) {
    const p = this.profiles.get(customerId);
    return p ? { ...p } : undefined;
  }

  addDecision(decision) {
    this.decisionSeq += 1;
    const saved = { decision_id: `DEC-${String(this.decisionSeq).padStart(5, '0')}`, ...decision };
    const list = this.decisionsByCustomer.get(decision.customer_id) ?? [];
    list.push(saved);
    this.decisionsByCustomer.set(decision.customer_id, list);
    return saved;
  }

  getDecisions(customerId) {
    return [...(this.decisionsByCustomer.get(customerId) ?? [])];
  }
}
