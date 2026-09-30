import * as net from "node:net";
import * as tls from "node:tls";
import { Agent } from './base.js';
import { SocksClient } from './socks-client.js';
import { releasePendingProxyHandshake, trackPendingProxyHandshake } from './pending-proxy-handshake.js';
import { waitForSocketConnection } from './wait-for-socket-connection.js';
function parseSocksURL(url) {
  let type;
  switch (url.protocol.replace(":", "")) {
    case "socks4":
      type = 4;
      break;
    case "socks4a":
      type = 4;
      break;
    case "socks5":
    case "socks":
    case "socks5h":
    default:
      type = 5;
      break;
  }
  const host = url.hostname;
  const port = url.port ? parseInt(url.port, 10) : 1080;
  const userId = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  return { host, port, type, userId, password };
}

export class SocksProxyAgent extends Agent {
  static protocols = [
    "socks",
    "socks4",
    "socks4a",
    "socks5",
    "socks5h"
  ];
  proxy;
  tlsConnectionOptions;
  timeout;
  constructor(proxy, opts) {
    super(opts);
    const url = typeof proxy === "string" ? new URL(proxy) : proxy;
    this.proxy = parseSocksURL(url);
    this.timeout = opts?.timeout ?? null;
    this.tlsConnectionOptions = opts ?? {};
  }
  async connect(req, opts) {
    const { host, port } = opts;
    if (!host) {
      throw new Error('No "host" provided');
    }
    const proxySocket = net.connect({ host: this.proxy.host, port: this.proxy.port });
    trackPendingProxyHandshake(req, proxySocket);
    let socket;
    try {
      await waitForSocketConnection(proxySocket);
      const socksOpts = {
        proxy: this.proxy,
        destination: { host, port },
        command: "connect",
        existing_socket: proxySocket
      };
      if (this.timeout !== null) {
        socksOpts.timeout = this.timeout;
      }
      ({ socket } = await SocksClient.createConnection(socksOpts));
    } finally {
      releasePendingProxyHandshake(req, proxySocket);
    }
    if (opts.secureEndpoint) {
      const servername = opts.servername ?? host;
      const tlsSocket = tls.connect({
        ...this.tlsConnectionOptions,
        socket,
        servername: !net.isIP(servername) ? servername : undefined
      });
      return tlsSocket;
    }
    return socket;
  }
}
export default SocksProxyAgent;
