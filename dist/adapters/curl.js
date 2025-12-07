import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { spawn, execSync } from "node:child_process";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { RezoError } from '../errors/rezo-error.js';
import { buildSmartError } from '../responses/buildError.js';
import { Cookie } from '../utils/cookies.js';
import RezoFormData from '../utils/form-data.js';
import { existsSync } from "node:fs";
import { getDefaultConfig, prepareHTTPOptions } from '../utils/http-config.js';
import { RezoHeaders } from '../utils/headers.js';
import { StreamResponse } from '../responses/stream.js';
import { DownloadResponse } from '../responses/download.js';
import { UploadResponse } from '../responses/upload.js';
import { RezoPerformance } from '../utils/tools.js';

class CurlCapabilities {
  static instance;
  version = "";
  features = new Set;
  protocols = new Set;
  isInitialized = false;
  isAvailable = { status: false, message: "Initializing" };
  static getInstance() {
    if (!CurlCapabilities.instance) {
      CurlCapabilities.instance = new CurlCapabilities;
    }
    return CurlCapabilities.instance;
  }
  async initialize() {
    if (this.isInitialized) {
      return;
    }
    try {
      this.isAvailable = this.checkCurlAvailability();
      if (!this.isAvailable.status) {
        throw new Error(this.isAvailable.message);
      }
      const { version, features, protocols } = await this.detectCapabilities();
      this.version = version;
      this.features = new Set(features);
      this.protocols = new Set(protocols);
      this.isInitialized = true;
    } catch (error) {
      throw new Error(`cURL not available: ${error.message}`);
    }
  }
  checkCurlAvailability() {
    try {
      const output = execSync("curl --version", { encoding: "utf8", timeout: 5000 });
      return output.includes("curl") ? { status: true } : this.getCurlInstallationMessage();
    } catch {
      return this.getCurlInstallationMessage();
    }
  }
  getCurlInstallationMessage() {
    let message = "cURL is not installed. ";
    const platform = os.platform();
    if (platform === "darwin") {
      message += "Install cURL via Homebrew with 'brew install curl' or use 'xcode-select --install' to install command line tools.";
    } else if (platform === "win32") {
      message += "Install cURL by downloading it from https://curl.se/windows/ or use a package manager like Chocolatey with 'choco install curl'.";
    } else if (platform === "linux") {
      const isDebian = existsSync("/etc/debian_version");
      const isRedHat = existsSync("/etc/redhat-release");
      const isArch = existsSync("/etc/arch-release");
      if (isDebian) {
        message += "Install cURL with 'sudo apt-get install curl'.";
      } else if (isRedHat) {
        message += "Install cURL with 'sudo dnf install curl' or 'sudo yum install curl'.";
      } else if (isArch) {
        message += "Install cURL with 'sudo pacman -S curl'.";
      } else {
        message += "Install cURL using your distribution's package manager.";
      }
    } else {
      message += "Please install cURL from https://curl.se/download.html";
    }
    return { status: false, message };
  }
  async detectCapabilities() {
    return new Promise((resolve, reject) => {
      const curl = spawn("curl", ["--version"]);
      let output = "";
      curl.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      curl.on("error", (error) => {
        reject(new Error(`cURL not found: ${error.message}`));
      });
      curl.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`cURL version check failed with code ${code}`));
          return;
        }
        const lines = output.split(`
`);
        const versionLine = lines[0] || "";
        const versionMatch = versionLine.match(/curl\s+([\d.]+)/);
        const version = versionMatch ? versionMatch[1] : "unknown";
        const features = [];
        const protocols = [];
        let inFeatures = false;
        let inProtocols = false;
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith("Features:")) {
            inFeatures = true;
            inProtocols = false;
            const featuresText = trimmedLine.replace("Features:", "").trim();
            if (featuresText) {
              features.push(...featuresText.split(/\s+/));
            }
          } else if (trimmedLine.startsWith("Protocols:")) {
            inFeatures = false;
            inProtocols = true;
            const protocolsText = trimmedLine.replace("Protocols:", "").trim();
            if (protocolsText) {
              protocols.push(...protocolsText.split(/\s+/));
            }
          } else if (inFeatures && trimmedLine) {
            features.push(...trimmedLine.split(/\s+/));
          } else if (inProtocols && trimmedLine) {
            protocols.push(...trimmedLine.split(/\s+/));
          }
        }
        resolve({ version, features, protocols });
      });
    });
  }
  hasFeature(feature) {
    return this.features.has(feature);
  }
  hasProtocol(protocol) {
    return this.protocols.has(protocol);
  }
  getVersion() {
    return this.version;
  }
  supportsHttp2() {
    return this.hasFeature("HTTP2");
  }
  supportsHttp3() {
    return this.hasFeature("HTTP3") || this.hasFeature("QUIC");
  }
  isAvailableStatus() {
    return this.isAvailable;
  }
  throwIfNotAvailable() {
    if (!this.isAvailable.status) {
      throw new Error(this.isAvailable.message);
    }
  }
}

