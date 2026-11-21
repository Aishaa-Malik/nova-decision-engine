# NOVA Customer Engagement Decision Engine

A small backend service that answers one question:

> **Should we contact this customer now? If yes, through which channel, and why?**

It accepts customer activity events from any channel, keeps an ordered history per customer, detects abandoned carts and checkouts, runs a list of business rules, picks a channel, and records every decision with a plain-language reason.

- **Language:** JavaScript (Node.js 20+, ES modules)
- **Dependencies:** none. It uses Node's built-in `http` server and the built-in `node:test` runner.
- **Storage:** in-memory, behind a store interface that can be swapped for a database.

---

## How to run

```bash
# Node 20 or newer
cd nova-decision-engine

npm test        # run all automated tests (29 tests)
npm run demo    # command-line demo of the example scenarios
npm start       # start the REST API on http://localhost:3000 (PORT env var to change)
```

### API

| Method | Path | What it does |
|---|---|---|
| `POST` | `/events` | Ingest one event (object) or many (array) |
| `POST` | `/decisions` | Ask for a decision: `{ "customer_id", "at"?, "request_id"? }` |
| `GET` | `/customers/:id/events` | Activity history, ordered by event time |
| `GET` | `/customers/:id/decisions` | Past decisions with reasons and rule checks |
| `GET` | `/health` | Health check |

Example session (the scenario from the brief):

```bash
curl -s -X POST localhost:3000/events -H 'Content-Type: application/json' -d '{
  "event_id": "EVT-1", "customer_id": "CUST-101", "event_type": "ADDED_TO_CART",
  "timestamp": "2026-11-17T10:00:00Z", "channel": "WEBSITE",
  "metadata": { "cart_id": "CART-1", "product_id": "SKU-9" }
}'

curl -s -X POST localhost:3000/decisions -H 'Content-Type: application/json' \
  -d '{ "customer_id": "CUST-101", "at": "2026-11-17T10:35:00Z" }'
```

Response (shortened):

```json
{
  "decision_id": "DEC-00001",
  "customer_id": "CUST-101",
  "decision": "SEND",
  "channel": "WHATSAPP",
  "reason": "Cart CART-1 has been abandoned for 35 minutes (more than 30). The customer has valid consent for WHATSAPP, and no purchase, reply or recent follow-up was found.",
  "decided_by_rule": "ALL_RULES_PASSED",
  "cart_id": "CART-1",
  "checks": [
    { "rule": "CART_ACTIVITY", "result": "PASS" },
    { "rule": "PURCHASE_SUPPRESSION", "result": "PASS" },
    "..."
  ]
}
```

Status codes for `POST /events`: `201` accepted, `200` duplicate (ignored), `400` invalid, `409` same `event_id` with different content. A batch returns `207` with a result per event.

### Seeded customers (`src/profiles.seed.js`)

| Customer | Consent | Consented channels | Available | Preferred | Used to show |
|---|---|---|---|---|---|
| CUST-101 | yes | WhatsApp, Email | WhatsApp, Email | WhatsApp | Normal path |
| CUST-102 | yes | Email | WhatsApp, Email | Email | No WhatsApp consent → Email |
| CUST-103 | yes | WhatsApp, Email | Email | WhatsApp | Preferred channel down → fallback |
| CUST-104 | yes | WhatsApp | Email | WhatsApp | No eligible channel |
| CUST-105 | no | — | WhatsApp, Email | — | No promotional consent |

---

## Architecture

