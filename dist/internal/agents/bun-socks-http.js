import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import * as net from "node:net";
import * as tls from "node:tls";
import { SocksClient } from './socks-client.js';
import { parseProxyString } from '../../proxy/parse.js';
export function isBunRuntime() {
  return typeof globalThis.Bun !== "undefined";
}
export function isBunSocksRequest(proxy) {
  if (!isBunRuntime() || !proxy)
    return false;
  if (typeof proxy === "string") {
    const proxyObject = parseProxyString(proxy);
    return proxyObject !== null && proxyObject.protocol.startsWith("socks");
  }
  return proxy.protocol?.startsWith("socks") ?? false;
}

class BunSocksIncomingMessage extends Readable {
  httpVersion = "1.1";
  httpVersionMajor = 1;
  httpVersionMinor = 1;
  complete = false;
  headers = {};
  rawHeaders = [];
  trailers = {};
  rawTrailers = [];
  statusCode = 0;
  statusMessage = "";
  socket;
  url = "";
  method = "";
  aborted = false;
  get connection() {
    return this.socket;
  }
  _finished = false;
  constructor(socket) {
    super();
    this.socket = socket;
  }
  _setHeaders(headers, rawHeaders) {
    this.headers = headers;
    this.rawHeaders = rawHeaders;
  }
  _setStatus(code, message) {
    this.statusCode = code;
    this.statusMessage = message;
  }
  _pushChunk(chunk) {
    if (!this._finished) {
      this.push(chunk);
    }
  }
  _finish() {
    this._finished = true;
    this.complete = true;
    this.push(null);
  }
  _read() {}
  setTimeout(msecs, callback) {
    this.socket.setTimeout(msecs, callback);
    return this;
  }
  destroy(error) {
    this.aborted = true;
    this.socket.destroy(error);
    return super.destroy(error);
  }
}

