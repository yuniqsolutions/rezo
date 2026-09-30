/**
 * Local HTTP fixture for the cURL facade contract rows: every route the rows need, a wire log per request (method, path,
 * host, credential headers, body digest) and per-route attempt counters. Bound to 127.0.0.1; `localhost` on the same
 * port is the "foreign host" for cross-host redirect rows. Runtime-agnostic (node:http works on Node, Bun and Deno).
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface WireHit {
  readonly method: string;
  readonly path: string;
  readonly host: string;
  readonly authorization: string | null;
  readonly cookie: string | null;
  readonly bodyLength: number;
  readonly bodySha256: string;
}
export interface FixtureServer {
  readonly origin: string;
  readonly foreignOrigin: string;
  readonly port: number;
  hits(): number;
  wire(): readonly WireHit[];
  /** Releases a `/hold/<key>` response so it finishes its body. */
  release(key: string): void;
  close(): Promise<void>;
}

const BODY_OK = 'hello';
const BODY_ERROR = 'oops!';

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}
const text = (response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void => {
  response.writeHead(status, { 'content-type': 'text/plain', 'content-length': String(Buffer.byteLength(body)), ...headers });
  response.end(body);
};

export async function startFixtureServer(): Promise<FixtureServer> {
  const attempts = new Map<string, number>();
  const wire: WireHit[] = [];
  const held = new Map<string, () => void>();
  let hits = 0;
  const server: Server = createServer(async (request, response) => {
    hits += 1;
    const body = await readBody(request);
    const url = new URL(request.url ?? '/', 'http://fixture');
    const path = url.pathname;
    const attempt = (attempts.get(path) ?? 0) + 1;
    attempts.set(path, attempt);
    wire.push({
      method: request.method ?? 'GET', path, host: request.headers.host ?? '',
      authorization: (request.headers.authorization as string | undefined) ?? null,
      cookie: (request.headers.cookie as string | undefined) ?? null,
      bodyLength: body.length, bodySha256: createHash('sha256').update(body).digest('hex'),
    });
    const port = (server.address() as { port: number }).port;
    if (path === '/200') return text(response, 200, BODY_OK);
    if (path === '/500') return text(response, 500, BODY_ERROR);
    if (path === '/500-truncated') {
      // Declares ten bytes, sends two, then the peer cuts the connection: a rejected status whose payload is truncated.
      response.writeHead(500, { 'content-type': 'text/plain', 'content-length': '10' });
      response.write('oo');
      response.flushHeaders();
      setTimeout(() => request.socket.destroy(), 30);
      return;
    }
    if (path === '/redirect') return text(response, 302, 'moved', { location: '/200' });
    if (path === '/chain') return text(response, 302, 'moved', { location: '/chain-2' });
    if (path === '/chain-2') return text(response, 302, 'moved', { location: '/200' });
    if (path === '/cross') return text(response, 302, 'moved', { location: `http://localhost:${port}/200` });
    if (path === '/same') return text(response, 302, 'moved', { location: `http://127.0.0.1:${port}/200` });
    if (path.startsWith('/503-once/')) return attempt === 1 ? text(response, 503, 'busy') : text(response, 200, BODY_OK);
    if (path === '/429') return text(response, 429, 'slow', { 'retry-after': '2' });
    if (path.startsWith('/hold/')) {
      // Head plus one byte now; the rest only when the row releases it (deterministic stage observation).
      response.writeHead(500, { 'content-type': 'text/plain', 'content-length': String(BODY_ERROR.length) });
      response.write(BODY_ERROR.slice(0, 1));
      response.flushHeaders();
      held.set(path.slice('/hold/'.length), () => response.end(BODY_ERROR.slice(1)));
      return;
    }
    if (path.startsWith('/slow/')) {
      // Ten bytes: five now, five after a delay long enough for a caller to abort mid-body.
      response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '10' });
      response.write('hello');
      response.flushHeaders();
      const timer = setTimeout(() => response.end('world'), 2500);
      request.socket.on('close', () => clearTimeout(timer));
      return;
    }
    if (path === '/upload') return text(response, 200, `received ${body.length}`);
    if (path.startsWith('/503-once-upload/')) return attempt === 1 ? text(response, 503, 'busy') : text(response, 200, `received ${body.length}`);
    return text(response, 404, 'no such route');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    origin: `http://127.0.0.1:${port}`, foreignOrigin: `http://localhost:${port}`, port,
    hits: () => hits, wire: () => wire,
    release: (key) => { held.get(key)?.(); held.delete(key); },
    close: () => new Promise<void>((resolve) => { for (const finish of held.values()) finish(); held.clear(); (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