```
            POST /events                        POST /decisions
                 │                                    │
                 ▼                                    ▼
        ┌─────────────────┐               ┌──────────────────────┐
        │  validation.js  │               │      engine.js       │
        │ normalise event │               │  decide(customer)    │
        └────────┬────────┘               └──────────┬───────────┘
                 │ de-dup by event_id                │ 1. build snapshot
                 ▼                                   ▼
        ┌─────────────────┐  read history  ┌──────────────────────┐
        │    store.js     │ ─────────────► │     context.js       │
        │ events (sorted  │                │ carts, purchase,     │
        │ by timestamp),  │                │ opt-out, reply,      │
        │ profiles,       │ ◄───────────── │ previous follow-ups  │
        │ decisions       │  save decision └──────────┬───────────┘
        └─────────────────┘                           │ 2. run rules in order
                                                      ▼
                                           ┌──────────────────────┐
                                           │      rules.js        │
                                           │ first rule that says │
                                           │ SUPPRESS/DEFER wins; │
                                           │ all pass → SEND      │
                                           │ (channels.js picks   │
                                           │  the channel)        │
                                           └──────────────────────┘
```

| File | Responsibility |
|---|---|
| `src/constants.js` | Event types, channels, decision values, default settings (30 min, 24 h, 1 per window) |
| `src/validation.js` | Checks and normalises events; timestamps become epoch ms |
| `src/store.js` | In-memory store. Keeps each customer's events **sorted by event time**, de-dups by `event_id`, records decisions |
| `src/context.js` | Builds a read-only snapshot for one customer at one moment: target cart, linked purchase, opt-out, reply, previous follow-ups |
| `src/rules.js` | One small object per business rule, plus the ordered default list |
| `src/channels.js` | Channel selection: preferred first, then priority list; must be consented **and** available |
| `src/engine.js` | Ingests events, runs the rules, records decisions, handles idempotency |
| `src/server.js` | REST API (Node `http`) |
| `src/cli.js` | Command-line demo |

### The rule pipeline

Each rule has the same shape: `{ name, evaluate(ctx) }`. It returns `null` to pass, or `{ decision, reason }` to stop. Rules run in this order:

| # | Rule | Outcome if it fires |
|---|---|---|
| 1 | `CART_ACTIVITY`: is there a cart/checkout at all? | SUPPRESS |
| 2 | `PURCHASE_SUPPRESSION`: same `cart_id` purchased | SUPPRESS (converted) |
| 3 | `OPT_OUT_SUPPRESSION`: unsubscribed, no consent, or no profile | SUPPRESS |
| 4 | `ONE_FOLLOWUP_PER_CART`: this cart was already followed up | SUPPRESS |
| 5 | `REPLY_SUPPRESSION`: customer replied after the cart was last active | SUPPRESS |
| 6 | `ABANDONMENT_WINDOW`: less than 30 min since last cart activity | DEFER (+ `retry_after`) |
| 7 | `FREQUENCY_CAP`: a follow-up in the last rolling 24 h | SUPPRESS (+ `next_eligible_at`) |
| 8 | `CHANNEL_SELECTION`: no consented and available channel | SUPPRESS |
| — | All passed | **SEND** on the selected channel |

The order is deliberate. **Permanent** reasons (converted, opted out, already sent) come first, so the answer never says "ask again later" for a cart that will never qualify. Then "not yet" (the window). Then the rolling cap. Picking a channel comes last, because it only matters if we are going to send.

Adding a rule means writing one more object and putting it in the list. A test (`rules are pluggable`) adds a "quiet hours" rule this way without touching the engine.

---

## Assumptions and key decisions

