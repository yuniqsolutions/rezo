import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { spawn, execSync } from "node:child_process";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { RezoError } from '../errors/rezo-error.js';
import { buildSmartError, builErrorFromResponse } from '../responses/buildError.js';
import { RezoCookieJar, Cookie } from '../utils/cookies.js';
import RezoFormData from '../utils/form-data.js';
import { existsSync } from "node:fs";
import { getDefaultConfig, prepareHTTPOptions } from '../utils/http-config.js';
import { RezoHeaders } from '../utils/headers.js';
import { StreamResponse } from '../responses/stream.js';
import { DownloadResponse } from '../responses/download.js';
import { UploadResponse } from '../responses/upload.js';
import { RezoPerformance } from '../utils/tools.js';
function mergeRequestAndResponseCookies(requestCookies, responseCookies) {
  if (!requestCookies || requestCookies.length === 0) {
    return responseCookies;
  }
  if (responseCookies.length === 0) {
    return requestCookies;
  }
  const cookieMap = new Map;
  for (const cookie of requestCookies) {
    const key = `${cookie.key}|${cookie.domain || ""}`;
    cookieMap.set(key, cookie);
  }
  for (const cookie of responseCookies) {
    const key = `${cookie.key}|${cookie.domain || ""}`;
    cookieMap.set(key, cookie);
  }
  return Array.from(cookieMap.values());
}

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
    this.buildRequestBody(config, originalRequest, createdTempFiles);
    if (originalRequest.onUploadProgress || originalRequest.onDownloadProgress) {
      this.addArg("--progress-bar");
    }
    this.applyCurlOptions(originalRequest.curl);
    this.addArg("-w", this.buildWriteOutFormat());
    return { args: this.args, tempFiles: createdTempFiles, cookieJar };
  }
  applyCurlOptions(curlOpts) {
    if (!curlOpts) {
      return;
    }
    if (curlOpts.connectTimeout !== undefined) {
      this.replaceArg("--connect-timeout", curlOpts.connectTimeout.toString());
    }
    if (curlOpts.maxTime !== undefined) {
      this.replaceArg("--max-time", curlOpts.maxTime.toString());
    }
    if (curlOpts.expect100Timeout !== undefined) {
      this.addArg("--expect100-timeout", curlOpts.expect100Timeout.toString());
    }
    if (curlOpts.keepaliveTime !== undefined) {
      this.addArg("--keepalive-time", curlOpts.keepaliveTime.toString());
    }
    if (curlOpts.noKeepalive === true) {
      this.addArg("--no-keepalive");
    }
    if (curlOpts.tcpFastOpen === true) {
      this.addArg("--tcp-fastopen");
    }
    if (curlOpts.tcpNodelay === true) {
      this.addArg("--tcp-nodelay");
    }
    if (curlOpts.limitRate) {
      this.addArg("--limit-rate", curlOpts.limitRate);
    }
    if (curlOpts.speedLimit) {
      this.addArg("--speed-limit", curlOpts.speedLimit.limit.toString());
      if (curlOpts.speedLimit.time !== undefined) {
        this.addArg("--speed-time", curlOpts.speedLimit.time.toString());
      }
    }
    if (curlOpts.retry) {
      if (curlOpts.retry.attempts !== undefined) {
        this.addArg("--retry", curlOpts.retry.attempts.toString());
      }
      if (curlOpts.retry.delay !== undefined) {
        this.addArg("--retry-delay", curlOpts.retry.delay.toString());
      }
      if (curlOpts.retry.maxTime !== undefined) {
        this.addArg("--retry-max-time", curlOpts.retry.maxTime.toString());
      }
      if (curlOpts.retry.allErrors === true) {
        this.addArg("--retry-all-errors");
      }
      if (curlOpts.retry.connRefused === true) {
        this.addArg("--retry-connrefused");
      }
    }
    if (curlOpts.interface) {
      this.addArg("--interface", curlOpts.interface);
    }
    if (curlOpts.localAddress) {
      this.addArg("--local-address", curlOpts.localAddress);
    }
    if (curlOpts.localPort !== undefined) {
      if (typeof curlOpts.localPort === "number") {
        this.addArg("--local-port", curlOpts.localPort.toString());
      } else {
        const portRange = curlOpts.localPort.end ? `${curlOpts.localPort.start}-${curlOpts.localPort.end}` : curlOpts.localPort.start.toString();
        this.addArg("--local-port", portRange);
      }
    }
    if (curlOpts.ipVersion) {
      switch (curlOpts.ipVersion) {
        case "v4":
          this.addArg("--ipv4");
          break;
        case "v6":
          this.addArg("--ipv6");
          break;
      }
    }
    if (curlOpts.resolve) {
      for (const entry of curlOpts.resolve) {
        if (typeof entry === "string") {
          this.addArg("--resolve", entry);
        } else {
          const resolveEntry = entry;
          this.addArg("--resolve", `${resolveEntry.host}:${resolveEntry.port}:${resolveEntry.address}`);
        }
      }
    }
    if (curlOpts.connectTo) {
      for (const entry of curlOpts.connectTo) {
        if (typeof entry === "string") {
          this.addArg("--connect-to", entry);
        } else {
          const connectEntry = entry;
          this.addArg("--connect-to", `${connectEntry.host}:${connectEntry.port}:${connectEntry.connectHost}:${connectEntry.connectPort}`);
        }
      }
    }
    if (curlOpts.noProxy) {
      const noProxyValue = Array.isArray(curlOpts.noProxy) ? curlOpts.noProxy.join(",") : curlOpts.noProxy;
      this.addArg("--noproxy", noProxyValue);
    }
    if (curlOpts.unixSocket) {
      this.addArg("--unix-socket", curlOpts.unixSocket);
    }
    if (curlOpts.abstractUnixSocket) {
      this.addArg("--abstract-unix-socket", curlOpts.abstractUnixSocket);
    }
    if (curlOpts.happyEyeballsTimeout !== undefined) {
      this.addArg("--happy-eyeballs-timeout-ms", curlOpts.happyEyeballsTimeout.toString());
    }
    if (curlOpts.httpVersion) {
      this.removeArg("--http1.1");
      this.removeArg("--http2");
      switch (curlOpts.httpVersion) {
        case "1.0":
          this.addArg("--http1.0");
          break;
        case "1.1":
          this.addArg("--http1.1");
          break;
        case "2":
          this.addArg("--http2");
          break;
        case "2-prior-knowledge":
          this.addArg("--http2-prior-knowledge");
          break;
        case "3":
          this.addArg("--http3");
          break;
        case "3-only":
          this.addArg("--http3-only");
          break;
      }
    }
    if (curlOpts.pathAsIs === true) {
      this.addArg("--path-as-is");
    }
    if (curlOpts.requestTarget) {
      this.addArg("--request-target", curlOpts.requestTarget);
    }
    if (curlOpts.globOff === true) {
      this.addArg("--globoff");
    }
    if (curlOpts.sslVersion) {
      this.applySslVersion(curlOpts.sslVersion);
    }
    if (curlOpts.tlsMin) {
      this.addArg("--tls-min", curlOpts.tlsMin.replace("tlsv", ""));
    }
    if (curlOpts.tlsMax) {
      this.addArg("--tls-max", curlOpts.tlsMax.replace("tlsv", ""));
    }
    if (curlOpts.tls13Ciphers) {
      this.addArg("--tls13-ciphers", curlOpts.tls13Ciphers);
    }
    if (curlOpts.ciphers) {
      this.addArg("--ciphers", curlOpts.ciphers);
    }
    if (curlOpts.pinnedPubKey) {
      const keys = Array.isArray(curlOpts.pinnedPubKey) ? curlOpts.pinnedPubKey.join(";") : curlOpts.pinnedPubKey;
      this.addArg("--pinnedpubkey", keys);
    }
    if (curlOpts.certStatus === true) {
      this.addArg("--cert-status");
    }
    if (curlOpts.crlfile) {
      this.addArg("--crlfile", curlOpts.crlfile);
    }
    if (curlOpts.alpn) {
      const protocols = Array.isArray(curlOpts.alpn) ? curlOpts.alpn.join(",") : curlOpts.alpn;
      this.addArg("--alpn", protocols);
    }
    if (curlOpts.noAlpn === true) {
      this.addArg("--no-alpn");
    }
    if (curlOpts.sessionId === false) {
      this.addArg("--no-sessionid");
    }
    if (curlOpts.engine) {
      this.addArg("--engine", curlOpts.engine);
    }
    if (curlOpts.capath) {
      this.addArg("--capath", curlOpts.capath);
    }
    if (curlOpts.certType) {
      this.addArg("--cert-type", curlOpts.certType);
    }
    if (curlOpts.keyType) {
      this.addArg("--key-type", curlOpts.keyType);
    }
    if (curlOpts.proxyHeaders) {
      for (const [key, value] of Object.entries(curlOpts.proxyHeaders)) {
        this.addArg("--proxy-header", `${key}: ${value}`);
      }
    }
    if (curlOpts.proxyTls) {
      if (curlOpts.proxyTls.version) {
        this.applyProxySslVersion(curlOpts.proxyTls.version);
      }
      if (curlOpts.proxyTls.cert) {
        this.addArg("--proxy-cert", curlOpts.proxyTls.cert);
      }
      if (curlOpts.proxyTls.key) {
        this.addArg("--proxy-key", curlOpts.proxyTls.key);
      }
      if (curlOpts.proxyTls.cacert) {
        this.addArg("--proxy-cacert", curlOpts.proxyTls.cacert);
      }
      if (curlOpts.proxyTls.insecure === true) {
        this.addArg("--proxy-insecure");
      }
    }
    if (curlOpts.dns) {
      if (curlOpts.dns.servers) {
        this.addArg("--dns-servers", curlOpts.dns.servers);
      }
      if (curlOpts.dns.dohUrl) {
        this.addArg("--doh-url", curlOpts.dns.dohUrl);
      }
      if (curlOpts.dns.dohInsecure === true) {
        this.addArg("--doh-insecure");
      }
      if (curlOpts.dns.interface) {
        this.addArg("--dns-interface", curlOpts.dns.interface);
      }
      if (curlOpts.dns.ipv4Addr) {
        this.addArg("--dns-ipv4-addr", curlOpts.dns.ipv4Addr);
      }
      if (curlOpts.dns.ipv6Addr) {
        this.addArg("--dns-ipv6-addr", curlOpts.dns.ipv6Addr);
      }
    }
    if (curlOpts.hsts?.file) {
      this.addArg("--hsts", curlOpts.hsts.file);
    }
    if (curlOpts.altSvc) {
      this.addArg("--alt-svc", curlOpts.altSvc);
    }
    if (curlOpts.noAltSvc === true) {
      this.addArg("--no-alt-svc");
    }
    if (curlOpts.locationTrusted === true) {
      this.addArg("--location-trusted");
    }
    if (curlOpts.junkSessionCookies === true) {
      this.addArg("--junk-session-cookies");
    }
    if (curlOpts.fail === true) {
      this.addArg("--fail");
    }
    if (curlOpts.verbose === true) {
      this.removeArg("-s");
      this.addArg("-v");
    }
    if (curlOpts.trace) {
      this.addArg("--trace", curlOpts.trace);
    }
    if (curlOpts.traceTime === true) {
      this.addArg("--trace-time");
    }
    if (curlOpts.raw === true) {
      this.addArg("--raw");
    }
    if (curlOpts.noCompressed === true) {
      this.removeArg("--compressed");
    }
    if (curlOpts.bufferSize) {
      this.addArg("--buffer-size", curlOpts.bufferSize);
    }
    if (curlOpts.maxFilesize !== undefined) {
      this.addArg("--max-filesize", curlOpts.maxFilesize.toString());
    }
    if (curlOpts.netrc !== undefined) {
      if (curlOpts.netrc === true) {
        this.addArg("--netrc");
      } else if (curlOpts.netrc === "optional") {
        this.addArg("--netrc-optional");
      } else if (typeof curlOpts.netrc === "string") {
        this.addArg("--netrc-file", curlOpts.netrc);
      }
    }
    if (curlOpts.netns) {
      this.addArg("--netns", curlOpts.netns);
    }
    if (curlOpts.delegation) {
      this.addArg("--delegation", curlOpts.delegation);
    }
    if (curlOpts.serviceName) {
      this.addArg("--service-name", curlOpts.serviceName);
    }
    if (curlOpts.negotiate === true) {
      this.addArg("--negotiate");
    }
    if (curlOpts.saslIr === true) {
      this.addArg("--sasl-ir");
    }
    if (curlOpts.compressedSsh === true) {
      this.addArg("--compressed-ssh");
    }
    if (curlOpts.parallel) {
      if (curlOpts.parallel.enabled) {
        this.addArg("--parallel");
        if (curlOpts.parallel.max !== undefined) {
          this.addArg("--parallel-max", curlOpts.parallel.max.toString());
        }
        if (curlOpts.parallel.immediate === true) {
          this.addArg("--parallel-immediate");
        }
      }
    }
    if (curlOpts.tls) {
      this.applyTlsOptions(curlOpts.tls);
    }
    if (curlOpts.proxyTls) {
      this.applyProxyTlsOptions(curlOpts.proxyTls);
    }
    if (curlOpts.preProxy) {
      this.addArg("--preproxy", curlOpts.preProxy);
    }
    if (curlOpts.socks5Gssapi === true) {
      this.addArg("--socks5-gssapi");
    }
    if (curlOpts.socks5GssapiService) {
      this.addArg("--socks5-gssapi-service", curlOpts.socks5GssapiService);
    }
    if (curlOpts.proxyHttp10 === true) {
      this.addArg("--proxy1.0");
    }
    if (curlOpts.proxyDigest === true) {
      this.addArg("--proxy-digest");
    }
    if (curlOpts.proxyBasic === true) {
      this.addArg("--proxy-basic");
    }
    if (curlOpts.proxyNtlm === true) {
      this.addArg("--proxy-ntlm");
    }
    if (curlOpts.proxyNegotiate === true) {
      this.addArg("--proxy-negotiate");
    }
    if (curlOpts.proxyAnyAuth === true) {
      this.addArg("--proxy-anyauth");
    }
    if (curlOpts.proxyServiceName) {
      this.addArg("--proxy-service-name", curlOpts.proxyServiceName);
    }
    if (curlOpts.proxyTunnel === true) {
      this.addArg("--proxytunnel");
    }
    if (curlOpts.haproxyProtocol === true) {
      this.addArg("--haproxy-protocol");
    }
    if (curlOpts.haproxyClientIp) {
      this.addArg("--haproxy-clientip", curlOpts.haproxyClientIp);
    }
    if (curlOpts.ftp) {
      this.applyFtpOptions(curlOpts.ftp);
    }
    if (curlOpts.disableEprt === true) {
      this.addArg("--disable-eprt");
    }
    if (curlOpts.disableEpsv === true) {
      this.addArg("--disable-epsv");
    }
    if (curlOpts.quote) {
      const quotes = Array.isArray(curlOpts.quote) ? curlOpts.quote : [curlOpts.quote];
      for (const q of quotes) {
        this.addArg("--quote", q);
      }
    }
    if (curlOpts.prequote) {
      const quotes = Array.isArray(curlOpts.prequote) ? curlOpts.prequote : [curlOpts.prequote];
      for (const q of quotes) {
        this.addArg("--prequote", q);
      }
    }
    if (curlOpts.postquote) {
      const quotes = Array.isArray(curlOpts.postquote) ? curlOpts.postquote : [curlOpts.postquote];
      for (const q of quotes) {
        this.addArg("--postquote", q);
      }
    }
    if (curlOpts.continueAt !== undefined) {
      const val = curlOpts.continueAt === "-" ? "-" : curlOpts.continueAt.toString();
      this.addArg("--continue-at", val);
    }
    if (curlOpts.crlf === true) {
      this.addArg("--crlf");
    }
    if (curlOpts.range) {
      this.addArg("--range", curlOpts.range);
    }
    if (curlOpts.ssh) {
      this.applySshOptions(curlOpts.ssh);
    }
    if (curlOpts.smtp) {
      this.applySmtpOptions(curlOpts.smtp);
    }
    if (curlOpts.ntlmWb === true) {
      this.addArg("--ntlm-wb");
    }
    if (curlOpts.saslAuthzid) {
      this.addArg("--sasl-authzid", curlOpts.saslAuthzid);
    }
    if (curlOpts.awsSigv4) {
      if (typeof curlOpts.awsSigv4 === "string") {
        this.addArg("--aws-sigv4", curlOpts.awsSigv4);
      } else {
        this.addArg("--aws-sigv4", `${curlOpts.awsSigv4.provider}:${curlOpts.awsSigv4.region}:${curlOpts.awsSigv4.service}`);
      }
    }
    if (curlOpts.oauth2Bearer) {
      this.addArg("--oauth2-bearer", curlOpts.oauth2Bearer);
    }
    if (curlOpts.loginOptions) {
      this.addArg("--login-options", curlOpts.loginOptions);
    }
    if (curlOpts.kerberos) {
      this.addArg("--krb", curlOpts.kerberos);
    }
    if (curlOpts.xoauth2Bearer) {
      this.addArg("--xoauth2-bearer", curlOpts.xoauth2Bearer);
    }
    if (curlOpts.digest === true) {
      this.addArg("--digest");
    }
    if (curlOpts.basic === true) {
      this.addArg("--basic");
    }
    if (curlOpts.anyAuth === true) {
      this.addArg("--anyauth");
    }
    if (curlOpts.http09 === true) {
      this.addArg("--http0.9");
    }
    if (curlOpts.noBuffer === true) {
      this.addArg("--no-buffer");
    }
    if (curlOpts.disallowUsernameInUrl === true) {
      this.addArg("--disallow-username-in-url");
    }
    if (curlOpts.referer) {
      this.addArg("--referer", curlOpts.referer);
    }
    if (curlOpts.autoReferer === true) {
      this.addArg("--referer", ";auto");
    }
    if (curlOpts.maxRedirs !== undefined) {
      this.replaceArg("--max-redirs", curlOpts.maxRedirs.toString());
    }
    if (curlOpts.failEarly === true) {
      this.addArg("--fail-early");
    }
    if (curlOpts.failWithBody === true) {
      this.addArg("--fail-with-body");
    }
    if (curlOpts.insecure === true) {
      this.addArg("--insecure");
    }
    if (curlOpts.traceAscii) {
      this.addArg("--trace-ascii", curlOpts.traceAscii);
    }
    if (curlOpts.traceIds === true) {
      this.addArg("--trace-ids");
    }
    if (curlOpts.traceConfig) {
      this.addArg("--trace-config", curlOpts.traceConfig);
    }
    if (curlOpts.styledOutput === true) {
      this.addArg("--styled-output");
    }
    if (curlOpts.dumpHeader) {
      this.addArg("--dump-header", curlOpts.dumpHeader);
    }
    if (curlOpts.progressMeter) {
      if (curlOpts.progressMeter === "bar") {
        this.addArg("--progress-bar");
      } else if (curlOpts.progressMeter === "none") {
        this.addArg("--no-progress-meter");
      }
    }
    if (curlOpts.tftpBlksize !== undefined) {
      this.addArg("--tftp-blksize", curlOpts.tftpBlksize.toString());
    }
    if (curlOpts.tftpNoOptions === true) {
      this.addArg("--tftp-no-options");
    }
    if (curlOpts.timeCond) {
      const val = curlOpts.timeCond instanceof Date ? curlOpts.timeCond.toISOString() : curlOpts.timeCond;
      this.addArg("--time-cond", val);
    }
    if (curlOpts.createDirs === true) {
      this.addArg("--create-dirs");
    }
    if (curlOpts.createRemoteDirs === true) {
      this.addArg("--ftp-create-dirs");
    }
    if (curlOpts.compressed === true) {
      this.addArg("--compressed");
    }
    if (curlOpts.remoteTime === true) {
      this.addArg("--remote-time");
    }
    if (curlOpts.outputDir) {
      this.addArg("--output-dir", curlOpts.outputDir);
    }
    if (curlOpts.xattr === true) {
      this.addArg("--xattr");
    }
  }
  applyTlsOptions(tls) {
    if (tls.version) {
      this.applySslVersion(tls.version);
    }
    if (tls.min) {
      this.addArg("--tls-min", tls.min.replace("tlsv", ""));
    }
    if (tls.max) {
      this.addArg("--tls-max", tls.max.replace("tlsv", ""));
    }
    if (tls.tls13Ciphers) {
      this.addArg("--tls13-ciphers", tls.tls13Ciphers);
    }
    if (tls.ciphers) {
      this.addArg("--ciphers", tls.ciphers);
    }
    if (tls.pinnedPubKey) {
      const keys = Array.isArray(tls.pinnedPubKey) ? tls.pinnedPubKey.join(";") : tls.pinnedPubKey;
      this.addArg("--pinnedpubkey", keys);
    }
    if (tls.certStatus === true) {
      this.addArg("--cert-status");
    }
    if (tls.crlfile) {
      this.addArg("--crlfile", tls.crlfile);
    }
    if (tls.cert) {
      this.addArg("--cert", tls.cert);
    }
    if (tls.certType) {
      this.addArg("--cert-type", tls.certType);
    }
    if (tls.key) {
      this.addArg("--key", tls.key);
    }
    if (tls.keyType) {
      this.addArg("--key-type", tls.keyType);
    }
    if (tls.keyPassword) {
      this.addArg("--pass", tls.keyPassword);
    }
    if (tls.cacert) {
      this.addArg("--cacert", tls.cacert);
    }
    if (tls.capath) {
      this.addArg("--capath", tls.capath);
    }
    if (tls.insecure === true) {
      this.addArg("--insecure");
    }
    if (tls.caNative === true) {
      this.addArg("--ca-native");
    }
    if (tls.noSessionId === true) {
      this.addArg("--no-sessionid");
    }
    if (tls.engine) {
      this.addArg("--engine", tls.engine);
    }
    if (tls.randomFile) {
      this.addArg("--random-file", tls.randomFile);
    }
    if (tls.allowBeast === true) {
      this.addArg("--ssl-allow-beast");
    }
    if (tls.noRevoke === true) {
      this.addArg("--ssl-no-revoke");
    }
    if (tls.revokeBestEffort === true) {
      this.addArg("--ssl-revoke-best-effort");
    }
    if (tls.autoClientCert === true) {
      this.addArg("--ssl-auto-client-cert");
    }
    if (tls.forceSsl === true) {
      this.addArg("--ssl");
    }
    if (tls.sslRequired === true) {
      this.addArg("--ssl-reqd");
    }
    if (tls.alpn) {
      const protocols = Array.isArray(tls.alpn) ? tls.alpn.join(",") : tls.alpn;
      this.addArg("--alpn", protocols);
    }
    if (tls.noAlpn === true) {
      this.addArg("--no-alpn");
    }
    if (tls.noNpn === true) {
      this.addArg("--no-npn");
    }
    if (tls.falseStart === true) {
      this.addArg("--false-start");
    }
    if (tls.curves) {
      this.addArg("--curves", tls.curves);
    }
  }
  applyProxyTlsOptions(proxyTls) {
    if (proxyTls.version) {
      this.applyProxySslVersion(proxyTls.version);
    }
    if (proxyTls.cert) {
      this.addArg("--proxy-cert", proxyTls.cert);
    }
    if (proxyTls.key) {
      this.addArg("--proxy-key", proxyTls.key);
    }
    if (proxyTls.cacert) {
      this.addArg("--proxy-cacert", proxyTls.cacert);
    }
    if (proxyTls.capath) {
      this.addArg("--proxy-capath", proxyTls.capath);
    }
    if (proxyTls.insecure === true) {
      this.addArg("--proxy-insecure");
    }
    if (proxyTls.certType) {
      this.addArg("--proxy-cert-type", proxyTls.certType);
    }
    if (proxyTls.keyType) {
      this.addArg("--proxy-key-type", proxyTls.keyType);
    }
    if (proxyTls.keyPassword) {
      this.addArg("--proxy-pass", proxyTls.keyPassword);
    }
    if (proxyTls.ciphers) {
      this.addArg("--proxy-ciphers", proxyTls.ciphers);
    }
    if (proxyTls.tls13Ciphers) {
      this.addArg("--proxy-tls13-ciphers", proxyTls.tls13Ciphers);
    }
    if (proxyTls.pinnedPubKey) {
      const keys = Array.isArray(proxyTls.pinnedPubKey) ? proxyTls.pinnedPubKey.join(";") : proxyTls.pinnedPubKey;
      this.addArg("--proxy-pinnedpubkey", keys);
    }
    if (proxyTls.crlfile) {
      this.addArg("--proxy-crlfile", proxyTls.crlfile);
    }
    if (proxyTls.allowBeast === true) {
      this.addArg("--proxy-ssl-allow-beast");
    }
    if (proxyTls.autoClientCert === true) {
      this.addArg("--proxy-ssl-auto-client-cert");
    }
  }
  applyFtpOptions(ftp) {
    if (ftp.account) {
      this.addArg("--ftp-account", ftp.account);
    }
    if (ftp.alternativeToUser) {
      this.addArg("--ftp-alternative-to-user", ftp.alternativeToUser);
    }
    if (ftp.createDirs === true) {
      this.addArg("--ftp-create-dirs");
    }
    if (ftp.method) {
      this.addArg("--ftp-method", ftp.method);
    }
    if (ftp.pasv === true) {
      this.addArg("--ftp-pasv");
    }
    if (ftp.port) {
      this.addArg("--ftp-port", ftp.port);
    }
    if (ftp.pret === true) {
      this.addArg("--ftp-pret");
    }
    if (ftp.skipPasvIp === true) {
      this.addArg("--ftp-skip-pasv-ip");
    }
    if (ftp.sslCccMode) {
      this.addArg("--ftp-ssl-ccc-mode", ftp.sslCccMode);
    }
    if (ftp.sslControl === true) {
      this.addArg("--ftp-ssl-control");
    }
    if (ftp.activeMode === true) {
      this.addArg("--ftp-port", "-");
    }
    if (ftp.append === true) {
      this.addArg("--append");
    }
    if (ftp.ascii === true) {
      this.addArg("--use-ascii");
    }
  }
  applySshOptions(ssh) {
    if (ssh.privateKey) {
      this.addArg("--key", ssh.privateKey);
    }
    if (ssh.privateKeyPassword) {
      this.addArg("--pass", ssh.privateKeyPassword);
    }
    if (ssh.publicKey) {
      this.addArg("--pubkey", ssh.publicKey);
    }
    if (ssh.hostPubSha256) {
      this.addArg("--hostpubsha256", ssh.hostPubSha256);
    }
    if (ssh.hostPubMd5) {
      this.addArg("--hostpubmd5", ssh.hostPubMd5);
    }
    if (ssh.knownHosts) {
      this.addArg("--known-hosts", ssh.knownHosts);
    }
    if (ssh.compression === true) {
      this.addArg("--compressed-ssh");
    }
  }
  applySmtpOptions(smtp) {
    if (smtp.mailFrom) {
      this.addArg("--mail-from", smtp.mailFrom);
    }
    if (smtp.mailRcpt) {
      const recipients = Array.isArray(smtp.mailRcpt) ? smtp.mailRcpt : [smtp.mailRcpt];
      for (const rcpt of recipients) {
        this.addArg("--mail-rcpt", rcpt);
      }
    }
    if (smtp.mailRcptAllowFails === true) {
      this.addArg("--mail-rcpt-allowfails");
    }
    if (smtp.mailAuth) {
      this.addArg("--mail-auth", smtp.mailAuth);
    }
  }
  applySslVersion(version) {
    switch (version) {
      case "sslv2":
        this.addArg("--sslv2");
        break;
      case "sslv3":
        this.addArg("--sslv3");
        break;
      case "tlsv1":
        this.addArg("--tlsv1");
        break;
      case "tlsv1.0":
        this.addArg("--tlsv1.0");
        break;
      case "tlsv1.1":
        this.addArg("--tlsv1.1");
        break;
      case "tlsv1.2":
        this.addArg("--tlsv1.2");
        break;
      case "tlsv1.3":
        this.addArg("--tlsv1.3");
        break;
    }
  }
  applyProxySslVersion(version) {
    switch (version) {
      case "tlsv1":
        this.addArg("--proxy-tlsv1");
        break;
      case "tlsv1.0":
        this.addArg("--proxy-tlsv1.0");
        break;
      case "tlsv1.1":
        this.addArg("--proxy-tlsv1.1");
        break;
      case "tlsv1.2":
        this.addArg("--proxy-tlsv1.2");
        break;
      case "tlsv1.3":
        this.addArg("--proxy-tlsv1.3");
        break;
    }
  }
  replaceArg(arg, value) {
    const index = this.args.indexOf(arg);
    if (index !== -1 && index + 1 < this.args.length) {
      this.args[index + 1] = this.escapeShellArg(value);
    } else {
      this.addArg(arg, value);
    }
  }
  removeArg(arg) {
    const index = this.args.indexOf(arg);
    if (index !== -1) {
      this.args.splice(index, 1);
      if (index < this.args.length && !this.args[index]?.startsWith("-")) {
        this.args.splice(index, 1);
      }
    }
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
  buildRequestBody(config, originalRequest, tempFiles) {
    const data = originalRequest.body ?? config.data;
    if (!data) {
      return;
    }
    if (typeof data === "string") {
      this.addArg("-d", data);
    } else if (Buffer.isBuffer(data)) {
      const dataFile = this.tempFiles.createTempFile("data", ".bin");
      fs.writeFileSync(dataFile, data);
      tempFiles.push(dataFile);
      this.addArg("--data-binary", `@${dataFile}`);
    } else if (data instanceof RezoFormData) {
      const formData = data;
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
        this.addArg("-H", `Content-Length: ${formBuffer.length}`);
      }
    } else if (data instanceof Readable) {
      this.addArg("-d", "@-");
    } else if (typeof data === "object") {
      this.addArg("-d", JSON.stringify(data));
    }
  }
  buildWriteOutFormat() {
    return [
      `
---CURL_STATS_START---`,
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
    ].join(`
`);
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
    const responseCookies = this.parseCookies(headers);
    const mergedCookieArray = mergeRequestAndResponseCookies(config.requestCookies, responseCookies.array);
    let cookies;
    if (mergedCookieArray.length > 0) {
      const mergedJar = new RezoCookieJar(mergedCookieArray, config.url || "");
      cookies = mergedJar.cookies();
    } else {
      cookies = {
        array: [],
        serialized: [],
        netscape: `# Netscape HTTP Cookie File
# This file was generated by Rezo HTTP client
# Based on uniqhtt cookie implementation
`,
        string: "",
        setCookiesString: []
      };
    }
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
    config.status = status;
    config.statusText = statusText;
    const isSecure = config.url?.startsWith("https") || false;
    config.adapterUsed = "curl";
    config.isSecure = isSecure;
    config.finalUrl = stats["redirect_url"] || config.url || "";
    if (!config.network) {
      config.network = {};
    }
    config.network.protocol = isSecure ? "https" : "http";
    config.network.httpVersion = headerSection.match(/HTTP\/([\d.]+)/)?.[1] || "1.1";
    if (!config.transfer) {
      config.transfer = { requestSize: 0, responseSize: 0, headerSize: 0, bodySize: 0 };
    }
    config.transfer.requestSize = parseInt(stats["size_upload"]) || 0;
    config.transfer.responseSize = parseInt(stats["size_download"]) || responseBody.length;
    config.transfer.bodySize = responseBody.length;
    config.transfer.headerSize = headerSection.length;
    config.responseCookies = cookies;
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
    if (config.baseURL && !url.startsWith("http://") && !url.startsWith("https://")) {
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
            if (code === 22 && stdout) {
              try {
                const response = CurlResponseParser.parse(stdout, stderr, config, originalRequest);
                resolve(response);
                return;
              } catch {}
            }
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
  const d_options = await getDefaultConfig(defaultOptions, defaultOptions._proxyManager);
  const configResult = prepareHTTPOptions(options, jar, { defaultOptions: d_options });
  const config = configResult.config;
  const originalRequest = configResult.fetchOptions;
  const { proxyManager } = configResult;
  const perform = new RezoPerformance;
  let selectedProxy = null;
  if (proxyManager) {
    const requestUrl = typeof originalRequest.url === "string" ? originalRequest.url : originalRequest.url?.toString() || "";
    selectedProxy = proxyManager.next(requestUrl);
    if (selectedProxy) {
      originalRequest.proxy = {
        protocol: selectedProxy.protocol,
        host: selectedProxy.host,
        port: selectedProxy.port,
        auth: selectedProxy.auth
      };
    } else if (proxyManager.config.failWithoutProxy) {
      throw new RezoError("No proxy available: All proxies exhausted or URL did not match whitelist/blacklist", config, "UNQ_NO_PROXY_AVAILABLE", originalRequest);
    }
  }
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
  if (proxyManager && selectedProxy) {
    if (streamResponse) {
      streamResponse.on("finish", () => {
        proxyManager.reportSuccess(selectedProxy);
      });
      streamResponse.on("error", (err) => {
        proxyManager.reportFailure(selectedProxy, err);
      });
    } else if (downloadResponse) {
      downloadResponse.on("finish", () => {
        proxyManager.reportSuccess(selectedProxy);
      });
      downloadResponse.on("error", (err) => {
        proxyManager.reportFailure(selectedProxy, err);
      });
    } else if (uploadResponse) {
      uploadResponse.on("finish", () => {
        proxyManager.reportSuccess(selectedProxy);
      });
      uploadResponse.on("error", (err) => {
        proxyManager.reportFailure(selectedProxy, err);
      });
    }
  }
  const executor = new CurlExecutor;
  try {
    const result = await executor.execute(config, originalRequest, streamResponse, downloadResponse, uploadResponse);
    if (!streamResponse && !downloadResponse && !uploadResponse) {
      const response = result;
      if (proxyManager && selectedProxy) {
        proxyManager.reportSuccess(selectedProxy);
      }
      if (response.status >= 400) {
        const httpError = builErrorFromResponse(`Request failed with status code ${response.status}`, response, config, originalRequest);
        if (config.retry) {
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
        throw httpError;
      }
    }
    return result;
  } catch (error) {
    if (proxyManager && selectedProxy) {
      proxyManager.reportFailure(selectedProxy, error);
    }
    if (error instanceof RezoError) {
      throw error;
    }
    throw buildSmartError(config, originalRequest, error);
  }
}

export { CurlCapabilities, CurlExecutor, CurlCommandBuilder };
