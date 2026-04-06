const net = require("node:net");
const tls = require("node:tls");
const { Agent } = require('./base.cjs');
const { SocksClient } = require('./socks-client.cjs');
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

class SocksProxyAgent extends Agent {
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
  async connect(_req, opts) {
    const { host, port } = opts;
    if (!host) {
      throw new Error('No "host" provided');
    }
    const socksOpts = {
      proxy: this.proxy,
      destination: { host, port },
      command: "connect"
    };
    if (this.timeout !== null) {
      socksOpts.timeout = this.timeout;
    }
    const { socket } = await SocksClient.createConnection(socksOpts);
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

exports.SocksProxyAgent = SocksProxyAgent;
exports.default = SocksProxyAgent;
module.exports = Object.assign(SocksProxyAgent, exports);