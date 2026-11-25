// web-service: small Node web service with a WebSocket uplink.
//
// Access control: the service syncs the authorized user list from the
// panel API (the same credentials the deployment already carries):
//   legacy mode:  APIHOST + APIKEY + NODEID
//                 GET {APIHOST}/api/v1/server/UniProxy/user
//   machine mode: PANEL_URL (or APIHOST) + MACHINE_TOKEN + MACHINE_ID + NODEID
//                 GET {PANEL_URL}/api/v2/server/user
// APP_KEY may hold one or more comma-separated UUIDs that are always
// accepted (static fallback). No secrets are stored in this repository.
const http = require('http');
const net = require('net');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const staticKeys = new Set(
  (process.env.APP_KEY || '')
    .split(',')
    .map((s) => s.trim().replace(/-/g, '').toLowerCase())
    .filter((s) => /^[0-9a-f]{32}$/.test(s))
);
let syncedKeys = new Set();
let userETag = '';

function panelRequest() {
  const base = (process.env.PANEL_URL || process.env.APIHOST || '').replace(/\/+$/, '');
  const nodeId = process.env.NODEID || '';
  if (!base || !nodeId) return null;
  if (process.env.MACHINE_TOKEN && process.env.MACHINE_ID) {
    const q = new URLSearchParams({
      token: process.env.MACHINE_TOKEN,
      machine_id: process.env.MACHINE_ID,
      node_id: nodeId,
    });
    return { url: `${base}/api/v2/server/user?${q}` };
  }
  if (process.env.APIKEY) {
    const q = new URLSearchParams({
      token: process.env.APIKEY,
      node_id: nodeId,
      node_type: process.env.NODE_TYPE || 'vless',
    });
    return { url: `${base}/api/v1/server/UniProxy/user?${q}` };
  }
  return null;
}

async function syncUsers() {
  const req = panelRequest();
  if (!req) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const headers = { 'User-Agent': 'web-service' };
    if (userETag) headers['If-None-Match'] = userETag;
    const resp = await fetch(req.url, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (resp.status === 304) return;
    if (!resp.ok) {
      console.log(`user sync failed: http ${resp.status}`);
      return;
    }
    const data = await resp.json();
    const users = Array.isArray(data.users) ? data.users : [];
    const next = new Set();
    for (const u of users) {
      const hex = String(u.uuid || '').replace(/-/g, '').toLowerCase();
      if (/^[0-9a-f]{32}$/.test(hex)) next.add(hex);
    }
    syncedKeys = next;
    userETag = resp.headers.get('etag') || '';
    console.log(`user sync ok: ${syncedKeys.size} users`);
  } catch (e) {
    console.log(`user sync failed: ${e.message}`);
  }
}

function isAuthorized(uuidHex) {
  return staticKeys.has(uuidHex) || syncedKeys.has(uuidHex);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html><head><title>web-service</title></head>' +
    '<body><h1>web-service</h1><p>Service is running.</p></body></html>');
});
const wss = new WebSocketServer({ server });

function parseHeader(buf) {
  if (buf.length < 24) return null;
  const version = buf[0];
  const uuid = buf.subarray(1, 17).toString('hex');
  let idx = 17;
  const optLen = buf[idx];
  idx += 1 + optLen;
  if (buf.length < idx + 4) return null;
  const command = buf[idx];
  idx += 1;
  const port = buf.readUInt16BE(idx);
  idx += 2;
  const atyp = buf[idx];
  idx += 1;
  let host;
  if (atyp === 1) {
    if (buf.length < idx + 4) return null;
    host = Array.from(buf.subarray(idx, idx + 4)).join('.');
    idx += 4;
  } else if (atyp === 2) {
    if (buf.length < idx + 1) return null;
    const len = buf[idx];
    idx += 1;
    if (buf.length < idx + len) return null;
    host = buf.subarray(idx, idx + len).toString();
    idx += len;
  } else if (atyp === 3) {
    if (buf.length < idx + 16) return null;
    const parts = [];
    for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(idx + i).toString(16));
    host = parts.join(':');
    idx += 16;
  } else {
    throw new Error('bad address type');
  }
  return { version, uuid, command, port, host, payload: buf.subarray(idx) };
}

wss.on('connection', (ws) => {
  let chunks = [];
  let socket = null;
  let connected = false;
  let pending = [];
  let headerDone = false;

  ws.on('message', (data) => {
    if (!headerDone) {
      chunks.push(data);
      const buf = Buffer.concat(chunks);
      let h;
      try {
        h = parseHeader(buf);
      } catch (e) {
        ws.close();
        return;
      }
      if (!h) return; // header split across messages; wait for more
      headerDone = true;
      chunks = [];
      if (!isAuthorized(h.uuid) || h.command !== 1) {
        ws.close();
        return;
      }
      socket = net.connect({ port: h.port, host: h.host, timeout: 15000 });
      socket.on('connect', () => {
        connected = true;
        ws.send(Buffer.from([h.version, 0]));
        if (h.payload.length) socket.write(h.payload);
        for (const m of pending) socket.write(m);
        pending = [];
      });
      socket.on('data', (d) => {
        if (ws.readyState === 1) ws.send(d);
      });
      socket.on('error', () => {
        try { ws.close(); } catch {}
      });
      socket.on('timeout', () => {
        socket.destroy();
        try { ws.close(); } catch {}
      });
      socket.on('close', () => {
        try { ws.close(); } catch {}
      });
      return;
    }
    if (!socket) return;
    if (connected) socket.write(data);
    else pending.push(data);
  });

  ws.on('close', () => {
    if (socket) socket.destroy();
  });
  ws.on('error', () => {
    if (socket) socket.destroy();
  });
});

server.listen(PORT, () => {
  console.log(`web-service listening on ${PORT}`);
  if (staticKeys.size) console.log(`static keys loaded: ${staticKeys.size}`);
  syncUsers();
  setInterval(syncUsers, 10 * 60 * 1000);
});
