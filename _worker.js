// _worker.js
// 反向代理到 NAS：https://nas.nekron.xyz:15001/
const UPSTREAM = 'https://nas.nekron.xyz:15001';
const UPSTREAM_HOST = 'nas.nekron.xyz';
/** @type {RequestInit} */
const PREFLIGHT_INIT = {
  headers: new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
    'access-control-max-age': '1728000',
  }),
};
const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cdn-loop',
];
function makeRes(body, status = 200, headers = {}) {
  headers['access-control-allow-origin'] = '*';
  return new Response(body, { status, headers });
}
function stripHopByHop(headers) {
  const next = new Headers(headers);
  for (const name of HOP_BY_HOP) next.delete(name);
  return next;
}
function rewriteLocation(location, workersOrigin) {
  if (!location) return location;
  try {
    const loc = new URL(location, UPSTREAM);
    const upstream = new URL(UPSTREAM);
    if (loc.hostname === upstream.hostname && String(loc.port || (loc.protocol === 'https:' ? '443' : '80')) === String(upstream.port || (upstream.protocol === 'https:' ? '443' : '80'))) {
      return workersOrigin + loc.pathname + loc.search + loc.hash;
    }
    return loc.toString();
  } catch {
    return location;
  }
}
export default {
  async fetch(request, env) {
    const getReqHeader = (key) => request.headers.get(key);
    const url = new URL(request.url);
    const workersOrigin = `${url.protocol}//${url.host}`;
    const upstreamBase = env.UPSTREAM || UPSTREAM;
    const target = new URL(url.pathname + url.search, upstreamBase);
    if (request.method === 'OPTIONS' && request.headers.has('access-control-request-headers')) {
      return new Response(null, PREFLIGHT_INIT);
    }
    const headers = stripHopByHop(request.headers);
    headers.set('Host', UPSTREAM_HOST);
    headers.set('X-Forwarded-Host', url.host);
    headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
    headers.set('X-Forwarded-For', getReqHeader('cf-connecting-ip') || getReqHeader('x-forwarded-for') || '');
    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }
    try {
      const original = await fetch(target.toString(), init);
      const newHeaders = stripHopByHop(original.headers);
      const location = newHeaders.get('Location');
      if (location) {
        newHeaders.set('Location', rewriteLocation(location, workersOrigin));
      }
      newHeaders.set('access-control-allow-origin', '*');
      newHeaders.set('access-control-expose-headers', '*');
      newHeaders.delete('content-security-policy');
      newHeaders.delete('content-security-policy-report-only');
      newHeaders.delete('clear-site-data');
      return new Response(original.body, {
        status: original.status,
        headers: newHeaders,
      });
    } catch (error) {
      console.error(`Error fetching from NAS: ${error}`);
      return makeRes(`Error fetching from NAS: ${error}`, 502);
    }
  },
};
