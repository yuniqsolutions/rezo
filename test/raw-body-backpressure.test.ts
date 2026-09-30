import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createServer as createH2 } from 'node:http2';
import type { ServerHttp2Session } from 'node:http2';
import type { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { Rezo } from '../src/core/rezo';
import { executeRequest as http } from '../src/adapters/http';
import { executeRequest as http2, Http2SessionPool } from '../src/adapters/http2';
import { executeRequest as fetchAdapter } from '../src/adapters/fetch';
import { executeRequest as curl } from '../src/adapters/curl';
import { resetGlobalAgentPool } from '../src/utils/agent-pool';

for (const [name, adapter] of [['http', http], ['http2', http2], ['fetch', fetchAdapter], ['curl', curl]] as const) {
  for (const kind of ['Node', 'Web']) {
    it(`${name} handles an early final response with a pending ${kind} producer`, async () => {
      const sockets = new Set<Socket>();
      const sessions = new Set<ServerHttp2Session>();
      const server = adapter === http2 ? createH2() : createServer();
      let sentResponse = false;
      server.on('request', (request, response) => {
        request.once('data', () => {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{"ok":true}', () => { sentResponse = true; });
        });
        request.on('error', (error: Error) => { if (!request.aborted) throw error; });
      });
      server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
      if (adapter === http2) server.on('session', (session: ServerHttp2Session) => sessions.add(session));
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Early response receiver did not bind');
      let stopped = 0;
      let started = false;
      let finishProducer!: () => void;
      const body = kind === 'Node' ? new Readable({
        read() { if (!started) { started = true; this.push(Buffer.from([65, 0, 255])); } },
        destroy(error, done) { stopped++; done(error); },
      }) : new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([65, 0, 255]));
          finishProducer = () => { stopped++; controller.close(); };
        },
        cancel() { stopped++; },
      });
      if (body instanceof Readable) finishProducer = () => body.push(null);
      const client = new Rezo({ cache: false, disableJar: true, retry: false, keepAlive: false }, adapter);
      try {
        const operation = client.request<{ ok: boolean }>({
          url: `http://127.0.0.1:${address.port}/`, method: 'POST', body, timeout: 1500,
          responseType: 'json', headers: { 'Content-Type': 'application/octet-stream' },
        });
        if (adapter === curl) {
          // System curl8.8's upload lane waits for stdin EOF even after an early
          // response. Preserve that backend contract and verify bounded cleanup.
          await new Promise(resolve => setTimeout(resolve, 100));
          expect(sentResponse).toBe(true);
          expect(stopped).toBe(0);
          finishProducer();
        }
        const response = await operation;
        expect(response.data).toEqual({ ok: true });
        await new Promise(resolve => setTimeout(resolve, 40));
        expect(stopped).toBe(1);
      } finally {
        client.destroy(); Http2SessionPool.getInstance().destroy(); resetGlobalAgentPool();
        for (const session of sessions) session.destroy();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it(`${name} bounds ${kind} producer reads when the receiver stops reading`, async () => {
      const sockets = new Set<Socket>();
      const sessions = new Set<ServerHttp2Session>();
      const server = adapter === http2 ? createH2() : createServer();
      let arrived = false;
      server.on('request', (request) => {
        arrived = true; request.pause();
        request.on('error', (error: Error) => {
          if (!request.aborted) throw error;
        });
      });
      server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
      if (adapter === http2) server.on('session', (session: ServerHttp2Session) => sessions.add(session));
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Backpressure receiver did not bind');
      const chunk = new Uint8Array(64 * 1024).fill(65);
      const maximum = 32 * 1024 * 1024;
      let produced = 0;
      let stopped = 0;
      const body = kind === 'Node' ? new Readable({
        highWaterMark: chunk.byteLength,
        read() { if (produced >= maximum) this.push(null); else { produced += chunk.byteLength; this.push(chunk); } },
        destroy(error, done) { stopped++; done(error); },
      }) : new ReadableStream<Uint8Array>({
        pull(controller) {
          if (produced >= maximum) controller.close();
          else { produced += chunk.byteLength; controller.enqueue(chunk); }
        },
        cancel() { stopped++; },
      });
      const controller = new AbortController();
      const client = new Rezo({ cache: false, disableJar: true, retry: false, keepAlive: false }, adapter);
      const outcome = client.request({
        url: `http://127.0.0.1:${address.port}/`, method: 'POST', body,
        headers: { 'Content-Type': 'application/octet-stream' }, signal: controller.signal, timeout: 2000,
      }).then(() => undefined, (error: unknown) => error);
      try {
        await new Promise(resolve => setTimeout(resolve, 150));
        expect(arrived).toBe(true);
        expect(produced).toBeGreaterThan(0);
        expect(produced).toBeLessThan(maximum);
      } finally {
        controller.abort(); await outcome;
        await new Promise(resolve => setTimeout(resolve, 30));
        client.destroy(); Http2SessionPool.getInstance().destroy(); resetGlobalAgentPool();
        for (const session of sessions) session.destroy();
        for (const socket of sockets) socket.destroy();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
      expect(stopped).toBe(1);
    });
  }
}
