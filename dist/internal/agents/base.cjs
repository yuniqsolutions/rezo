const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const INTERNAL = Symbol("AgentBaseInternalState");

class Agent extends http.Agent {
  [INTERNAL] = {};
  constructor(opts) {
    super(opts);
  }
  isSecureEndpoint(options) {
    if (options) {
      if (typeof options.secureEndpoint === "boolean") {
        return options.secureEndpoint;
      }
      if (typeof options.protocol === "string") {
        return options.protocol === "https:";
      }
    }
    const { stack } = new Error;
    if (typeof stack !== "string")
      return false;
    return stack.split(`
`).some((l) => l.indexOf("(https.js:") !== -1 || l.indexOf("node:https:") !== -1);
  }
  incrementSockets(name) {
    if (this.maxSockets === 1 / 0 && this.maxTotalSockets === 1 / 0) {
      return null;
    }
    if (!this.sockets[name]) {
      this.sockets[name] = [];
    }
    const fakeSocket = new net.Socket({ writable: false });
    this.sockets[name].push(fakeSocket);
    this.totalSocketCount++;
    return fakeSocket;
  }
  decrementSockets(name, socket) {
    if (!this.sockets[name] || socket === null) {
      return;
    }
    const sockets = this.sockets[name];
    const index = sockets.indexOf(socket);
    if (index !== -1) {
      sockets.splice(index, 1);
      this.totalSocketCount--;
      if (sockets.length === 0) {
        delete this.sockets[name];
      }
    }
  }
  getName(options) {
    const secureEndpoint = this.isSecureEndpoint(options);
    if (secureEndpoint) {
      return https.Agent.prototype.getName.call(this, options);
    }
    return http.Agent.prototype.getName.call(this, options);
  }
  createSocket(req, options, cb) {
    const connectOpts = {
      ...options,
      secureEndpoint: this.isSecureEndpoint(options)
    };
    const name = this.getName(connectOpts);
    const fakeSocket = this.incrementSockets(name);
    Promise.resolve().then(() => this.connect(req, connectOpts)).then((socket) => {
      this.decrementSockets(name, fakeSocket);
      if (socket instanceof http.Agent) {
        try {
          return socket.addRequest(req, connectOpts);
        } catch (err) {
          return cb(err);
        }
      }
      this[INTERNAL].currentSocket = socket;
      http.Agent.prototype.createSocket.call(this, req, options, cb);
    }, (err) => {
      this.decrementSockets(name, fakeSocket);
      cb(err);
    });
  }
  createConnection() {
    const socket = this[INTERNAL].currentSocket;
    this[INTERNAL].currentSocket = undefined;
    if (!socket) {
      throw new Error("No socket was returned in the `connect()` function");
    }
    return socket;
  }
  async connect(_req, _opts) {
    throw new Error("`connect()` must be implemented by a subclass of `Agent`");
  }
  get defaultPort() {
    return this[INTERNAL].defaultPort ?? (this.protocol === "https:" ? 443 : 80);
  }
  set defaultPort(v) {
    if (this[INTERNAL]) {
      this[INTERNAL].defaultPort = v;
    }
  }
  get protocol() {
    return this[INTERNAL].protocol ?? (this.isSecureEndpoint() ? "https:" : "http:");
  }
  set protocol(v) {
    if (this[INTERNAL]) {
      this[INTERNAL].protocol = v;
    }
  }
}

exports.Agent = Agent;
exports.default = Agent;
module.exports = Object.assign(Agent, exports);