class CurlProgressTracker extends EventEmitter {
  totalBytes = 0;
  downloadedBytes = 0;
  uploadedBytes = 0;
  downloadSpeed = 0;
  uploadSpeed = 0;
  timeRemaining = 0;
  startTime = Date.now();
  parseProgress(line) {
    const progressMatch = line.match(/\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d:-]+)\s+([\d:-]+)\s+([\d:-]+)\s+(\d+)/);
    if (progressMatch) {
      const [, totalPercent, total, receivedPercent, received, xferPercent, xfer, avgDload, avgUpload, timeTotal, timeSpent, timeLeft, currentSpeed] = progressMatch;
      this.totalBytes = parseInt(total);
      this.downloadedBytes = parseInt(received);
      this.uploadedBytes = parseInt(xfer);
      this.downloadSpeed = parseInt(avgDload);
      this.uploadSpeed = parseInt(avgUpload);
      const progress = {
        total: this.totalBytes,
        loaded: this.downloadedBytes + this.uploadedBytes,
        percentage: this.totalBytes > 0 ? Math.round(this.downloadedBytes / this.totalBytes * 100) : 0,
        speed: parseInt(currentSpeed) || this.downloadSpeed,
        averageSpeed: this.downloadSpeed,
        estimatedTime: this.parseTime(timeLeft) * 1000,
        timestamp: Date.now()
      };
      this.emit("progress", progress);
    }
  }
  parseTime(timeStr) {
    if (timeStr === "--:--:--") {
      return 0;
    }
    const parts = timeStr.split(":").map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return 0;
  }
}

class TempFileManager {
  tempFiles = new Set;
  createTempFile(prefix = "rezo-curl", extension = ".tmp") {
    const tempDir = os.tmpdir();
    const fileName = `${prefix}-${crypto.randomUUID()}${extension}`;
    const filePath = path.join(tempDir, fileName);
    this.tempFiles.add(filePath);
    return filePath;
  }
  cleanup() {
    for (const filePath of this.tempFiles) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {}
    }
    this.tempFiles.clear();
  }
}