1. **Decision time (`at`).** A decision request may pass `at`; otherwise the engine uses the clock. Only events with `timestamp <= at` are considered. This makes decisions reproducible and testable, and it is what makes out-of-order events work.
2. **Event time, not arrival time.** History is kept sorted by `timestamp`. A purchase that arrives before its add-to-cart event is still linked correctly.
3. **Which cart is evaluated.** The **most recently active cart** (latest `ADDED_TO_CART` or `CHECKOUT_STARTED`). New cart activity supersedes older carts, so we never nag about an older cart while the customer is shopping again.
4. **When a cart is abandoned.** 30 minutes after its **last** activity. `CHECKOUT_STARTED` on the same cart resets the clock.
5. **Purchase association.** As the brief says: `PURCHASE_COMPLETED` with the same `metadata.cart_id`. A purchase of a different cart does not suppress.
6. **Reply suppression** only counts replies **after** the cart's last activity. An older reply (from a previous conversation) does not block a new follow-up.
7. **Opt-out.** An `UNSUBSCRIBED` event, a profile without `promotional_consent`, or a missing profile all suppress. There is no re-subscribe event in scope.
8. **DEFER vs SUPPRESS.** Before 30 minutes the answer is `DEFER` with `retry_after`: "not yet, ask again". `SUPPRESS` means "do not send for this reason".
9. **What counts as a follow-up.** Our own `SEND` decisions count immediately: a SEND **reserves** the slot, so two quick requests can't both send. `FOLLOWUP_SENT` events from other systems also count. If a `FOLLOWUP_SENT` carries `metadata.decision_id` of one of our decisions, it is the same follow-up and is counted once.
10. **One follow-up per cart.** Even after the 24-hour cap expires, the same cart is not followed up twice. (This is a product choice; it is one rule and easy to remove.)
11. **Channels.** `WEBSITE` is inbound only, so it is never selected for outbound messages. Order: the profile's `preferred_channel`, then WhatsApp → Email → Voice.
12. **Duplicates.** Same `event_id` and same content → ignored (`DUPLICATE`). Same `event_id` with different content → rejected (`409`), because it signals a bug upstream. Decision requests can send a `request_id`; repeating it returns the stored decision instead of creating a new one.
13. **Validation.** Cart and purchase events must include `metadata.cart_id`.
14. **Every decision is stored** (SEND, SUPPRESS and DEFER) with the rule that decided it, the reason, and the list of checks run. That gives a full audit trail.

---

## Tests

`npm test` runs 29 tests with Node's built-in runner.

**Required scenarios** (`test/scenarios.test.js`):

| # | Scenario | Result |
|---|---|---|
| 1 | Cart, decision after 30 min | SEND via WhatsApp |
| 2 | Decision before 30 min | DEFER with `retry_after` |
| 3 | Same cart purchased first | SUPPRESS (converted) |
| 4 | Unsubscribed first | SUPPRESS |
| 5 | Replied after abandoning | SUPPRESS |
| 6 | Same event twice | Stored once; only one SEND ever |
| 7 | Events out of order | Decision follows timestamps |
| 8 | Email consent only | SEND via Email |
| 9 | Follow-up in the last 24 h | SUPPRESS with `next_eligible_at` |
| 10 | No consented channel available | SUPPRESS with per-channel reason |

**Extra scenarios:** preferred channel down → fallback; checkout resets the clock; purchase of another cart does not suppress; old reply does not suppress; late-arriving purchase after a DEFER; events after decision time ignored; cap expires after 24 h; `FOLLOWUP_SENT` for our own decision counted once; conflicting duplicate rejected; `request_id` idempotency; no consent; no cart; invalid events; pluggable rule; explanation lists all checks.

**API tests** (`test/api.test.js`) start the HTTP server on a random port and check status codes, batch ingestion, duplicates and conflicts end to end.

---

## Design for change

The current design is a **modular monolith**. Each of the following changes touches one module rather than the whole system.

### 10,000 events per second
- **Separate ingestion from decisions.** `POST /events` only validates and appends to a durable log (Kafka, Kinesis or Pub/Sub), then returns. Writing to a log is cheap and absorbs bursts.
- **Partition by `customer_id`.** All events for one customer land in the same partition, so one consumer sees them in order and no cross-customer coordination is needed. Consumers scale horizontally with the partition count.
- **Store:** replace `InMemoryStore` with a database. Postgres with `events (event_id PK, customer_id, ts, …)` and an index on `(customer_id, ts)` works well into the thousands of writes per second. Beyond that, a wide-column store (DynamoDB or Cassandra, partition key `customer_id`, sort key `ts`).
- **Keep decisions cheap.** Today a decision reads the customer's whole history. At scale, keep a small **per-customer state row** (open carts, last purchase per cart, unsubscribed flag, last reply time, recent follow-up times) updated by the consumer. The rules read that row instead of replaying history. `context.js` is the only place that changes.
- **Trade-off:** more moving parts and eventual consistency between "event accepted" and "state updated". Accepted, because the decision only needs to be correct a few seconds later, not instantly.

