const DEFAULT_USER_AGENT = "Rezo-Wget";

export class RobotsHandler {
  options;
  userAgent;
  cache = new Map;
  pending = new Map;
  constructor(options) {
    this.options = options;
    this.userAgent = this.extractBotName(options.userAgent || DEFAULT_USER_AGENT);
  }
  extractBotName(userAgent) {
    const match = userAgent.match(/^([^\s\/]+)/);
    return match ? match[1].toLowerCase() : userAgent.toLowerCase();
  }
  async fetch(url, fetcher) {
    if (this.options.noRobots || this.options.robots === false) {
      return null;
    }
    const domain = this.getDomain(url);
    if (!domain)
      return null;
    if (this.cache.has(domain)) {
      return this.cache.get(domain) || null;
    }
    if (this.pending.has(domain)) {
      await this.pending.get(domain);
      return this.cache.get(domain) || null;
    }
    const robotsUrl = this.getRobotsUrl(url);
    const fetchPromise = (async () => {
      try {
        const content = await fetcher(robotsUrl);
        if (content) {
          const parsed = this.parse(content);
          this.cache.set(domain, parsed);
        } else {
          this.cache.set(domain, null);
        }
      } catch {
        this.cache.set(domain, null);
      } finally {
        this.pending.delete(domain);
      }
    })();
    this.pending.set(domain, fetchPromise);
    await fetchPromise;
    return this.cache.get(domain) || null;
  }
  isAllowed(url) {
    if (this.options.noRobots || this.options.robots === false) {
      return true;
    }
    const domain = this.getDomain(url);
    if (!domain)
      return true;
    const parsed = this.cache.get(domain);
    if (!parsed) {
      return true;
    }
    try {
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname + parsedUrl.search;
      return this.isPathAllowed(path, parsed.rules);
    } catch {
      return true;
    }
  }
  isPathAllowed(path, rules) {
    const matchingRules = this.findMatchingRules(rules);
    if (matchingRules.length === 0) {
      return true;
    }
    const allAllows = [];
    const allDisallows = [];
    for (const rule of matchingRules) {
      allAllows.push(...rule.allow);
      allDisallows.push(...rule.disallow);
    }
    let bestMatch = null;
    let bestLength = -1;
    for (const pattern of allAllows) {
      if (this.pathMatches(path, pattern)) {
        const specificity = this.getSpecificity(pattern);
        if (specificity > bestLength) {
          bestLength = specificity;
          bestMatch = { pattern, allow: true };
        }
      }
    }
    for (const pattern of allDisallows) {
      if (this.pathMatches(path, pattern)) {
        const specificity = this.getSpecificity(pattern);
        if (specificity > bestLength) {
          bestLength = specificity;
          bestMatch = { pattern, allow: false };
        }
      }
    }
    if (!bestMatch) {
      return true;
    }
    return bestMatch.allow;
  }
  findMatchingRules(rules) {
    const matching = [];
    let hasSpecificMatch = false;
    for (const rule of rules) {
      const ruleAgent = rule.userAgent.toLowerCase();
      if (ruleAgent === this.userAgent) {
        matching.push(rule);
        hasSpecificMatch = true;
      }
    }
    if (hasSpecificMatch) {
      return matching;
    }
    for (const rule of rules) {
      const ruleAgent = rule.userAgent.toLowerCase();
      if (this.userAgent.includes(ruleAgent) || ruleAgent.includes(this.userAgent)) {
        matching.push(rule);
      }
    }
    if (matching.length > 0) {
      return matching;
    }
    for (const rule of rules) {
      if (rule.userAgent === "*") {
        matching.push(rule);
      }
    }
    return matching;
  }
  pathMatches(path, pattern) {
    if (!pattern)
      return false;
    if (pattern === "")
      return false;
    let regexStr = "";
    let hasEndAnchor = false;
    if (pattern.endsWith("$")) {
      hasEndAnchor = true;
      pattern = pattern.slice(0, -1);
    }
    for (const char of pattern) {
      if (char === "*") {
        regexStr += ".*";
      } else if (".+?^${}()|[]\\".includes(char)) {
        regexStr += "\\" + char;
      } else {
        regexStr += char;
      }
    }
    regexStr = "^" + regexStr;
    if (hasEndAnchor) {
      regexStr += "$";
    }
    try {
      const regex = new RegExp(regexStr);
      return regex.test(path);
    } catch {
      return path.startsWith(pattern.replace(/\*/g, ""));
    }
  }
  getSpecificity(pattern) {
    return pattern.replace(/\*/g, "").length;
  }
  getCrawlDelay(urlOrDomain) {
    const domain = urlOrDomain.includes("://") ? this.getDomain(urlOrDomain) : urlOrDomain;
    if (!domain)
      return null;
    const parsed = this.cache.get(domain);
    if (!parsed)
      return null;
    const matchingRules = this.findMatchingRules(parsed.rules);
    for (const rule of matchingRules) {
      if (rule.crawlDelay !== undefined) {
        return rule.crawlDelay;
      }
    }
    return null;
  }
  getSitemaps(urlOrDomain) {
    const domain = urlOrDomain.includes("://") ? this.getDomain(urlOrDomain) : urlOrDomain;
    if (!domain)
      return [];
    const parsed = this.cache.get(domain);
    if (!parsed)
      return [];
    return parsed.sitemaps;
  }
  getParsed(urlOrDomain) {
    const domain = urlOrDomain.includes("://") ? this.getDomain(urlOrDomain) : urlOrDomain;
    if (!domain)
      return null;
    return this.cache.get(domain) || null;
  }
  parse(content) {
    const rules = [];
    const sitemaps = [];
    let currentRule = null;
    const lines = content.split(/\r?\n/);
    for (let line of lines) {
      const commentIndex = line.indexOf("#");
      if (commentIndex !== -1) {
        line = line.substring(0, commentIndex);
      }
      line = line.trim();
      if (!line)
        continue;
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1)
        continue;
      const directive = line.substring(0, colonIndex).trim().toLowerCase();
      const value = line.substring(colonIndex + 1).trim();
      switch (directive) {
        case "user-agent":
          if (currentRule && (currentRule.allow.length > 0 || currentRule.disallow.length > 0)) {
            rules.push(currentRule);
          }
          currentRule = {
            userAgent: value,
            disallow: [],
            allow: [],
            sitemaps: []
          };
          break;
        case "disallow":
          if (currentRule) {
            currentRule.disallow.push(value);
          }
          break;
        case "allow":
          if (currentRule) {
            currentRule.allow.push(value);
          }
          break;
        case "crawl-delay":
          if (currentRule) {
            const delay = parseFloat(value);
            if (!isNaN(delay) && delay >= 0) {
              currentRule.crawlDelay = delay;
            }
          }
          break;
        case "sitemap":
          sitemaps.push(value);
          break;
      }
    }
    if (currentRule && (currentRule.allow.length > 0 || currentRule.disallow.length > 0)) {
      rules.push(currentRule);
    }
    return {
      rules,
      sitemaps,
      raw: content
    };
  }
  getRobotsUrl(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}/robots.txt`;
    } catch {
      return "";
    }
  }
  getDomain(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  hasFetched(urlOrDomain) {
    const domain = urlOrDomain.includes("://") ? this.getDomain(urlOrDomain) : urlOrDomain;
    if (!domain)
      return false;
    return this.cache.has(domain);
  }
  clearCache(urlOrDomain) {
    if (urlOrDomain) {
      const domain = urlOrDomain.includes("://") ? this.getDomain(urlOrDomain) : urlOrDomain;
      if (domain) {
        this.cache.delete(domain);
      }
    } else {
      this.cache.clear();
    }
  }
  getRulesCount(urlOrDomain) {
    const domain = urlOrDomain.includes("://") ? this.getDomain(urlOrDomain) : urlOrDomain;
    if (!domain)
      return 0;
    const parsed = this.cache.get(domain);
    return parsed?.rules.length || 0;
  }
}
export default RobotsHandler;