class CurlCommandBuilder {
  args = [];
  tempFiles;
  capabilities;
  constructor(tempFiles, capabilities) {
    this.tempFiles = tempFiles;
    this.capabilities = capabilities;
  }
  build(config, originalRequest) {
    this.args = [];
    const createdTempFiles = [];
    this.addArg("-i");
    this.addArg("--show-error");
    this.addArg("--fail-with-body");
    const isVerbose = originalRequest.verbose || config.debug;
    if (isVerbose) {
      this.addArg("-v");
    } else {
      this.addArg("-s");
    }
    if (config.method && config.method !== "GET") {
      this.addArg("-X", config.method.toUpperCase());
    }
    if (config.http2 && this.capabilities.supportsHttp2()) {
      this.addArg("--http2");
    } else {
      this.addArg("--http1.1");
    }
    this.buildTimeouts(config);
    this.buildAuthentication(config, originalRequest);
    this.buildSSLConfig(config, originalRequest);
    this.buildProxyConfig(config);
    const cookieJar = this.buildCookieConfig(config);
    if (cookieJar) {
      createdTempFiles.push(cookieJar);
    }
    if (config.compression?.enabled !== false) {
      this.addArg("--compressed");
    }
    this.buildConnectionOptions(config, originalRequest);
    this.buildDownloadOptions(config, originalRequest, createdTempFiles);
    this.buildHeaders(config);
    this.buildRedirectOptions(config, originalRequest);
    this.buildRequestBody(config, createdTempFiles);
    if (originalRequest.onUploadProgress || originalRequest.onDownloadProgress) {
      this.addArg("--progress-bar");
    }
    this.addArg("-w", this.buildWriteOutFormat());
    return { args: this.args, tempFiles: createdTempFiles, cookieJar };
  }
  addArg(arg, value) {
    this.args.push(arg);
    if (value !== undefined) {
      this.args.push(this.escapeShellArg(value));
    }
  }
  escapeShellArg(str) {
    return str.replace(/["\\$`!]/g, "\\$&");
  }
  buildTimeouts(config) {
    if (config.timeout) {
      this.addArg("--max-time", Math.ceil(config.timeout / 1000).toString());
    }
  }
  buildAuthentication(config, originalRequest) {
    if (!config.auth) {
      return;
    }
    const auth = config.auth;
    const authType = auth.type || "basic";
    switch (authType) {
      case "basic":
        if (auth.username && auth.password) {
          this.addArg("--basic");
          this.addArg("-u", `${auth.username}:${auth.password}`);
        }
        break;
      case "digest":
        if (auth.username && auth.password) {
          this.addArg("--digest");
          this.addArg("-u", `${auth.username}:${auth.password}`);
        }
        break;
      case "ntlm":
        if (auth.username && auth.password) {
          this.addArg("--ntlm");
          this.addArg("-u", `${auth.username}:${auth.password}`);
        }
        break;
      case "bearer":
        if (auth.token) {
          this.addArg("-H", `Authorization: Bearer ${auth.token}`);
        }
        break;
      case "oauth1":
      case "aws4":
      case "custom":
        if (auth.custom) {
          for (const [key, value] of Object.entries(auth.custom)) {
            this.addArg("-H", `${key}: ${value}`);
          }
        }
        break;
    }
  }
  buildSSLConfig(config, originalRequest) {
    if (config.rejectUnauthorized === false || originalRequest.rejectUnauthorized === false) {
      this.addArg("-k");
    }
    const sslOptions = originalRequest.ssl;
    if (!sslOptions) {
      return;
    }
    if (sslOptions.cert) {
      if (typeof sslOptions.cert === "string") {
        this.addArg("--cert", sslOptions.cert);
      } else {
        const certFile = this.tempFiles.createTempFile("cert", ".pem");
        fs.writeFileSync(certFile, sslOptions.cert);
        this.addArg("--cert", certFile);
      }
    }
    if (sslOptions.key) {
      if (typeof sslOptions.key === "string") {
        this.addArg("--key", sslOptions.key);
      } else {
        const keyFile = this.tempFiles.createTempFile("key", ".pem");
        fs.writeFileSync(keyFile, sslOptions.key);
        this.addArg("--key", keyFile);
      }
    }
    if (sslOptions.ca) {
      const caData = Array.isArray(sslOptions.ca) ? sslOptions.ca.join(`
`) : sslOptions.ca;
      if (typeof caData === "string") {
        this.addArg("--cacert", caData);
      } else {
        const caFile = this.tempFiles.createTempFile("ca", ".pem");
        fs.writeFileSync(caFile, caData);
        this.addArg("--cacert", caFile);
      }
    }
    if (sslOptions.passphrase) {
      this.addArg("--pass", sslOptions.passphrase);
    }
    if (sslOptions.ciphers) {
      this.addArg("--ciphers", sslOptions.ciphers);
    }
  }
  buildProxyConfig(config) {
    if (!config.proxy) {
      return;
    }
    const proxy = config.proxy;
    if (typeof proxy === "string") {
      try {
        const url = new URL(proxy);
        this.configureProxyByProtocol(url.protocol.replace(":", ""), url.hostname, url.port, url.username, url.password);
      } catch (error) {
        this.addArg("--proxy", proxy);
      }
      return;
    }
    const proxyOpts = proxy;
    this.configureProxyByProtocol(proxyOpts.protocol, proxyOpts.host, proxyOpts.port?.toString(), proxyOpts.auth?.username, proxyOpts.auth?.password);
  }
  configureProxyByProtocol(protocol, host, port, username, password) {
    const portNum = port || this.getDefaultProxyPort(protocol);
    const hostPort = `${host}:${portNum}`;
    const auth = username && password ? `${username}:${password}` : undefined;
    switch (protocol.toLowerCase()) {
      case "socks":
      case "socks5":
      case "socks5h":
        this.addArg("--socks5", hostPort);
        if (auth) {
          this.addArg("--socks5-user", auth);
        }
        break;
      case "socks4":
      case "socks4a":
        this.addArg("--socks4", hostPort);
        if (username) {
          this.addArg("--socks4-user", username);
        }
        break;
      case "http":
      case "https":
        const proxyUrl = `${protocol}://${host}:${portNum}`;
        this.addArg("--proxy", proxyUrl);
        if (auth) {
          this.addArg("--proxy-user", auth);
        }
        break;
      default:
        const defaultUrl = `http://${host}:${portNum}`;
        this.addArg("--proxy", defaultUrl);
        if (auth) {
          this.addArg("--proxy-user", auth);
        }
        break;
    }
  }
  getDefaultProxyPort(protocol) {
    switch (protocol.toLowerCase()) {
      case "socks":
      case "socks4":
      case "socks4a":
      case "socks5":
      case "socks5h":
        return "1080";
      case "https":
        return "443";
      case "http":
      default:
        return "8080";
    }
  }
  buildCookieConfig(config) {
    if (!config.enableCookieJar) {
      return;
    }
    const cookieJarFile = this.tempFiles.createTempFile("cookies", ".txt");
    fs.writeFileSync(cookieJarFile, "");
    this.addArg("-b", cookieJarFile);
    this.addArg("-c", cookieJarFile);
    if (config.requestCookies && config.requestCookies.length > 0) {
      const cookieString = config.requestCookies.map((c) => `${c.key}=${c.value}`).join("; ");
      this.addArg("-b", cookieString);
    }
    return cookieJarFile;
  }
  buildConnectionOptions(config, originalRequest) {
    if (originalRequest.keepAlive === false) {
      this.addArg("-H", "Connection: close");
    } else {
      this.addArg("-H", "Connection: keep-alive");
    }
  }
  buildDownloadOptions(config, originalRequest, tempFiles) {
    const saveTo = originalRequest.saveTo || config.fileName;
    if (saveTo) {
      this.addArg("-o", saveTo);
    }
  }
  buildHeaders(config) {
    if (!config.headers) {
      return;
    }
    const headers = config.headers;
    if (headers instanceof RezoHeaders) {
      for (const [key, value] of headers.entries()) {
        if (value !== undefined && value !== null) {
          this.addArg("-H", `${key}: ${value}`);
        }
      }
    } else if (typeof headers === "object") {
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined && value !== null) {
          const headerValue = Array.isArray(value) ? value.join(", ") : String(value);
          this.addArg("-H", `${key}: ${headerValue}`);
        }
      }
    }
  }
  buildRedirectOptions(config, originalRequest) {
    const followRedirects = originalRequest.followRedirects !== false;
    if (followRedirects) {
      this.addArg("-L");
      if (config.maxRedirects && config.maxRedirects > 0) {
        this.addArg("--max-redirs", config.maxRedirects.toString());
      }
    } else {
      this.addArg("--max-redirs", "0");
    }
  }
  buildRequestBody(config, tempFiles) {
    if (!config.data) {
      return;
    }
    const data = config.data;
    if (typeof data === "string") {
      this.addArg("-d", data);
    } else if (Buffer.isBuffer(data)) {
      const dataFile = this.tempFiles.createTempFile("data", ".bin");
      fs.writeFileSync(dataFile, data);
      tempFiles.push(dataFile);
      this.addArg("--data-binary", `@${dataFile}`);
    } else if (data instanceof RezoFormData) {
      const formData = data;
      const knownLength = formData.getLengthSync?.() || 0;
      const formDataFile = this.tempFiles.createTempFile("formdata", ".txt");
      const formBuffer = formData.getBuffer?.();
      if (formBuffer) {
        fs.writeFileSync(formDataFile, formBuffer);
        tempFiles.push(formDataFile);
        this.addArg("--data-binary", `@${formDataFile}`);
        const boundary = formData.getBoundary?.();
        if (boundary) {
          this.addArg("-H", `Content-Type: multipart/form-data; boundary=${boundary}`);
        }
      }
    } else if (data instanceof Readable) {
      this.addArg("-d", "@-");
    } else if (typeof data === "object") {
      this.addArg("-d", JSON.stringify(data));
    }
  }
  buildWriteOutFormat() {
    return [
      "\\n---CURL_STATS_START---",
      "http_code:%{http_code}",
      "time_namelookup:%{time_namelookup}",
      "time_connect:%{time_connect}",
      "time_appconnect:%{time_appconnect}",
      "time_pretransfer:%{time_pretransfer}",
      "time_starttransfer:%{time_starttransfer}",
      "time_total:%{time_total}",
      "size_download:%{size_download}",
      "size_upload:%{size_upload}",
      "speed_download:%{speed_download}",
      "speed_upload:%{speed_upload}",
      "remote_ip:%{remote_ip}",
      "remote_port:%{remote_port}",
      "local_ip:%{local_ip}",
      "local_port:%{local_port}",
      "redirect_url:%{redirect_url}",
      "ssl_verify_result:%{ssl_verify_result}",
      "content_type:%{content_type}",
      "---CURL_STATS_END---"
    ].join("\\n");
  }
}

