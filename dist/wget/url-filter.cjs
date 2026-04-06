class UrlFilter {
  options;
  startUrls = new Set;
  startHosts = new Set;
  startPaths = new Map;
  allowedDomains = null;
  excludedDomains = null;
  acceptPatterns = null;
  rejectPatterns = null;
  acceptRegex = null;
  rejectRegex = null;
  includeDirectories = null;
  excludeDirectories = null;
  excludeExtensions = null;
  constructor(options) {
    this.options = options;
    this.initializeFilters();
  }
  initializeFilters() {
    if (this.options.domains) {
      const domains = Array.isArray(this.options.domains) ? this.options.domains : this.options.domains.split(",").map((d) => d.trim());
      this.allowedDomains = new Set(domains.map((d) => d.toLowerCase()));
    }
    if (this.options.excludeDomains) {
      const domains = Array.isArray(this.options.excludeDomains) ? this.options.excludeDomains : this.options.excludeDomains.split(",").map((d) => d.trim());
      this.excludedDomains = new Set(domains.map((d) => d.toLowerCase()));
    }
    if (this.options.accept) {
      this.acceptPatterns = Array.isArray(this.options.accept) ? this.options.accept : this.options.accept.split(",").map((p) => p.trim());
    }
    if (this.options.reject) {
      this.rejectPatterns = Array.isArray(this.options.reject) ? this.options.reject : this.options.reject.split(",").map((p) => p.trim());
    }
    if (this.options.acceptRegex) {
      this.acceptRegex = this.options.acceptRegex instanceof RegExp ? this.options.acceptRegex : new RegExp(this.options.acceptRegex);
    }
    if (this.options.rejectRegex) {
      this.rejectRegex = this.options.rejectRegex instanceof RegExp ? this.options.rejectRegex : new RegExp(this.options.rejectRegex);
    }
    if (this.options.includeDirectories) {
      this.includeDirectories = this.options.includeDirectories.map((d) => d.startsWith("/") ? d : "/" + d);
    }
    if (this.options.excludeDirectories) {
      this.excludeDirectories = this.options.excludeDirectories.map((d) => d.startsWith("/") ? d : "/" + d);
    }
    if (this.options.excludeExtensions) {
      this.excludeExtensions = this.options.excludeExtensions.map((ext) => ext.startsWith(".") ? ext.toLowerCase() : ("." + ext).toLowerCase());
    }
  }
  addStartUrl(url) {
    try {
      const parsed = new URL(url);
      this.startUrls.add(url);
      this.startHosts.add(parsed.hostname.toLowerCase());
      const host = parsed.hostname.toLowerCase();
      if (!this.startPaths.has(host)) {
        let path = parsed.pathname;
        if (!path.endsWith("/")) {
          path = path.substring(0, path.lastIndexOf("/") + 1) || "/";
        }
        this.startPaths.set(host, path);
      }
    } catch {}
  }
  shouldDownload(url, sourceUrl, depth) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return {
        allowed: false,
        reason: "invalid-url",
        message: `Invalid URL: ${url}`
      };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      if (parsed.protocol === "ftp:" && this.options.followFTP) {} else {
        return {
          allowed: false,
          reason: "unsupported-protocol",
          message: `Unsupported protocol: ${parsed.protocol}`
        };
      }
    }
    const depthResult = this.checkDepth(depth);
    if (!depthResult.allowed)
      return depthResult;
    const hostResult = this.checkHost(parsed, sourceUrl);
    if (!hostResult.allowed)
      return hostResult;
    const domainResult = this.checkDomain(parsed);
    if (!domainResult.allowed)
      return domainResult;
    const parentResult = this.checkParent(parsed);
    if (!parentResult.allowed)
      return parentResult;
    const dirResult = this.checkDirectory(parsed);
    if (!dirResult.allowed)
      return dirResult;
    const extResult = this.checkExtension(parsed);
    if (!extResult.allowed)
      return extResult;
    const patternResult = this.checkPatterns(url, parsed);
    if (!patternResult.allowed)
      return patternResult;
    if (this.options.relativeOnly) {
      const isAbsolute = url.startsWith("http://") || url.startsWith("https://");
    }
    return { allowed: true };
  }
  checkDepth(depth) {
    const maxDepth = this.options.depth ?? this.options.maxDepth ?? 5;
    if (maxDepth === 0 || maxDepth === 1 / 0) {
      return { allowed: true };
    }
    if (depth > maxDepth) {
      return {
        allowed: false,
        reason: "depth-exceeded",
        message: `Depth ${depth} exceeds maximum ${maxDepth}`
      };
    }
    return { allowed: true };
  }
  checkHost(parsed, sourceUrl) {
    const host = parsed.hostname.toLowerCase();
    if (this.options.spanHosts) {
      return { allowed: true };
    }
    if (this.startHosts.has(host)) {
      return { allowed: true };
    }
    if (this.options.pageRequisites) {
      for (const startHost of this.startHosts) {
        if (this.isSameRootDomain(host, startHost)) {
          return { allowed: true };
        }
      }
    }
    try {
      const sourceHost = new URL(sourceUrl).hostname.toLowerCase();
      if (host === sourceHost) {
        return { allowed: true };
      }
    } catch {}
    return {
      allowed: false,
      reason: "cross-host",
      message: `Cross-host URL not allowed without --span-hosts: ${host}`
    };
  }
  isSameRootDomain(hostA, hostB) {
    const rootA = this.getRootDomain(hostA);
    const rootB = this.getRootDomain(hostB);
    return rootA === rootB;
  }
  getRootDomain(host) {
    const parts = host.split(".");
    if (parts.length > 2) {
      const twoPartTlds = [
        "co.uk",
        "co.jp",
        "co.kr",
        "co.nz",
        "co.za",
        "co.in",
        "com.au",
        "com.br",
        "com.cn",
        "com.mx",
        "com.sg",
        "com.tw",
        "com.hk",
        "org.uk",
        "net.au",
        "ac.uk",
        "gov.uk",
        "ne.jp",
        "or.jp"
      ];
      const lastTwo = parts.slice(-2).join(".");
      if (twoPartTlds.includes(lastTwo)) {
        return parts.slice(-3).join(".");
      }
      return parts.slice(-2).join(".");
    }
    return host;
  }
  checkDomain(parsed) {
    const host = parsed.hostname.toLowerCase();
    if (this.excludedDomains) {
      for (const excludedDomain of Array.from(this.excludedDomains)) {
        if (this.matchesDomain(host, excludedDomain)) {
          return {
            allowed: false,
            reason: "domain-excluded",
            message: `Domain ${host} is in excluded list`
          };
        }
      }
    }
    if (this.allowedDomains) {
      let matchesAllowed = false;
      for (const allowedDomain of Array.from(this.allowedDomains)) {
        if (this.matchesDomain(host, allowedDomain)) {
          matchesAllowed = true;
          break;
        }
      }
      if (!matchesAllowed) {
        return {
          allowed: false,
          reason: "domain-excluded",
          message: `Domain ${host} not in allowed list`
        };
      }
    }
    return { allowed: true };
  }
  matchesDomain(host, domain) {
    if (host === domain)
      return true;
    if (host.endsWith("." + domain))
      return true;
    return false;
  }
  checkParent(parsed) {
    if (!this.options.noParent) {
      return { allowed: true };
    }
    const host = parsed.hostname.toLowerCase();
    const basePath = this.startPaths.get(host);
    if (!basePath) {
      if (!this.startHosts.has(host)) {
        return { allowed: true };
      }
      return { allowed: true };
    }
    const urlPath = parsed.pathname;
    const normalizedBase = basePath.endsWith("/") ? basePath : basePath + "/";
    const normalizedUrl = urlPath.endsWith("/") ? urlPath : urlPath + "/";
    if (!normalizedUrl.startsWith(normalizedBase) && normalizedUrl !== normalizedBase.slice(0, -1)) {
      if (urlPath !== basePath && !urlPath.startsWith(normalizedBase)) {
        return {
          allowed: false,
          reason: "parent-directory",
          message: `URL ${urlPath} goes above parent ${basePath}`
        };
      }
    }
    return { allowed: true };
  }
  checkDirectory(parsed) {
    const path = parsed.pathname;
    if (this.excludeDirectories) {
      for (const excludeDir of this.excludeDirectories) {
        if (path.startsWith(excludeDir)) {
          return {
            allowed: false,
            reason: "directory-excluded",
            message: `Path ${path} is in excluded directory ${excludeDir}`
          };
        }
      }
    }
    if (this.includeDirectories) {
      let matchesInclude = false;
      for (const includeDir of this.includeDirectories) {
        if (path.startsWith(includeDir)) {
          matchesInclude = true;
          break;
        }
      }
      if (!matchesInclude) {
        return {
          allowed: false,
          reason: "directory-excluded",
          message: `Path ${path} not in any included directory`
        };
      }
    }
    return { allowed: true };
  }
  checkExtension(parsed) {
    if (!this.excludeExtensions || this.excludeExtensions.length === 0) {
      return { allowed: true };
    }
    const filename = this.getFilename(parsed);
    if (!filename) {
      return { allowed: true };
    }
    const ext = this.getExtension(filename);
    if (!ext) {
      return { allowed: true };
    }
    if (this.excludeExtensions.includes(ext.toLowerCase())) {
      return {
        allowed: false,
        reason: "pattern-rejected",
        message: `File extension ${ext} is excluded`
      };
    }
    return { allowed: true };
  }
  getExtension(filename) {
    const lastDot = filename.lastIndexOf(".");
    if (lastDot === -1 || lastDot === filename.length - 1) {
      return "";
    }
    return filename.slice(lastDot).toLowerCase();
  }
  checkPatterns(url, parsed) {
    const filename = this.getFilename(parsed);
    if (this.acceptPatterns && this.acceptPatterns.length > 0) {
      const matchesAccept = this.acceptPatterns.some((pattern) => this.matchGlob(filename, pattern) || this.matchGlob(url, pattern));
      if (!matchesAccept) {
        return {
          allowed: false,
          reason: "pattern-not-accepted",
          message: `URL does not match accept patterns`
        };
      }
    }
    if (this.rejectPatterns && this.rejectPatterns.length > 0) {
      const matchesReject = this.rejectPatterns.some((pattern) => this.matchGlob(filename, pattern) || this.matchGlob(url, pattern));
      if (matchesReject) {
        return {
          allowed: false,
          reason: "pattern-rejected",
          message: `URL matches reject pattern`
        };
      }
    }
    if (this.acceptRegex) {
      if (!this.acceptRegex.test(url)) {
        return {
          allowed: false,
          reason: "pattern-not-accepted",
          message: `URL does not match accept regex`
        };
      }
    }
    if (this.rejectRegex) {
      if (this.rejectRegex.test(url)) {
        return {
          allowed: false,
          reason: "pattern-rejected",
          message: `URL matches reject regex`
        };
      }
    }
    return { allowed: true };
  }
  getFilename(parsed) {
    const path = parsed.pathname;
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash === -1 || lastSlash === path.length - 1) {
      return "";
    }
    return path.substring(lastSlash + 1);
  }
  matchGlob(str, pattern) {
    const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    try {
      const regex = new RegExp(`^${regexStr}$`, "i");
      return regex.test(str);
    } catch {
      return false;
    }
  }
  getMaxDepth() {
    if (this.options.mirror) {
      return 1 / 0;
    }
    const depth = this.options.depth ?? this.options.maxDepth ?? 5;
    return depth === 0 ? 1 / 0 : depth;
  }
  isRecursive() {
    return this.options.recursive === true || this.options.mirror === true;
  }
  isStartUrl(url) {
    return this.startUrls.has(url);
  }
  getStartUrls() {
    return this.startUrls;
  }
  updateOptions(options) {
    this.options = { ...this.options, ...options };
    this.initializeFilters();
  }
}

exports.UrlFilter = UrlFilter;
exports.default = UrlFilter;
module.exports = Object.assign(UrlFilter, exports);