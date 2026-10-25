/* Small request/response helpers shared by the API functions. */

export function send(res, code, obj) {
  res.setHeader?.('cache-control', 'no-store');
  res.setHeader?.('content-type', 'application/json; charset=utf-8');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(code).json(obj);
    return;
  }
  res.statusCode = code;
  res.end(JSON.stringify(obj));
}

export function header(req, name) {
  return req.headers?.[name] ?? req.headers?.get?.(name) ?? null;
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
  if (typeof req.text === 'function') {
    const raw = await req.text();
    return raw ? JSON.parse(raw) : {};
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    return Object.fromEntries(new URL(req.url || '/', 'http://local').searchParams);
  } catch {
    return {};
  }
}

