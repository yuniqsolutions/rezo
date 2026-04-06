export class WgetError extends Error {
  code;
  url;
  statusCode;
  cause;
  constructor(message, code, url, statusCode, cause) {
    super(message);
    this.name = "WgetError";
    this.code = code;
    this.url = url;
    this.statusCode = statusCode;
    this.cause = cause;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WgetError);
    }
  }
  isNetworkError() {
    const networkCodes = [
      "ENOTFOUND",
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "ECONNABORTED",
      "EPIPE",
      "EAI_AGAIN"
    ];
    return networkCodes.includes(this.code);
  }
  isHttpError() {
    return this.code.startsWith("HTTP_") || this.statusCode !== undefined && this.statusCode >= 400;
  }
  isRetryable() {
    if (this.isNetworkError())
      return true;
    if (this.statusCode) {
      return this.statusCode === 408 || this.statusCode === 429 || this.statusCode >= 500;
    }
    return false;
  }
  isProxyError() {
    const proxyCodes = [
      "REZ_PROXY_CONNECTION_FAILED",
      "REZ_PROXY_AUTHENTICATION_FAILED",
      "REZ_PROXY_PROTOCOL_ERROR",
      "REZ_PROXY_TIMEOUT",
      "REZ_SOCKS_CONNECTION_FAILED",
      "REZ_SOCKS_AUTH_FAILED",
      "REZ_SOCKS_HANDSHAKE_FAILED",
      "REZ_SOCKS_PROTOCOL_ERROR",
      "ECONNREFUSED",
      "ECONNRESET"
    ];
    if (proxyCodes.includes(this.code))
      return true;
    const lowerMessage = this.message.toLowerCase();
    return lowerMessage.includes("proxy") || lowerMessage.includes("socks");
  }
  static fromHttpStatus(url, statusCode, statusText) {
    return new WgetError(`HTTP ${statusCode}: ${statusText}`, `HTTP_${statusCode}`, url, statusCode);
  }
  static fromNetworkError(url, error) {
    const code = error.code || "NETWORK_ERROR";
    return new WgetError(error.message, code, url, undefined, error);
  }
}
export function flattenWgetOptions(options) {
  const flat = {};
  if (options.logging) {
    flat.quiet = options.logging.quiet;
    flat.verbose = options.logging.verbose;
    flat.debug = options.logging.debug;
    flat.noVerbose = options.logging.noVerbose;
    flat.reportSpeed = options.logging.reportSpeed;
    flat.progress = options.logging.progress;
    flat.showProgress = options.logging.showProgress;
    flat.logFile = options.logging.logFile;
    flat.appendOutput = options.logging.appendOutput;
  }
  if (options.download) {
    flat.output = options.download.output;
    flat.outputDir = options.download.outputDir;
    flat.continueDownload = options.download.continue;
    flat.timestamping = options.download.timestamping;
    flat.noClobber = options.download.noClobber;
    flat.backups = options.download.backups;
    flat.adjustExtension = options.download.adjustExtension;
    flat.contentDisposition = options.download.contentDisposition;
    flat.contentOnError = options.download.contentOnError;
    flat.tries = options.download.tries;
    flat.retryConnrefused = options.download.retryConnrefused;
    flat.waitRetry = options.download.waitRetry;
    flat.maxProxyRetries = options.download.maxProxyRetries;
    flat.retryProxyErrors = options.download.retryProxyErrors;
    flat.timeout = options.download.timeout;
    flat.connectTimeout = options.download.connectTimeout;
    flat.readTimeout = options.download.readTimeout;
    flat.dnsTimeout = options.download.dnsTimeout;
    flat.wait = options.download.wait;
    flat.randomWait = options.download.randomWait;
    flat.limitRate = options.download.limitRate;
    flat.quota = options.download.quota;
    flat.concurrency = options.download.concurrency;
  }
  if (options.directories) {
    flat.noDirectories = options.directories.noDirectories;
    flat.forceDirectories = options.directories.forceDirectories;
    flat.cutDirs = options.directories.cutDirs;
    flat.protocolDirectories = options.directories.protocolDirectories;
    flat.noHostDirectories = options.directories.noHostDirectories;
    flat.organizeAssets = options.directories.organizeAssets;
    flat.assetFolders = options.directories.assetFolders;
  }
  if (options.http) {
    flat.userAgent = options.http.userAgent;
    flat.referer = options.http.referer;
    flat.headers = options.http.headers;
    flat.method = options.http.method;
    flat.maxRedirects = options.http.maxRedirects;
    flat.noCheckCertificate = options.http.noCheckCertificate;
    flat.postData = options.http.postData;
    flat.postFile = options.http.postFile;
    flat.httpUser = options.http.user;
    flat.httpPassword = options.http.password;
    if (options.http.cookies) {
      flat.loadCookies = options.http.cookies.load;
      flat.saveCookies = options.http.cookies.save;
      flat.keepSessionCookies = options.http.cookies.keepSession;
      flat.jar = options.http.cookies.jar;
    }
  }
  if (options.recursive) {
    flat.recursive = options.recursive.enabled;
    flat.depth = options.recursive.depth;
    flat.deleteAfter = options.recursive.deleteAfter;
    flat.convertLinks = options.recursive.convertLinks;
    flat.backupConverted = options.recursive.backupConverted;
    flat.mirror = options.recursive.mirror;
    flat.pageRequisites = options.recursive.pageRequisites;
    flat.strictComments = options.recursive.strictComments;
    flat.extractInternalStyles = options.recursive.extractInternalStyles;
    flat.removeJavascript = options.recursive.removeJavascript;
  }
  if (options.filter) {
    flat.accept = options.filter.accept;
    flat.reject = options.filter.reject;
    flat.acceptRegex = options.filter.acceptRegex;
    flat.rejectRegex = options.filter.rejectRegex;
    flat.domains = options.filter.domains;
    flat.excludeDomains = options.filter.excludeDomains;
    flat.followTags = options.filter.followTags;
    flat.ignoreTags = options.filter.ignoreTags;
    flat.followFTP = options.filter.followFTP;
    flat.spanHosts = options.filter.spanHosts;
    flat.relativeOnly = options.filter.relativeOnly;
    flat.noParent = options.filter.noParent;
    flat.includeDirectories = options.filter.includeDirectories;
    flat.excludeDirectories = options.filter.excludeDirectories;
    flat.excludeExtensions = options.filter.excludeExtensions;
    flat.excludeMimeTypes = options.filter.excludeMimeTypes;
    flat.acceptAssetTypes = options.filter.acceptAssetTypes;
    flat.rejectAssetTypes = options.filter.rejectAssetTypes;
    flat.maxFileSize = options.filter.maxFileSize;
    flat.minFileSize = options.filter.minFileSize;
  }
  if (options.robots) {
    flat.robots = options.robots.enabled;
    flat.noRobots = options.robots.enabled === false;
  }
  if (options.proxy) {
    flat.proxy = options.proxy;
  }
  if (options.network) {
    flat.inet4Only = options.network.inet4Only;
    flat.inet6Only = options.network.inet6Only;
    flat.preferFamily = options.network.preferFamily;
  }
  if (options.input) {
    flat.inputFile = options.input.file;
    flat.baseUrl = options.input.base;
  }
  if (options.misc) {
    flat.background = options.misc.background;
    flat.execute = options.misc.execute;
    flat.restrictFileNames = options.misc.restrictFileNames;
    flat.signal = options.misc.signal;
  }
  if (options.organizeAssets !== undefined) {
    flat.organizeAssets = options.organizeAssets;
  }
  if (options.assetFolders !== undefined) {
    flat.assetFolders = options.assetFolders;
  }
  if (options.cache !== undefined) {
    flat.cache = options.cache;
  }
  if (options.extractInternalStyles !== undefined) {
    flat.extractInternalStyles = options.extractInternalStyles;
  }
  if (options.removeJavascript !== undefined) {
    flat.removeJavascript = options.removeJavascript;
  }
  if (flat.domains && !flat.spanHosts) {
    flat.spanHosts = true;
  }
  return Object.fromEntries(Object.entries(flat).filter(([_, v]) => v !== undefined));
}
