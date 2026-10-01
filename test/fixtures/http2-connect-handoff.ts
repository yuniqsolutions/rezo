import net from 'node:net';
import tls from 'node:tls';

type Certificate = { key: string; cert: string };
type Mode = 'fragmented' | 'coalesced-h2c' | 'silent-tls';
const response = 'HTTP/1.1 200 Connection Established\r\n\r\n';
const preface = Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n');

function frame(type: number, flags: number, streamId: number, data = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(9);
  header.writeUIntBE(data.length, 0, 3); header[3] = type; header[4] = flags; header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, data]);
}

/** CONNECT peers with observable framing and peer-owned socket closure. */
export async function startHandoffProxy(certificate: Certificate, mode: Mode, targetPort?: number) {
  const sockets = new Set<net.Socket>();
  const activeClients = new Set<net.Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const observations = { requests: [] as string[], targetTlsBytes: 0, settingsAcknowledged: false };
  const track = (socket: net.Socket): void => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.once('close', () => sockets.delete(socket));
  };
  const onClient = (socket: net.Socket): void => {
    track(socket); activeClients.add(socket);
    socket.once('close', () => activeClients.delete(socket));
    let pending = Buffer.alloc(0);
    const onConnect = (data: Buffer): void => {
      pending = Buffer.concat([pending, data]);
      const end = pending.indexOf('\r\n\r\n');
      if (end < 0) return;
      observations.requests.push(pending.subarray(0, end + 4).toString('latin1'));
      socket.removeListener('data', onConnect);
      if (mode === 'silent-tls') {
        socket.on('data', chunk => { observations.targetTlsBytes += chunk.length; });
        socket.write(response);
      } else if (mode === 'coalesced-h2c') {
        // An empty server SETTINGS frame arrives in the exact same write as CONNECT.
        // Do not respond to the request until its ACK proves the client consumed these bytes.
        let bytes = Buffer.alloc(0), hasPreface = false, streamId = 0, replied = false;
        socket.on('data', (chunk: Buffer) => {
          bytes = Buffer.concat([bytes, chunk]);
          if (!hasPreface) {
            if (bytes.length < preface.length) return;
            if (!bytes.subarray(0, preface.length).equals(preface)) { socket.destroy(); return; }
            bytes = bytes.subarray(preface.length); hasPreface = true;
          }
          while (bytes.length >= 9) {
            const length = bytes.readUIntBE(0, 3);
            if (bytes.length < length + 9) break;
            const type = bytes[3], flags = bytes[4], id = bytes.readUInt32BE(5) & 0x7fffffff;
            if (type === 4 && (flags & 1) !== 0) observations.settingsAcknowledged = true;
            if (type === 4 && (flags & 1) === 0) socket.write(frame(4, 1, 0));
            if (type === 1) streamId = id;
            bytes = bytes.subarray(length + 9);
          }
          if (!replied && streamId && observations.settingsAcknowledged) {
            replied = true;
            socket.write(frame(1, 4, streamId, Buffer.from([0x88]))); // HPACK indexed :status 200
            socket.write(frame(0, 1, streamId, Buffer.from('ok')));
          }
        });
        socket.write(Buffer.concat([Buffer.from(response), frame(4, 0, 0)]));
      } else {
        socket.pause();
        const upstream = net.connect(targetPort!, '127.0.0.1', () => {
          socket.write(response.slice(0, 19));
          const timer = setTimeout(() => {
            timers.delete(timer);
            if (socket.destroyed) return;
            socket.write(response.slice(19));
            const remainder = pending.subarray(end + 4);
            if (remainder.length) upstream.write(remainder);
            upstream.pipe(socket); socket.pipe(upstream);
          }, 15);
          timers.add(timer);
        });
        track(upstream);
        upstream.on('error', () => socket.destroy());
        socket.once('close', () => upstream.destroy());
        upstream.once('close', () => socket.destroy());
      }
    };
    socket.on('data', onConnect);
  };
  // The h2c control isolates CONNECT remainder preservation from nested TLS support.
  const server = mode === 'coalesced-h2c' ? net.createServer(onClient) : tls.createServer(certificate, onClient);
  server.on('connection', track);
  server.on('tlsClientError', () => undefined);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Proxy did not listen');
  return {
    url: `${mode === 'coalesced-h2c' ? 'http' : 'https'}://127.0.0.1:${address.port}`, port: address.port, activeClients, observations,
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
