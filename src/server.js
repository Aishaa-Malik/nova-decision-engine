import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { DecisionEngine, ConflictError } from './engine.js';
import { ValidationError } from './validation.js';
import { SEED_PROFILES } from './profiles.seed.js';

export function createServer(engine) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);

      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { status: 'ok' });
      }

      if (req.method === 'POST' && url.pathname === '/events') {
        const body = await readJson(req);
        const items = Array.isArray(body) ? body : [body];
        const results = items.map((raw) => {
          try {
            const { status, event } = engine.ingestEvent(raw);
            return { event_id: event.event_id, status };
          } catch (err) {
            if (err instanceof ValidationError || err instanceof ConflictError) {
              return { event_id: raw?.event_id ?? null, status: 'REJECTED', error: err.message };
            }
            throw err;
          }
        });
        if (!Array.isArray(body)) {
          const r = results[0];
          const code = r.status === 'ACCEPTED' ? 201 : r.status === 'DUPLICATE' ? 200 : 400;
          const finalCode = r.error?.includes('different content') ? 409 : code;
          return send(res, finalCode, r);
        }
        return send(res, 207, { results });
      }

      if (req.method === 'POST' && url.pathname === '/decisions') {
        const body = await readJson(req);
        return send(res, 200, engine.decide(body));
      }

      if (req.method === 'GET' && parts[0] === 'customers' && parts.length === 3) {
        const customerId = decodeURIComponent(parts[1]);
        if (parts[2] === 'events') return send(res, 200, engine.getHistory(customerId));
        if (parts[2] === 'decisions') return send(res, 200, engine.getDecisions(customerId));
      }

      return send(res, 404, { error: 'Not found' });
    } catch (err) {
      if (err instanceof ValidationError || err instanceof SyntaxError) {
        return send(res, 400, { error: err.message });
      }
      if (err instanceof ConflictError) return send(res, 409, { error: err.message });
      console.error(err);
      return send(res, 500, { error: 'Internal error' });
    }
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) throw new ValidationError('Request body is required');
  return JSON.parse(text);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const engine = new DecisionEngine();
  engine.seedProfiles(SEED_PROFILES);
  const port = Number(process.env.PORT ?? 3000);
  createServer(engine).listen(port, () => {
    console.log(`Decision engine listening on http://localhost:${port}`);
    console.log(`Seeded customers: ${SEED_PROFILES.map((p) => p.customer_id).join(', ')}`);
  });
}