class CurlResponseParser {
  static parse(stdout, stderr, config, originalRequest) {
    const statsMarker = "---CURL_STATS_START---";
    const statsEndMarker = "---CURL_STATS_END---";
    let body = stdout;
    let stats = {};
    const statsStart = stdout.indexOf(statsMarker);
    const statsEnd = stdout.indexOf(statsEndMarker);
    if (statsStart !== -1 && statsEnd !== -1) {
      const statsSection = stdout.slice(statsStart + statsMarker.length, statsEnd);
      body = stdout.slice(0, statsStart);
      for (const line of statsSection.split(`
`)) {
        const [key, value] = line.split(":");
        if (key && value !== undefined) {
          stats[key.trim()] = value.trim();
        }
      }
    }
    const headerBodySplit = body.indexOf(`\r
\r
`);
    let headerSection = "";
    let responseBody = body;
    if (headerBodySplit !== -1) {
      headerSection = body.slice(0, headerBodySplit);
      responseBody = body.slice(headerBodySplit + 4);
    }
    const statusMatch = headerSection.match(/HTTP\/[\d.]+ (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1]) : parseInt(stats["http_code"]) || 200;
    const statusText = this.getStatusText(status);
    const headers = this.parseHeaders(headerSection);
    const rezoHeaders = new RezoHeaders(headers);
    const cookies = this.parseCookies(headers);
    let data;
    const contentType = stats["content_type"] || rezoHeaders.get("content-type") || "";
    const responseType = config.responseType || originalRequest.responseType || "auto";
    if (responseType === "json" || responseType === "auto" && contentType.includes("application/json")) {
      try {
        data = JSON.parse(responseBody.trim());
      } catch {
        data = responseBody;
      }
    } else if (responseType === "buffer" || responseType === "binary" || responseType === "arrayBuffer") {
      data = Buffer.from(responseBody);
    } else {
      data = responseBody;
    }
    const totalMs = parseFloat(stats["time_total"]) * 1000 || 0;
    const timing = {
      startTimestamp: config.timing?.startTimestamp || Date.now(),
      endTimestamp: Date.now(),
      dnsMs: parseFloat(stats["time_namelookup"]) * 1000 || 0,
      tcpMs: (parseFloat(stats["time_connect"]) - parseFloat(stats["time_namelookup"])) * 1000 || 0,
      tlsMs: (parseFloat(stats["time_appconnect"]) - parseFloat(stats["time_connect"])) * 1000 || 0,
      ttfbMs: parseFloat(stats["time_starttransfer"]) * 1000 || 0,
      transferMs: (parseFloat(stats["time_total"]) - parseFloat(stats["time_starttransfer"])) * 1000 || 0,
      durationMs: totalMs
    };
    config.timing = timing;
    const urls = [config.url];
    if (stats["redirect_url"]) {
      urls.push(stats["redirect_url"]);
    }
    return {
      data,
      status,
      statusText,
      headers: rezoHeaders,
      cookies,
      config,
      contentType: contentType || undefined,
      contentLength: parseInt(stats["size_download"]) || responseBody.length,
      finalUrl: stats["redirect_url"] || config.url,
      urls
    };
  }
  static parseHeaders(headerSection) {
    const headers = {};
    const headerLines = headerSection.split(`
`).slice(1);
    for (const line of headerLines) {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim().toLowerCase();
        const value = line.slice(colonIndex + 1).trim();
        const existing = headers[key];
        if (existing !== undefined) {
          headers[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
        } else {
          headers[key] = value;
        }
      }
    }
    return headers;
  }
  static getStatusText(status) {
    const statusTexts = {
      200: "OK",
      201: "Created",
      204: "No Content",
      301: "Moved Permanently",
      302: "Found",
      304: "Not Modified",
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      405: "Method Not Allowed",
      429: "Too Many Requests",
      500: "Internal Server Error",
      502: "Bad Gateway",
      503: "Service Unavailable",
      504: "Gateway Timeout"
    };
    return statusTexts[status] || "Unknown";
  }
  static parseCookies(headers) {
    const setCookieHeaders = headers["set-cookie"];
    const cookieArray = [];
    if (setCookieHeaders) {
      if (Array.isArray(setCookieHeaders)) {
        cookieArray.push(...setCookieHeaders);
      } else {
        cookieArray.push(setCookieHeaders);
      }
    }
    const parsedCookies = cookieArray.map((c) => Cookie.parse(c)).filter(Boolean);
    return {
      array: parsedCookies,
      serialized: parsedCookies.map((c) => c.toJSON()),
      netscape: "",
      string: parsedCookies.map((c) => `${c.key}=${c.value}`).join("; "),
      setCookiesString: cookieArray
    };
  }
}