class BunSocksClientRequest extends EventEmitter {
  method;
  path;
  host;
  protocol;
  maxHeadersCount = 2000;
  reusedSocket = false;
  writableEnded = false;
  writableFinished = false;
  destroyed = false;
  upgrading = false;
  chunkedEncoding = false;
  shouldKeepAlive = true;
  useChunkedEncodingByDefault = true;
  sendDate = true;
  get finished() {
    return this.writableEnded;
  }
  _proxy;
  _options;
  _headers;
  _body = [];
  _socket = null;
  _finished = false;
  _aborted = false;
  _timeout = 0;
  _timeoutTimer = null;
  _headersSent = false;
  get socket() {
    return this._socket;
  }
  get connection() {
    return this._socket;
  }
  constructor(proxy, options) {
    super();
    this._proxy = proxy;
    this._options = options;
    this._headers = options.headers && typeof options.headers === "object" && !Array.isArray(options.headers) ? { ...options.headers } : {};
    this.method = options.method || "GET";
    this.path = options.path || "/";
    this.host = options.hostname || options.host || "localhost";
    this.protocol = options.protocol || "http:";
  }
  setHeader(name, value) {
    this._headers[name.toLowerCase()] = value;
    return this;
  }
  getHeader(name) {
    return this._headers[name.toLowerCase()];
  }
  getHeaders() {
    return { ...this._headers };
  }
  getHeaderNames() {
    return Object.keys(this._headers);
  }
  getRawHeaderNames() {
    return Object.keys(this._headers);
  }
  hasHeader(name) {
    return name.toLowerCase() in this._headers;
  }
  removeHeader(name) {
    delete this._headers[name.toLowerCase()];
  }
  flushHeaders() {
    this._headersSent = true;
  }
  get headersSent() {
    return this._headersSent;
  }
  setNoDelay(noDelay) {
    if (this._socket && "setNoDelay" in this._socket) {
      this._socket.setNoDelay(noDelay);
    }
  }
  setSocketKeepAlive(enable, initialDelay) {
    if (this._socket && "setKeepAlive" in this._socket) {
      this._socket.setKeepAlive(enable, initialDelay);
    }
  }
  cork() {}
  uncork() {}
  addTrailers(_headers) {}
  setTimeout(timeout, callback) {
    this._timeout = timeout;
    if (callback) {
      this.once("timeout", callback);
    }
    return this;
  }
  abort() {
    this._aborted = true;
    this.destroyed = true;
    if (this._socket) {
      this._socket.destroy();
    }
    this.emit("abort");
  }
  destroy(error) {
    this._aborted = true;
    this.destroyed = true;
    if (this._socket) {
      this._socket.destroy(error);
    }
    if (error) {
      this.emit("error", error);
    }
    return this;
  }
  write(chunk, encoding, callback) {
    if (this._finished || this._aborted)
      return false;
    const buf = typeof chunk === "string" ? Buffer.from(chunk, typeof encoding === "string" ? encoding : "utf8") : chunk;
    this._body.push(buf);
    if (typeof encoding === "function") {
      encoding();
    } else if (callback) {
      callback();
    }
    return true;
  }
  end(data, encoding, callback) {
    if (this._finished)
      return this;
    this._finished = true;
    this.writableEnded = true;
    this._headersSent = true;
    if (typeof data === "function") {
      callback = data;
      data = undefined;
    } else if (typeof encoding === "function") {
      callback = encoding;
      encoding = undefined;
    }
    if (data) {
      this.write(data, encoding);
    }
    this._execute().then(() => {
      this.writableFinished = true;
      if (callback)
        callback();
    }).catch((err) => {
      this.emit("error", err);
    });
    return this;
  }
  async _execute() {
    if (this._aborted)
      return;
    const rawPort = this._options.port ? typeof this._options.port === "string" ? parseInt(this._options.port, 10) : this._options.port : null;
    const isSecure = this.protocol === "https:" || rawPort === 443;
    const port = rawPort ?? (isSecure ? 443 : 80);
    if (this._timeout > 0) {
      this._timeoutTimer = setTimeout(() => {
        this.emit("timeout");
        if (this._socket) {
          this._socket.destroy(new Error("Socket timeout"));
        }
      }, this._timeout);
    }
    try {
      const socksOpts = {
        proxy: this._proxy,
        destination: { host: this.host, port },
        command: "connect"
      };
      const { socket } = await SocksClient.createConnection(socksOpts);
      if (this._aborted) {
        socket.destroy();
        return;
      }
      if (isSecure) {
        if (socket.destroyed) {
          throw new Error("Socket was destroyed before TLS upgrade");
        }
        const rejectUnauthorized = this._options.rejectUnauthorized;
        const tlsSocket = tls.connect({
          socket,
          servername: !net.isIP(this.host) ? this.host : undefined,
          rejectUnauthorized: rejectUnauthorized !== false
        });
        await new Promise((resolve, reject) => {
          const onError = (err) => {
            tlsSocket.removeListener("secureConnect", onSecure);
            socket.removeListener("error", onSocketError);
            socket.removeListener("close", onSocketClose);
            reject(err);
          };
          const onSecure = () => {
            tlsSocket.removeListener("error", onError);
            socket.removeListener("error", onSocketError);
            socket.removeListener("close", onSocketClose);
            resolve();
          };
          const onSocketError = (err) => {
            tlsSocket.removeListener("secureConnect", onSecure);
            tlsSocket.removeListener("error", onError);
            socket.removeListener("close", onSocketClose);
            reject(err);
          };
          const onSocketClose = () => {
            tlsSocket.removeListener("secureConnect", onSecure);
            tlsSocket.removeListener("error", onError);
            socket.removeListener("error", onSocketError);
            reject(new Error("Underlying socket closed during TLS handshake"));
          };
          tlsSocket.once("secureConnect", onSecure);
          tlsSocket.once("error", onError);
          socket.once("error", onSocketError);
          socket.once("close", onSocketClose);
        });
        this._socket = tlsSocket;
      } else {
        this._socket = socket;
      }
      this.emit("socket", this._socket);
      const body = this._body.length > 0 ? Buffer.concat(this._body) : null;
      await this._sendRequest(this._socket, body);
    } catch (err) {
      this._clearTimeout();
      throw err;
    }
  }
  _clearTimeout() {
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
  }
  async _sendRequest(socket, body) {
    return new Promise((resolve, reject) => {
      const lines = [];
      lines.push(`${this.method} ${this.path} HTTP/1.1`);
      const port = this._options.port ? typeof this._options.port === "string" ? parseInt(this._options.port, 10) : this._options.port : this.protocol === "https:" ? 443 : 80;
      const defaultPort = this.protocol === "https:" ? 443 : 80;
      const hostHeader = port === defaultPort ? this.host : `${this.host}:${port}`;
      lines.push(`Host: ${hostHeader}`);
      for (const [key, value] of Object.entries(this._headers)) {
        if (key.toLowerCase() === "host")
          continue;
        if (value === undefined)
          continue;
        if (Array.isArray(value)) {
          for (const v of value) {
            lines.push(`${key}: ${v}`);
          }
        } else {
          lines.push(`${key}: ${value}`);
        }
      }
      if (body && !this._headers["content-length"]) {
        lines.push(`Content-Length: ${body.length}`);
      }
      const requestData = lines.join(`\r
`) + `\r
\r
`;
      let headerBuffer = Buffer.alloc(0);
      let headersParsed = false;
      let response = null;
      let expectedBodyLength = null;
      let receivedBodyLength = 0;
      let isChunked = false;
      let chunkedBuffer = Buffer.alloc(0);
      const cleanup = () => {
        socket.removeListener("data", onData);
        socket.removeListener("error", onError);
        socket.removeListener("close", onClose);
        this._clearTimeout();
      };
      const onData = (chunk) => {
        if (!headersParsed) {
          headerBuffer = Buffer.concat([headerBuffer, chunk]);
          const headerEnd = headerBuffer.indexOf(`\r
\r
`);
          if (headerEnd === -1)
            return;
          const headerData = headerBuffer.subarray(0, headerEnd).toString("utf8");
          const bodyStart = headerBuffer.subarray(headerEnd + 4);
          const firstLine = headerData.split(`\r
`)[0];
          const statusMatch = firstLine.match(/^HTTP\/([\d.]+)\s+(\d+)\s*(.*)?$/);
          if (!statusMatch) {
            cleanup();
            reject(new Error(`Invalid HTTP response: ${firstLine}`));
            return;
          }
          const httpVersion = statusMatch[1];
          const statusCode = parseInt(statusMatch[2], 10);
          const statusMessage = statusMatch[3] || "";
          const headers = {};
          const rawHeaders = [];
          const headerLines = headerData.split(`\r
`).slice(1);
          for (const line of headerLines) {
            const colonIdx = line.indexOf(":");
            if (colonIdx > 0) {
              const name = line.substring(0, colonIdx).trim();
              const value = line.substring(colonIdx + 1).trim();
              const lowerName = name.toLowerCase();
              rawHeaders.push(name, value);
              if (headers[lowerName]) {
                const existing = headers[lowerName];
                if (Array.isArray(existing)) {
                  existing.push(value);
                } else {
                  headers[lowerName] = [existing, value];
                }
              } else {
                headers[lowerName] = value;
              }
            }
          }
          headersParsed = true;
          headerBuffer = Buffer.alloc(0);
          response = new BunSocksIncomingMessage(socket);
          response.httpVersion = httpVersion;
          response.httpVersionMajor = parseInt(httpVersion.split(".")[0], 10);
          response.httpVersionMinor = parseInt(httpVersion.split(".")[1] || "1", 10);
          response._setStatus(statusCode, statusMessage);
          response._setHeaders(headers, rawHeaders);
          this.emit("response", response);
          const contentLength = headers["content-length"];
          const transferEncoding = headers["transfer-encoding"];
          if (transferEncoding?.toLowerCase().includes("chunked")) {
            isChunked = true;
          } else if (contentLength) {
            expectedBodyLength = parseInt(contentLength, 10);
          }
          if (statusCode === 204 || statusCode === 304 || this.method === "HEAD" || expectedBodyLength === 0) {
            cleanup();
            response._finish();
            resolve();
            return;
          }
          if (bodyStart.length > 0) {
            receivedBodyLength = bodyStart.length;
            if (isChunked) {
              chunkedBuffer = bodyStart;
              const result = this._parseChunkedBody(chunkedBuffer);
              for (const decodedChunk of result.newChunks) {
                response._pushChunk(decodedChunk);
              }
              if (result.complete) {
                cleanup();
                response._finish();
                resolve();
                return;
              }
              chunkedBuffer = result.remaining;
            } else if (expectedBodyLength !== null) {
              response._pushChunk(bodyStart);
              if (receivedBodyLength >= expectedBodyLength) {
                cleanup();
                response._finish();
                resolve();
                return;
              }
            } else {
              response._pushChunk(bodyStart);
            }
          }
          return;
        }
        if (!response)
          return;
        receivedBodyLength += chunk.length;
        if (isChunked) {
          chunkedBuffer = Buffer.concat([chunkedBuffer, chunk]);
          const result = this._parseChunkedBody(chunkedBuffer);
          for (const decodedChunk of result.newChunks) {
            response._pushChunk(decodedChunk);
          }
          if (result.complete) {
            cleanup();
            response._finish();
            resolve();
          } else {
            chunkedBuffer = result.remaining;
          }
        } else if (expectedBodyLength !== null) {
          response._pushChunk(chunk);
          if (receivedBodyLength >= expectedBodyLength) {
            cleanup();
            response._finish();
            resolve();
          }
        } else {
          response._pushChunk(chunk);
        }
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const onClose = () => {
        cleanup();
        if (response && !response.complete) {
          response._finish();
        }
        resolve();
      };
      socket.on("data", onData);
      socket.once("error", onError);
      socket.once("close", onClose);
      socket.write(requestData);
      if (body) {
        socket.write(body);
      }
    });
  }
  _parseChunkedBody(data) {
    const newChunks = [];
    let offset = 0;
    while (offset < data.length) {
      const lineEnd = data.indexOf(`\r
`, offset);
      if (lineEnd === -1) {
        return { complete: false, newChunks, remaining: data.subarray(offset) };
      }
      const sizeLine = data.subarray(offset, lineEnd).toString("utf8");
      const chunkSize = parseInt(sizeLine.split(";")[0], 16);
      if (isNaN(chunkSize)) {
        return { complete: false, newChunks, remaining: data.subarray(offset) };
      }
      if (chunkSize === 0) {
        return { complete: true, newChunks, remaining: Buffer.alloc(0) };
      }
      const chunkStart = lineEnd + 2;
      const chunkEnd = chunkStart + chunkSize;
      if (data.length < chunkEnd + 2) {
        return { complete: false, newChunks, remaining: data.subarray(offset) };
      }
      newChunks.push(data.subarray(chunkStart, chunkEnd));
      offset = chunkEnd + 2;
    }
    return { complete: false, newChunks, remaining: Buffer.alloc(0) };
  }
}
function extractProxyFromAgent(agent) {
  if (!agent || typeof agent !== "object")
    return null;
  const proxyAgent = agent;
  if (proxyAgent.proxy && typeof proxyAgent.proxy === "object") {
    return proxyAgent.proxy;
  }
  return null;
}
function parseRequestOptions(urlOrOptions, optionsOrCallback, callback) {
  let options;
  let cb = callback;
  if (typeof urlOrOptions === "string" || urlOrOptions instanceof URL) {
    const url = typeof urlOrOptions === "string" ? new URL(urlOrOptions) : urlOrOptions;
    const baseOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method: "GET"
    };
    if (typeof optionsOrCallback === "function") {
      options = baseOptions;
      cb = optionsOrCallback;
    } else if (optionsOrCallback && typeof optionsOrCallback === "object") {
      options = { ...baseOptions, ...optionsOrCallback };
    } else {
      options = baseOptions;
    }
  } else {
    options = urlOrOptions;
    if (typeof optionsOrCallback === "function") {
      cb = optionsOrCallback;
    }
  }
  return { options, callback: cb };
}
export const bunHttp = {
  request(urlOrOptions, optionsOrCallback, callback) {
    const { options, callback: cb } = parseRequestOptions(urlOrOptions, optionsOrCallback, callback);
    const proxyOpts = extractProxyFromAgent(options.agent);
    if (!proxyOpts) {
      throw new Error("bunHttp.request requires an agent with SOCKS proxy configuration (e.g., SocksProxyAgent)");
    }
    const req = new BunSocksClientRequest(proxyOpts, options);
    if (cb) {
      req.once("response", cb);
    }
    return req;
  },
  get(urlOrOptions, optionsOrCallback, callback) {
    const { options, callback: cb } = parseRequestOptions(urlOrOptions, optionsOrCallback, callback);
    options.method = "GET";
    const req = bunHttp.request(options, cb);
    req.end();
    return req;
  }
};
