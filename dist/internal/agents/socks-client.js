import * as net from "node:net";
import { EventEmitter } from "node:events";

export class SocksClientError extends Error {
  options;
  constructor(message, options) {
    super(message);
    this.name = "SocksClientError";
    this.options = options;
  }
}
const SOCKS_VERSION = {
  SOCKS4: 4,
  SOCKS5: 5
};
const SOCKS_COMMAND = {
  connect: 1,
  bind: 2,
  associate: 3
};
const SOCKS5_AUTH = {
  NoAuth: 0,
  UserPass: 2,
  NoAcceptable: 255
};
const SOCKS5_HOST_TYPE = {
  IPv4: 1,
  Hostname: 3,
  IPv6: 4
};
const SOCKS4_RESPONSE = {
  Granted: 90,
  Failed: 91,
  FailedNoIdentd: 92,
  FailedIdMismatch: 93
};
const SOCKS5_RESPONSE = {
  Granted: 0,
  GeneralFailure: 1,
  ConnectionNotAllowed: 2,
  NetworkUnreachable: 3,
  HostUnreachable: 4,
  ConnectionRefused: 5,
  TTLExpired: 6,
  CommandNotSupported: 7,
  AddressTypeNotSupported: 8
};
const DEFAULT_TIMEOUT = 30000;
var SocksState;
((SocksState) => {
  SocksState[SocksState["Created"] = 0] = "Created";
  SocksState[SocksState["Connecting"] = 1] = "Connecting";
  SocksState[SocksState["Connected"] = 2] = "Connected";
  SocksState[SocksState["SentInitialHandshake"] = 3] = "SentInitialHandshake";
  SocksState[SocksState["SentAuthentication"] = 4] = "SentAuthentication";
  SocksState[SocksState["SentFinalHandshake"] = 5] = "SentFinalHandshake";
  SocksState[SocksState["ReceivedAuthenticationResponse"] = 6] = "ReceivedAuthenticationResponse";
  SocksState[SocksState["ReceivedFinalResponse"] = 7] = "ReceivedFinalResponse";
  SocksState[SocksState["Established"] = 8] = "Established";
  SocksState[SocksState["Error"] = 9] = "Error";
  SocksState[SocksState["BoundWaitingForConnection"] = 10] = "BoundWaitingForConnection";
})(SocksState ||= {});
function ipv4ToBuffer(ip) {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  return Buffer.from(parts);
}
function bufferToIpv4(buffer, offset) {
  return `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
}
function bufferToIpv6(buffer, offset) {
  const parts = [];
  for (let i = 0;i < 16; i += 2) {
    const value = buffer.readUInt16BE(offset + i);
    parts.push(value.toString(16));
  }
  return parts.join(":");
}
function ipv6ToBuffer(ip) {
  const expandedIp = expandIPv6(ip);
  const parts = expandedIp.split(":").map((p) => parseInt(p, 16));
  const buffer = Buffer.alloc(16);
  for (let i = 0;i < 8; i++) {
    buffer.writeUInt16BE(parts[i], i * 2);
  }
  return buffer;
}
function expandIPv6(ip) {
  if (ip.includes("::")) {
    const [left, right = ""] = ip.split("::");
    const leftParts = left ? left.split(":") : [];
    const rightParts = right ? right.split(":") : [];
    const missingParts = 8 - leftParts.length - rightParts.length;
    const middle = Array(missingParts).fill("0");
    return [...leftParts, ...middle, ...rightParts].join(":");
  }
  return ip;
}

class ReceiveBuffer {
  buffer;
  readOffset = 0;
  writeOffset = 0;
  static INITIAL_SIZE = 256;
  constructor() {
    this.buffer = Buffer.allocUnsafe(ReceiveBuffer.INITIAL_SIZE);
  }
  append(data) {
    const requiredSize = this.writeOffset + data.length;
    if (requiredSize > this.buffer.length) {
      const availableData = this.writeOffset - this.readOffset;
      if (this.readOffset > this.buffer.length / 2) {
        this.buffer.copy(this.buffer, 0, this.readOffset, this.writeOffset);
        this.writeOffset = availableData;
        this.readOffset = 0;
      }
      if (this.writeOffset + data.length > this.buffer.length) {
        const newSize = Math.max(this.buffer.length * 2, this.writeOffset + data.length);
        const newBuffer = Buffer.allocUnsafe(newSize);
        this.buffer.copy(newBuffer, 0, this.readOffset, this.writeOffset);
        this.writeOffset -= this.readOffset;
        this.readOffset = 0;
        this.buffer = newBuffer;
      }
    }
    data.copy(this.buffer, this.writeOffset);
    this.writeOffset += data.length;
  }
  get length() {
    return this.writeOffset - this.readOffset;
  }
  peek(length) {
    return this.buffer.subarray(this.readOffset, this.readOffset + length);
  }
  get(length) {
    const result = this.buffer.subarray(this.readOffset, this.readOffset + length);
    this.readOffset += length;
    if (this.readOffset === this.writeOffset) {
      this.readOffset = 0;
      this.writeOffset = 0;
    }
    return result;
  }
}

export class SocksClient extends EventEmitter {
  options;
  socket;
  state = 0 /* Created */;
  receiveBuffer;
  nextRequiredPacketBufferSize = 0;
  _socks5ChosenAuthType = SOCKS5_AUTH.NoAuth;
  onDataReceived;
  onClose;
  onError;
  onConnect;
  constructor(options) {
    super();
    this.options = { ...options };
    this.validateOptions();
    this.state = 0 /* Created */;
  }
  validateOptions() {
    const { proxy, destination } = this.options;
    if (!proxy || !proxy.host || !proxy.port) {
      throw new SocksClientError("Invalid proxy configuration", this.options);
    }
    if (!destination || !destination.host || !destination.port) {
      throw new SocksClientError("Invalid destination configuration", this.options);
    }
    if (proxy.type !== 4 && proxy.type !== 5) {
      throw new SocksClientError("Invalid SOCKS version (must be 4 or 5)", this.options);
    }
  }
  static async createConnection(options) {
    return new Promise((resolve, reject) => {
      try {
        const client = new SocksClient(options);
        client.connect(options.existing_socket);
        client.once("established", (info) => {
          client.removeAllListeners();
          resolve(info);
        });
        client.once("error", (err) => {
          client.removeAllListeners();
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }
  setState(newState) {
    if (this.state !== 9 /* Error */) {
      this.state = newState;
    }
  }
  connect(existingSocket) {
    this.onDataReceived = (data) => this.onDataReceivedHandler(data);
    this.onClose = () => this.onCloseHandler();
    this.onError = (err) => this.onErrorHandler(err);
    this.onConnect = () => this.onConnectHandler();
    const timer = setTimeout(() => this.onEstablishedTimeout(), this.options.timeout || DEFAULT_TIMEOUT);
    if (timer.unref && typeof timer.unref === "function") {
      timer.unref();
    }
    if (existingSocket) {
      this.socket = existingSocket;
    } else {
      this.socket = new net.Socket;
    }
    this.socket.once("close", this.onClose);
    this.socket.once("error", this.onError);
    this.socket.once("connect", this.onConnect);
    this.socket.on("data", this.onDataReceived);
    this.setState(1 /* Connecting */);
    this.receiveBuffer = new ReceiveBuffer;
    if (existingSocket) {
      this.socket.emit("connect");
    } else {
      const socketOptions = {
        ...this.options.socket_options,
        host: this.options.proxy.host,
        port: this.options.proxy.port
      };
      this.socket.connect(socketOptions);
    }
    this.prependOnceListener("established", (info) => {
      setImmediate(() => {
        if (this.receiveBuffer.length > 0) {
          const excessData = this.receiveBuffer.get(this.receiveBuffer.length);
          info.socket.emit("data", excessData);
        }
        info.socket.resume();
      });
    });
  }
  onEstablishedTimeout() {
    if (this.state !== 8 /* Established */ && this.state !== 10 /* BoundWaitingForConnection */) {
      this.closeSocket("Proxy connection timed out");
    }
  }
  onConnectHandler() {
    this.setState(2 /* Connected */);
    if (this.options.proxy.type === 4) {
      this.sendSocks4InitialHandshake();
    } else {
      this.sendSocks5InitialHandshake();
    }
    this.setState(3 /* SentInitialHandshake */);
  }
  onDataReceivedHandler(data) {
    this.receiveBuffer.append(data);
    this.processData();
  }
  processData() {
    while (this.state !== 8 /* Established */ && this.state !== 9 /* Error */ && this.receiveBuffer.length >= this.nextRequiredPacketBufferSize) {
      if (this.state === 3 /* SentInitialHandshake */) {
        if (this.options.proxy.type === 4) {
          this.handleSocks4FinalHandshakeResponse();
        } else {
          this.handleInitialSocks5HandshakeResponse();
        }
      } else if (this.state === 4 /* SentAuthentication */) {
        this.handleInitialSocks5AuthenticationHandshakeResponse();
      } else if (this.state === 5 /* SentFinalHandshake */) {
        this.handleSocks5FinalHandshakeResponse();
      } else if (this.state === 10 /* BoundWaitingForConnection */) {
        if (this.options.proxy.type === 4) {
          this.handleSocks4IncomingConnectionResponse();
        } else {
          this.handleSocks5IncomingConnectionResponse();
        }
      } else {
        this.closeSocket("Internal error");
        break;
      }
    }
  }
  onCloseHandler() {
    this.closeSocket("Socket closed");
  }
  onErrorHandler(err) {
    this.closeSocket(err.message);
  }
  removeInternalSocketHandlers() {
    this.socket.pause();
    this.socket.removeListener("data", this.onDataReceived);
    this.socket.removeListener("close", this.onClose);
    this.socket.removeListener("error", this.onError);
    this.socket.removeListener("connect", this.onConnect);
  }
  closeSocket(err) {
    if (this.state !== 9 /* Error */) {
      this.setState(9 /* Error */);
      this.socket.destroy();
      this.removeInternalSocketHandlers();
      this.emit("error", new SocksClientError(err, this.options));
    }
  }
  sendSocks4InitialHandshake() {
    const userId = this.options.proxy.userId || "";
    const { destination } = this.options;
    const command = SOCKS_COMMAND[this.options.command || "connect"];
    const isIPv4 = net.isIPv4(destination.host);
    const hostBuffer = isIPv4 ? ipv4ToBuffer(destination.host) : Buffer.from([0, 0, 0, 1]);
    const userIdBuffer = Buffer.from(userId, "utf8");
    const hostnameBuffer = !isIPv4 ? Buffer.from(destination.host, "utf8") : Buffer.alloc(0);
    const bufferLength = 1 + 1 + 2 + 4 + userIdBuffer.length + 1 + (isIPv4 ? 0 : hostnameBuffer.length + 1);
    const buffer = Buffer.alloc(bufferLength);
    let offset = 0;
    buffer.writeUInt8(SOCKS_VERSION.SOCKS4, offset++);
    buffer.writeUInt8(command, offset++);
    buffer.writeUInt16BE(destination.port, offset);
    offset += 2;
    hostBuffer.copy(buffer, offset);
    offset += 4;
    userIdBuffer.copy(buffer, offset);
    offset += userIdBuffer.length;
    buffer.writeUInt8(0, offset++);
    if (!isIPv4) {
      hostnameBuffer.copy(buffer, offset);
      offset += hostnameBuffer.length;
      buffer.writeUInt8(0, offset++);
    }
    this.nextRequiredPacketBufferSize = 8;
    this.socket.write(buffer);
  }
  handleSocks4FinalHandshakeResponse() {
    const data = this.receiveBuffer.get(8);
    if (data[1] !== SOCKS4_RESPONSE.Granted) {
      const responseCode = Object.entries(SOCKS4_RESPONSE).find(([, v]) => v === data[1])?.[0] || "Unknown";
      this.closeSocket(`SOCKS4 proxy rejected connection - ${responseCode}`);
    } else {
      const command = this.options.command || "connect";
      if (command === "bind") {
        const port = data.readUInt16BE(2);
        let host = bufferToIpv4(data, 4);
        if (host === "0.0.0.0") {
          host = this.options.proxy.host;
        }
        this.setState(10 /* BoundWaitingForConnection */);
        this.emit("bound", { remoteHost: { host, port }, socket: this.socket });
      } else {
        this.setState(8 /* Established */);
        this.removeInternalSocketHandlers();
        this.emit("established", { socket: this.socket });
      }
    }
  }
  handleSocks4IncomingConnectionResponse() {
    const data = this.receiveBuffer.get(8);
    if (data[1] !== SOCKS4_RESPONSE.Granted) {
      const responseCode = Object.entries(SOCKS4_RESPONSE).find(([, v]) => v === data[1])?.[0] || "Unknown";
      this.closeSocket(`SOCKS4 proxy rejected incoming connection - ${responseCode}`);
    } else {
      const port = data.readUInt16BE(2);
      let host = bufferToIpv4(data, 4);
      if (host === "0.0.0.0") {
        host = this.options.proxy.host;
      }
      this.setState(8 /* Established */);
      this.removeInternalSocketHandlers();
      this.emit("established", { remoteHost: { host, port }, socket: this.socket });
    }
  }
  sendSocks5InitialHandshake() {
    const supportedAuthMethods = [SOCKS5_AUTH.NoAuth];
    if (this.options.proxy.userId || this.options.proxy.password) {
      supportedAuthMethods.push(SOCKS5_AUTH.UserPass);
    }
    const buffer = Buffer.alloc(2 + supportedAuthMethods.length);
    buffer.writeUInt8(SOCKS_VERSION.SOCKS5, 0);
    buffer.writeUInt8(supportedAuthMethods.length, 1);
    for (let i = 0;i < supportedAuthMethods.length; i++) {
      buffer.writeUInt8(supportedAuthMethods[i], 2 + i);
    }
    this.nextRequiredPacketBufferSize = 2;
    this.socket.write(buffer);
    this.setState(3 /* SentInitialHandshake */);
  }
  handleInitialSocks5HandshakeResponse() {
    const data = this.receiveBuffer.get(2);
    if (data[0] !== SOCKS_VERSION.SOCKS5) {
      this.closeSocket(`Invalid SOCKS5 initial handshake response - expected version 5, got ${data[0]}`);
    } else if (data[1] === SOCKS5_AUTH.NoAcceptable) {
      const hasCredentials = !!(this.options.proxy.userId || this.options.proxy.password);
      this.closeSocket(hasCredentials ? "SOCKS5 proxy rejected authentication - check username/password" : "SOCKS5 proxy requires authentication but no credentials provided");
    } else {
      if (data[1] === SOCKS5_AUTH.NoAuth) {
        this._socks5ChosenAuthType = SOCKS5_AUTH.NoAuth;
        this.sendSocks5CommandRequest();
      } else if (data[1] === SOCKS5_AUTH.UserPass) {
        this._socks5ChosenAuthType = SOCKS5_AUTH.UserPass;
        this.sendSocks5UserPassAuthentication();
      } else {
        const authName = data[1] === 1 ? "GSSAPI" : `method ${data[1]}`;
        this.closeSocket(`SOCKS5 proxy requires unsupported authentication: ${authName}`);
      }
    }
  }
  sendSocks5UserPassAuthentication() {
    const userId = this.options.proxy.userId || "";
    const password = this.options.proxy.password || "";
    const userIdLength = Buffer.byteLength(userId);
    const passwordLength = Buffer.byteLength(password);
    const buffer = Buffer.alloc(3 + userIdLength + passwordLength);
    buffer.writeUInt8(1, 0);
    buffer.writeUInt8(userIdLength, 1);
    buffer.write(userId, 2, userIdLength);
    buffer.writeUInt8(passwordLength, 2 + userIdLength);
    buffer.write(password, 3 + userIdLength, passwordLength);
    this.nextRequiredPacketBufferSize = 2;
    this.socket.write(buffer);
    this.setState(4 /* SentAuthentication */);
  }
  handleInitialSocks5AuthenticationHandshakeResponse() {
    const data = this.receiveBuffer.get(2);
    if (data[1] !== 0) {
      this.closeSocket("SOCKS5 authentication failed");
    } else {
      this.sendSocks5CommandRequest();
    }
  }
  sendSocks5CommandRequest() {
    const { destination } = this.options;
    const command = SOCKS_COMMAND[this.options.command || "connect"];
    let addressType;
    let addressBuffer;
    if (net.isIPv4(destination.host)) {
      addressType = SOCKS5_HOST_TYPE.IPv4;
      addressBuffer = ipv4ToBuffer(destination.host);
    } else if (net.isIPv6(destination.host)) {
      addressType = SOCKS5_HOST_TYPE.IPv6;
      addressBuffer = ipv6ToBuffer(destination.host);
    } else {
      addressType = SOCKS5_HOST_TYPE.Hostname;
      const hostnameLength = Buffer.byteLength(destination.host);
      addressBuffer = Buffer.alloc(1 + hostnameLength);
      addressBuffer.writeUInt8(hostnameLength, 0);
      addressBuffer.write(destination.host, 1, hostnameLength);
    }
    const buffer = Buffer.alloc(4 + addressBuffer.length + 2);
    buffer.writeUInt8(SOCKS_VERSION.SOCKS5, 0);
    buffer.writeUInt8(command, 1);
    buffer.writeUInt8(0, 2);
    buffer.writeUInt8(addressType, 3);
    addressBuffer.copy(buffer, 4);
    buffer.writeUInt16BE(destination.port, 4 + addressBuffer.length);
    this.nextRequiredPacketBufferSize = 5;
    this.socket.write(buffer);
    this.setState(5 /* SentFinalHandshake */);
  }
  handleSocks5FinalHandshakeResponse() {
    const header = this.receiveBuffer.peek(5);
    if (header[0] !== SOCKS_VERSION.SOCKS5 || header[1] !== SOCKS5_RESPONSE.Granted) {
      const responseCode = Object.entries(SOCKS5_RESPONSE).find(([, v]) => v === header[1])?.[0] || "Unknown";
      this.closeSocket(`SOCKS5 proxy rejected connection - ${responseCode}`);
      return;
    }
    const addressType = header[3];
    let remoteHost;
    let dataNeeded;
    if (addressType === SOCKS5_HOST_TYPE.IPv4) {
      dataNeeded = 10;
      if (this.receiveBuffer.length < dataNeeded) {
        this.nextRequiredPacketBufferSize = dataNeeded;
        return;
      }
      const data = this.receiveBuffer.get(dataNeeded);
      let host = bufferToIpv4(data, 4);
      const port = data.readUInt16BE(8);
      if (host === "0.0.0.0") {
        host = this.options.proxy.host;
      }
      remoteHost = { host, port };
    } else if (addressType === SOCKS5_HOST_TYPE.Hostname) {
      const hostLength = header[4];
      dataNeeded = 7 + hostLength;
      if (this.receiveBuffer.length < dataNeeded) {
        this.nextRequiredPacketBufferSize = dataNeeded;
        return;
      }
      const data = this.receiveBuffer.get(dataNeeded);
      const host = data.slice(5, 5 + hostLength).toString("utf8");
      const port = data.readUInt16BE(5 + hostLength);
      remoteHost = { host, port };
    } else if (addressType === SOCKS5_HOST_TYPE.IPv6) {
      dataNeeded = 22;
      if (this.receiveBuffer.length < dataNeeded) {
        this.nextRequiredPacketBufferSize = dataNeeded;
        return;
      }
      const data = this.receiveBuffer.get(dataNeeded);
      const host = bufferToIpv6(data, 4);
      const port = data.readUInt16BE(20);
      remoteHost = { host, port };
    }
    this.setState(7 /* ReceivedFinalResponse */);
    const command = this.options.command || "connect";
    if (command === "connect") {
      this.setState(8 /* Established */);
      this.removeInternalSocketHandlers();
      this.emit("established", { remoteHost, socket: this.socket });
    } else if (command === "bind") {
      this.setState(10 /* BoundWaitingForConnection */);
      this.nextRequiredPacketBufferSize = 5;
      this.emit("bound", { remoteHost, socket: this.socket });
    } else if (command === "associate") {
      this.setState(8 /* Established */);
      this.removeInternalSocketHandlers();
      this.emit("established", { remoteHost, socket: this.socket });
    }
  }
  handleSocks5IncomingConnectionResponse() {
    const header = this.receiveBuffer.peek(5);
    if (header[0] !== SOCKS_VERSION.SOCKS5 || header[1] !== SOCKS5_RESPONSE.Granted) {
      const responseCode = Object.entries(SOCKS5_RESPONSE).find(([, v]) => v === header[1])?.[0] || "Unknown";
      this.closeSocket(`SOCKS5 proxy rejected incoming connection - ${responseCode}`);
      return;
    }
    const addressType = header[3];
    let remoteHost;
    let dataNeeded;
    if (addressType === SOCKS5_HOST_TYPE.IPv4) {
      dataNeeded = 10;
      if (this.receiveBuffer.length < dataNeeded) {
        this.nextRequiredPacketBufferSize = dataNeeded;
        return;
      }
      const data = this.receiveBuffer.get(dataNeeded);
      let host = bufferToIpv4(data, 4);
      const port = data.readUInt16BE(8);
      if (host === "0.0.0.0") {
        host = this.options.proxy.host;
      }
      remoteHost = { host, port };
    } else if (addressType === SOCKS5_HOST_TYPE.Hostname) {
      const hostLength = header[4];
      dataNeeded = 7 + hostLength;
      if (this.receiveBuffer.length < dataNeeded) {
        this.nextRequiredPacketBufferSize = dataNeeded;
        return;
      }
      const data = this.receiveBuffer.get(dataNeeded);
      const host = data.slice(5, 5 + hostLength).toString("utf8");
      const port = data.readUInt16BE(5 + hostLength);
      remoteHost = { host, port };
    } else if (addressType === SOCKS5_HOST_TYPE.IPv6) {
      dataNeeded = 22;
      if (this.receiveBuffer.length < dataNeeded) {
        this.nextRequiredPacketBufferSize = dataNeeded;
        return;
      }
      const data = this.receiveBuffer.get(dataNeeded);
      const host = bufferToIpv6(data, 4);
      const port = data.readUInt16BE(20);
      remoteHost = { host, port };
    }
    this.setState(8 /* Established */);
    this.removeInternalSocketHandlers();
    this.emit("established", { remoteHost, socket: this.socket });
  }
  get socksClientOptions() {
    return { ...this.options };
  }
}
export default SocksClient;
