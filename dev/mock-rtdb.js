#!/usr/bin/env node
// Mock of the Firebase Realtime Database REST API, faithful enough to test
// No Gimmes' sync engine against: GET/PUT/PATCH/DELETE on /<path>.json plus
// SSE streaming (event: put/patch/keep-alive with paths relative to the
// stream location), CORS, and preflight — all in-memory, no dependencies.
//
//   node dev/mock-rtdb.js [port]        (default 8787)
//
// Not emulated: auth, rules, ETags/conditional writes, 307 stream redirects,
// server values other than {".sv":"timestamp"}, priorities, shallow queries.

const http = require('http');

const PORT = Number(process.argv[2] || process.env.PORT || 8787);
let root = null; // the whole database tree
const streams = new Set(); // {res, segs:[...]} active SSE clients

const segsOf = (urlPath) => urlPath.replace(/\.json$/, '').split('/').filter(Boolean).map(decodeURIComponent);

function getAt(segs) {
  let node = root;
  for (const s of segs) {
    if (node === null || typeof node !== 'object' || Array.isArray(node) === false && !(s in node)) {
      if (node !== null && typeof node === 'object' && s in node) continue;
      return null;
    }
    node = node[s];
    if (node === undefined) return null;
  }
  return node === undefined ? null : node;
}

function prune(node) {
  // Firebase deletes empty objects/nulls all the way up. Dense arrays are
  // returned as arrays by the real RTDB, so preserve them here too.
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    const a = node.map(prune);
    while (a.length && (a[a.length - 1] === null || a[a.length - 1] === undefined)) a.pop();
    return a.length ? a : null;
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    const p = prune(v);
    if (p !== null && p !== undefined) out[k] = p;
  }
  return Object.keys(out).length ? out : null;
}

function setAt(segs, value) {
  value = prune(resolveServerValues(value));
  if (segs.length === 0) { root = value; return; }
  if (root === null || typeof root !== 'object') root = {};
  let node = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    if (node[s] === null || node[s] === undefined || typeof node[s] !== 'object') node[s] = {};
    node = node[s];
  }
  const leaf = segs[segs.length - 1];
  if (value === null) delete node[leaf]; else node[leaf] = value;
  root = prune(root);
}

function resolveServerValues(v) {
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return Date.now();
    const out = Array.isArray(v) ? [] : {};
    for (const [k, x] of Object.entries(v)) out[k] = resolveServerValues(x);
    return out;
  }
  return v;
}

function relPath(streamSegs, eventSegs) {
  // Path of the event relative to the stream's location; null if outside it.
  for (let i = 0; i < streamSegs.length; i++) {
    if (eventSegs[i] !== streamSegs[i]) {
      // Event ABOVE the stream location still affects it (ancestor write).
      if (i === eventSegs.length) return '/'; // ancestor rewrote our subtree
      return null; // sibling branch — irrelevant
    }
  }
  return '/' + eventSegs.slice(streamSegs.length).join('/');
}

function broadcast(kind, eventSegs, dataForPatch) {
  for (const client of [...streams]) {
    let rel = relPath(client.segs, eventSegs);
    let ev = kind, payload;
    if (rel === null) continue;
    if (rel === '/' && eventSegs.length < client.segs.length) {
      // an ancestor was replaced: send the client its whole new subtree
      ev = 'put';
      payload = { path: '/', data: getAt(client.segs) };
    } else if (kind === 'patch') {
      payload = { path: rel, data: dataForPatch };
    } else {
      payload = { path: rel, data: getAt(eventSegs) };
    }
    try {
      client.res.write(`event: ${ev}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      streams.delete(client);
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 5e6) req.destroy(); });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, PATCH, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  const u = new URL(req.url, 'http://x');
  if (!u.pathname.endsWith('.json')) {
    res.writeHead(404, cors); return res.end('{"error":"expected .json path"}');
  }
  const segs = segsOf(u.pathname);

  if (req.method === 'GET' && (req.headers.accept || '').includes('text/event-stream')) {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const client = { res, segs };
    streams.add(client);
    res.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: getAt(segs) })}\n\n`);
    const ka = setInterval(() => {
      try { res.write('event: keep-alive\ndata: null\n\n'); } catch { /* closed */ }
    }, 25000);
    req.on('close', () => { clearInterval(ka); streams.delete(client); });
    return;
  }

  const json = (code, value) => {
    res.writeHead(code, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(value === undefined ? null : value));
  };

  try {
    if (req.method === 'GET') return json(200, getAt(segs));
    if (req.method === 'DELETE') { setAt(segs, null); broadcast('put', segs); return json(200, null); }

    const body = await readBody(req);
    let value;
    try { value = body === '' ? null : JSON.parse(body); } catch { return json(400, { error: 'Invalid data; couldn\'t parse JSON object' }); }

    if (req.method === 'PUT') { setAt(segs, value); broadcast('put', segs); return json(200, getAt(segs)); }
    if (req.method === 'PATCH') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return json(400, { error: 'PATCH requires an object' });
      const resolved = resolveServerValues(value);
      for (const [k, v] of Object.entries(resolved)) setAt([...segs, ...k.split('/').filter(Boolean)], v);
      broadcast('patch', segs, resolved);
      return json(200, resolved);
    }
    if (req.method === 'POST') {
      const key = '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      setAt([...segs, key], value); broadcast('put', [...segs, key]);
      return json(200, { name: key });
    }
    return json(405, { error: 'method not allowed' });
  } catch (e) {
    return json(500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, () => console.log(`mock-rtdb listening on http://127.0.0.1:${PORT} (data at /<path>.json)`));
