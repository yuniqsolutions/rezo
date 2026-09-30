/** Local fixture for the worker rows: 24 bytes, a rejected 500, and a response that never ends until the caller aborts. */
import { createServer, type Server } from 'node:http';

export const BODY_24 = 'abcdefghijklmnopqrstuvwx';
export interface WorkerFixture { origin: string; hits(): number; close(): Promise<void> }

/** Optional static handler for the browser rows (page, worker script, bundle): return true when the request was served. */
export type StaticHandler = (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse) => boolean;

export async function startWorkerFixture(serveStatic?: StaticHandler): Promise<WorkerFixture> {
  let hits = 0;
  const open = new Set<import('node:http').ServerResponse>();
  const server: Server = createServer((request, response) => {
    if (serveStatic?.(request, response)) return;
    hits += 1;
    if (request.url === '/24') { response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '24', 'cache-control': 'no-store' }); response.end(BODY_24); return; }
    if (request.url === '/500') { response.writeHead(500, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); response.end('oops!'); return; }
    if (request.url === '/hold') { response.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); response.write('h'); open.add(response); request.socket.on('close', () => open.delete(response)); return; }
    response.writeHead(404); response.end('no such route');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { origin: `http://127.0.0.1:${port}`, hits: () => hits, close: () => new Promise<void>((resolve) => { for (const response of open) response.destroy(); (server as Server & { closeAllConnections?: () => void }).closeAllConnections?.(); server.close(() => resolve()); }) };
}