### Duplicate or late events
- **Duplicates:** the unique `event_id` key already makes ingestion idempotent. In a database that becomes `INSERT … ON CONFLICT (event_id) DO NOTHING`.
- **Late events:** rules already use event time, not arrival time, so a late purchase or reply is honoured by any decision made after it arrives (tested).
- **The real risk is a late event after we already sent.** Mitigations:
  1. Don't decide at exactly 30 minutes. Schedule the check at 30 minutes plus a small **grace period** (for example 2–5 minutes, sized to observed lateness), so most late events arrive first.
  2. **Re-check just before sending.** The sender asks the engine again (or checks a version number) right before calling the provider.
  3. Accept that a very late event can't undo a message already sent. Record it, and measure how often it happens.
- **Trade-off:** the grace period delays every follow-up a little in exchange for fewer wrong messages.

### Asynchronous decisions
- Today callers ask synchronously. In production, decisions should be **scheduled**: when `ADDED_TO_CART` arrives, enqueue a "check this cart" job with a delay of window + grace (SQS delay or visibility timeout, a delayed queue, or a scheduler table polled by workers).
- The worker calls `decide()` with the job's `request_id`. If the result is SEND, it writes an **outbox** row, and a separate sender delivers it and emits `FOLLOWUP_SENT` with the `decision_id`.
- A DEFER result re-enqueues the job for `retry_after`. Failed jobs go to a dead-letter queue.
- **Trade-off:** an outbox and retry logic add complexity, but they guarantee a decision is never lost and a message is never sent without a recorded decision.

### Multiple workers contacting the same customer
- The risk is two workers both deciding SEND before either records it (a race condition).
- **Partitioning by `customer_id`** means one consumer owns a customer at a time. This removes most races without any locks.
- **The database is the final guard.** Make "reserve a follow-up" an atomic step:
  - a **unique constraint** on `(customer_id, cart_id)` for one-per-cart, and
  - for the 24-hour cap, either a per-customer row updated with a **conditional write** (`UPDATE … SET last_followup_at = now WHERE last_followup_at < now - 24h`, success only if one row changed) or a transaction with `SELECT … FOR UPDATE` on the customer row.
- Only the worker whose reservation succeeds sends. The others get a SUPPRESS. In this repo the SEND decision already acts as that reservation, and Node's single thread makes it atomic in memory.
- **Trade-off:** a per-customer lock serialises work for one customer, which is fine because one customer produces little traffic.

### Different brands with different rules
- Rules and settings are already injected into `DecisionEngine` (`rules`, `settings`).
- Add a `brand_id` to events and profiles, and load a **per-brand config**: windows, caps, channel priority, and which rules are on. Start with config in a table or file, and add new behaviour as new rule objects.
- **Avoid** a general rules DSL until there's real demand. Code-defined rules plus per-brand parameters are easier to test and review.
- Record the **rule config version** on every decision so past decisions remain explainable after rules change.

### Additional channels
- Channels are a list plus a selector (`channels.js`). Adding SMS or push means adding it to `CHANNELS`/`OUTBOUND_CHANNELS` and the priority list.
- Real sending sits behind a **channel adapter** interface (`send(customer, message) → result`), one per provider, used by the sender worker, never by the decision engine. The engine only decides; delivery is a separate concern.
- Per-channel rules (for example, WhatsApp's 24-hour session window or voice-call hours) become additional rules or channel-eligibility checks.

---

## AI usage note

> **Edit this section so it accurately reflects how you used AI before submitting.**

- **Tools:** Claude Code (Anthropic).
- **Used for:** scaffolding the project structure, drafting the rule pipeline and the test scenarios, and drafting this README.
- **Reviewed / changed by me:** _describe what you checked, changed or rejected. For example: the rule ordering (permanent suppressions before DEFER), treating WEBSITE as inbound-only, the decision to count our own SEND decision as a reservation, and the wording of the design-for-change section._