class CurlExecutor {
  tempFileManager;
  capabilities;
  constructor() {
    this.tempFileManager = new TempFileManager;
    this.capabilities = CurlCapabilities.getInstance();
  }
  async execute(config, originalRequest, streamResult, downloadResult, uploadResult) {
    await this.capabilities.initialize();
    const builder = new CurlCommandBuilder(this.tempFileManager, this.capabilities);
    const { args, tempFiles, cookieJar } = builder.build(config, originalRequest);
    const finalUrl = this.buildFinalUrl(config);
    args.push(finalUrl);
    try {
      return await this.executeCurlCommand(args, config, originalRequest, tempFiles, cookieJar, streamResult, downloadResult, uploadResult);
    } finally {
      this.tempFileManager.cleanup();
    }
  }
  buildFinalUrl(config) {
    let url = config.url;
    if (config.baseURL) {
      url = config.baseURL.replace(/\/$/, "") + "/" + url.replace(/^\//, "");
    }
    if (config.params && Object.keys(config.params).length > 0) {
      const urlParams = new URLSearchParams;
      for (const [key, value] of Object.entries(config.params)) {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            for (const item of value) {
              urlParams.append(key, String(item));
            }
          } else {
            urlParams.append(key, String(value));
          }
        }
      }
      const paramString = urlParams.toString();
      if (paramString) {
        url += (url.includes("?") ? "&" : "?") + paramString;
      }
    }
    return url;
  }
  async executeCurlCommand(args, config, originalRequest, tempFiles, cookieJar, streamResult, downloadResult, uploadResult) {
    return new Promise((resolve, reject) => {
      const isStreaming = !!streamResult;
      const isDownload = !!downloadResult;
      const isUpload = !!uploadResult;
      const curl = spawn("curl", args, {
        stdio: ["pipe", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      const progressTracker = new CurlProgressTracker;
      const startTime = performance.now();
      if (originalRequest.onDownloadProgress) {
        progressTracker.on("progress", (progress) => {
          originalRequest.onDownloadProgress(progress);
          if (streamResult) {
            streamResult.emit("progress", progress);
          }
          if (downloadResult) {
            downloadResult.emit("progress", progress);
          }
        });
      }
      if (originalRequest.onUploadProgress) {
        progressTracker.on("progress", (progress) => {
          if (progress.loaded > 0) {
            originalRequest.onUploadProgress(progress);
            if (uploadResult) {
              uploadResult.emit("progress", progress);
            }
          }
        });
      }
      curl.stdout.on("data", (chunk) => {
        if (isStreaming && streamResult) {
          streamResult.emit("data", chunk);
          stdout += chunk.toString();
        } else {
          stdout += chunk.toString();
        }
      });
      curl.stderr.on("data", (chunk) => {
        const data = chunk.toString();
        stderr += data;
        const lines = data.split(`
`);
        for (const line of lines) {
          progressTracker.parseProgress(line);
        }
      });
      curl.on("error", (error) => {
        const rezoError = buildSmartError(config, originalRequest, error);
        if (streamResult) {
          streamResult.emit("error", rezoError);
        }
        if (downloadResult) {
          downloadResult.emit("error", rezoError);
        }
        if (uploadResult) {
          uploadResult.emit("error", rezoError);
        }
        reject(rezoError);
      });
      curl.on("close", (code) => {
        try {
          if (code !== 0 && code !== null) {
            const errorCode = this.mapCurlErrorCode(code);
            const errorMessage = this.buildDetailedErrorMessage(code, stderr, config);
            const rezoError = new RezoError(errorMessage, config, errorCode);
            if (streamResult)
              streamResult.emit("error", rezoError);
            if (downloadResult)
              downloadResult.emit("error", rezoError);
            if (uploadResult)
              uploadResult.emit("error", rezoError);
            reject(rezoError);
            return;
          }
          const response = CurlResponseParser.parse(stdout, stderr, config, originalRequest);
          if (isStreaming && streamResult) {
            const finishEvent = {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              contentType: response.contentType,
              contentLength: response.contentLength,
              finalUrl: response.finalUrl,
              cookies: response.cookies,
              urls: response.urls,
              timing: {
                total: performance.now() - startTime,
                firstByte: config.timing?.ttfbMs,
                dns: config.timing?.dnsMs,
                tcp: config.timing?.tcpMs,
                tls: config.timing?.tlsMs,
                download: config.timing?.transferMs
              },
              config
            };
            streamResult.emit("finish", finishEvent);
            streamResult.emit("done", finishEvent);
            resolve(streamResult);
            return;
          }
          if (isDownload && downloadResult) {
            const fileName = config.fileName || originalRequest.saveTo || "";
            const fileSize = response.contentLength;
            const finishEvent = {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              contentType: response.contentType,
              contentLength: fileSize,
              finalUrl: response.finalUrl,
              cookies: response.cookies,
              urls: response.urls,
              fileName,
              fileSize,
              timing: {
                total: performance.now() - startTime,
                firstByte: config.timing?.ttfbMs,
                dns: config.timing?.dnsMs,
                tcp: config.timing?.tcpMs,
                tls: config.timing?.tlsMs,
                download: performance.now() - startTime
              },
              averageSpeed: fileSize / ((performance.now() - startTime) / 1000),
              config
            };
            downloadResult.emit("finish", finishEvent);
            downloadResult.emit("done", finishEvent);
            resolve(downloadResult);
            return;
          }
          if (isUpload && uploadResult) {
            const finishEvent = {
              response: {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                data: response.data,
                contentType: response.contentType,
                contentLength: response.contentLength
              },
              finalUrl: response.finalUrl,
              cookies: response.cookies,
              urls: response.urls,
              uploadSize: config.transfer?.requestSize || 0,
              timing: {
                total: performance.now() - startTime,
                dns: config.timing?.dnsMs,
                tcp: config.timing?.tcpMs,
                tls: config.timing?.tlsMs,
                upload: performance.now() - startTime,
                waiting: 0
              },
              averageUploadSpeed: (config.transfer?.requestSize || 0) / ((performance.now() - startTime) / 1000),
              config
            };
            uploadResult.emit("finish", finishEvent);
            uploadResult.emit("done", finishEvent);
            resolve(uploadResult);
            return;
          }
          resolve(response);
        } catch (error) {
          const rezoError = buildSmartError(config, originalRequest, error);
          if (streamResult)
            streamResult.emit("error", rezoError);
          if (downloadResult)
            downloadResult.emit("error", rezoError);
          if (uploadResult)
            uploadResult.emit("error", rezoError);
          reject(rezoError);
        }
      });
      if (config.signal) {
        const abortHandler = () => {
          curl.kill("SIGKILL");
          const abortError = RezoError.createAbortError("Request aborted", config);
          if (streamResult)
            streamResult.emit("error", abortError);
          if (downloadResult)
            downloadResult.emit("error", abortError);
          if (uploadResult)
            uploadResult.emit("error", abortError);
          reject(abortError);
        };
        if (config.signal.aborted) {
          abortHandler();
          return;
        }
        config.signal.addEventListener("abort", abortHandler);
      }
      if (config.data && config.data instanceof Readable) {
        config.data.pipe(curl.stdin);
      } else {
        curl.stdin.end();
      }
    });
  }
  mapCurlErrorCode(code) {
    const errorMap = {
      1: "ERR_INVALID_PROTOCOL",
      2: "REZ_UNKNOWN_ERROR",
      3: "ERR_INVALID_URL",
      5: "REZ_PROXY_CONNECTION_FAILED",
      6: "ENOTFOUND",
      7: "ECONNREFUSED",
      22: "REZ_HTTP_ERROR",
      28: "ETIMEDOUT",
      35: "ERR_TLS_HANDSHAKE_TIMEOUT",
      51: "ERR_TLS_CERT_ALTNAME_INVALID",
      52: "ERR_STREAM_DESTROYED",
      55: "ERR_STREAM_PREMATURE_CLOSE",
      56: "ERR_STREAM_DESTROYED",
      58: "REZ_PROXY_AUTHENTICATION_FAILED",
      60: "CERT_HAS_EXPIRED",
      77: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      91: "REZ_SOCKS_PROTOCOL_ERROR",
      97: "REZ_PROXY_TARGET_UNREACHABLE"
    };
    return errorMap[code] || "REZ_UNKNOWN_ERROR";
  }
  buildDetailedErrorMessage(code, stderr, config) {
    const baseMessage = `cURL request failed (exit code ${code})`;
    const stderrLines = stderr.split(`
`).filter((line) => line.trim());
    const errorLines = stderrLines.filter((line) => line.includes("curl:") || line.includes("error:") || line.includes("failed:") || line.includes("timeout") || line.includes("refused") || line.includes("not found"));
    if (errorLines.length > 0) {
      const primaryError = errorLines[0].replace(/^curl:\s*\(\d+\)\s*/, "").trim();
      return `${baseMessage}: ${primaryError}`;
    }
    return `${baseMessage} for ${config.method?.toUpperCase() || "GET"} ${config.url}`;
  }
}
export async function executeRequest(options, defaultOptions, jar) {
  if (!options.responseType) {
    options.responseType = "auto";
  }
  const d_options = await getDefaultConfig(defaultOptions);
  const configResult = prepareHTTPOptions(options, jar, { defaultOptions: d_options });
  const config = configResult.config;
  const originalRequest = configResult.fetchOptions;
  const perform = new RezoPerformance;
  const isStream = options._isStream;
  const isDownload = options._isDownload || !!options.fileName || !!options.saveTo;
  const isUpload = options._isUpload;
  let streamResponse;
  let downloadResponse;
  let uploadResponse;
  if (isStream) {
    streamResponse = new StreamResponse;
  } else if (isDownload) {
    const fileName = options.fileName || options.saveTo || "";
    const url = typeof originalRequest.url === "string" ? originalRequest.url : originalRequest.url.toString();
    downloadResponse = new DownloadResponse(fileName, url);
  } else if (isUpload) {
    const url = typeof originalRequest.url === "string" ? originalRequest.url : originalRequest.url.toString();
    uploadResponse = new UploadResponse(url);
  }
  const eventEmitter = streamResponse || downloadResponse || uploadResponse;
  if (eventEmitter) {
    eventEmitter.emit("initiated");
  }
  const executor = new CurlExecutor;
  try {
    const result = await executor.execute(config, originalRequest, streamResponse, downloadResponse, uploadResponse);
    if (!streamResponse && !downloadResponse && !uploadResponse) {
      const response = result;
      if (config.retry && response.status >= 400) {
        const maxRetries = config.retry.maxRetries || 0;
        const statusCodes = config.retry.statusCodes || [408, 429, 500, 502, 503, 504];
        if (config.retryAttempts < maxRetries && statusCodes.includes(response.status)) {
          const retryDelay = config.retry.retryDelay || 0;
          const incrementDelay = config.retry.incrementDelay || false;
          const delay = incrementDelay ? retryDelay * (config.retryAttempts + 1) : retryDelay;
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          config.retryAttempts++;
          return executeRequest(options, defaultOptions, jar);
        }
      }
    }
    return result;
  } catch (error) {
    if (error instanceof RezoError) {
      throw error;
    }
    throw buildSmartError(config, originalRequest, error);
  }
}

export { CurlCapabilities, CurlExecutor, CurlCommandBuilder };
