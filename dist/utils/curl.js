import { RezoFormData } from './form-data.js';
export function toCurl(config) {
  const parts = ["curl"];
  const method = (config.method || "GET").toUpperCase();
  if (method !== "GET") {
    parts.push("-X", method);
  }
  const headers = config.headers || {};
  const normalizedHeaders = {};
  if (headers && typeof headers === "object") {
    const headersAny = headers;
    if (typeof headersAny.entries === "function") {
      for (const [key, value] of headersAny.entries()) {
        normalizedHeaders[key.toLowerCase()] = value;
      }
    } else if (typeof headersAny.forEach === "function") {
      headersAny.forEach((value, key) => {
        normalizedHeaders[key.toLowerCase()] = value;
      });
    } else {
      for (const [key, value] of Object.entries(headers)) {
        if (value !== undefined && value !== null) {
          normalizedHeaders[key.toLowerCase()] = String(value);
        }
      }
    }
  }
  for (const [key, value] of Object.entries(normalizedHeaders)) {
    parts.push("-H", escapeShellArg(`${key}: ${value}`));
  }
  const body = config.body ?? config.data;
  if (body !== undefined && body !== null) {
    let dataString;
    if (typeof body === "string") {
      dataString = body;
    } else if (body instanceof RezoFormData) {
      const entries = [];
      const formData = body.toNativeFormData();
      formData.forEach((value, key) => {
        entries.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
      });
      dataString = entries.join("&");
      parts.push("--data-urlencode", escapeShellArg(dataString));
    } else if (typeof body === "object") {
      const contentType = normalizedHeaders["content-type"] || "";
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const params = new URLSearchParams;
        for (const [key, value] of Object.entries(body)) {
          params.append(key, String(value));
        }
        dataString = params.toString();
      } else {
        dataString = JSON.stringify(body);
        if (!normalizedHeaders["content-type"]) {
          parts.push("-H", escapeShellArg("content-type: application/json"));
        }
      }
    } else {
      dataString = String(body);
    }
    if (!(body instanceof RezoFormData)) {
      if (method === "GET" || method === "HEAD") {
        parts.push("-G", "--data-raw", escapeShellArg(dataString));
      } else {
        parts.push("--data-raw", escapeShellArg(dataString));
      }
    }
  }
  if (config.timeout) {
    const timeoutSeconds = Math.ceil(config.timeout / 1000);
    parts.push("--max-time", String(timeoutSeconds));
  }
  if (config.maxRedirects !== undefined) {
    if (config.maxRedirects === 0) {
      parts.push("--no-location");
    } else {
      parts.push("-L", "--max-redirs", String(config.maxRedirects));
    }
  } else {
    parts.push("-L");
  }
  if (config.auth) {
    const auth = `${config.auth.username}:${config.auth.password}`;
    parts.push("-u", escapeShellArg(auth));
  }
  if (config.proxy) {
    let proxyUrl;
    if (typeof config.proxy === "string") {
      proxyUrl = config.proxy;
    } else if (config.proxy && typeof config.proxy === "object" && "host" in config.proxy) {
      const p = config.proxy;
      const protocol = p.protocol || "http";
      const authStr = p.auth ? `${p.auth.username}:${p.auth.password}@` : "";
      proxyUrl = `${protocol}://${authStr}${p.host}:${p.port}`;
    } else {
      proxyUrl = String(config.proxy);
    }
    if (proxyUrl.startsWith("socks")) {
      parts.push("--socks5", escapeShellArg(proxyUrl.replace(/^socks[45]a?:\/\//, "")));
    } else {
      parts.push("-x", escapeShellArg(proxyUrl));
    }
  }
  if (config.rejectUnauthorized === false || config.insecure) {
    parts.push("-k");
  }
  parts.push("--compressed");
  const url = config.fullUrl || config.url || "";
  parts.push(escapeShellArg(String(url)));
  return parts.join(" ");
}
export function fromCurl(curlCommand) {
  const trimmed = curlCommand.trim();
  if (!trimmed.toLowerCase().startsWith("curl ")) {
    throw new Error('Invalid curl command: must start with "curl "');
  }
  const tokens = tokenize(trimmed.slice(5));
  const result = {
    url: "",
    method: "GET",
    headers: {}
  };
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === "-X" || token === "--request") {
      result.method = tokens[++i]?.toUpperCase() || "GET";
    } else if (token === "-H" || token === "--header") {
      const header = tokens[++i];
      if (header) {
        const colonIndex = header.indexOf(":");
        if (colonIndex > 0) {
          const key = header.slice(0, colonIndex).trim().toLowerCase();
          const value = header.slice(colonIndex + 1).trim();
          result.headers[key] = value;
        }
      }
    } else if (token === "-d" || token === "--data" || token === "--data-raw" || token === "--data-binary") {
      const data = tokens[++i];
      if (data) {
        if (result.method === "GET") {
          result.method = "POST";
        }
        if (data.startsWith("{") || data.startsWith("[")) {
          try {
            result.body = JSON.parse(data);
          } catch {
            result.body = data;
          }
        } else {
          result.body = data;
        }
      }
    } else if (token === "--data-urlencode") {
      const data = tokens[++i];
      if (data) {
        if (result.method === "GET") {
          result.method = "POST";
        }
        result.body = data;
        if (!result.headers["content-type"]) {
          result.headers["content-type"] = "application/x-www-form-urlencoded";
        }
      }
    } else if (token === "-G" || token === "--get") {
      result.method = "GET";
    } else if (token === "-b" || token === "--cookie") {
      result.cookies = tokens[++i];
    } else if (token === "-u" || token === "--user") {
      const auth = tokens[++i];
      if (auth) {
        const colonIndex = auth.indexOf(":");
        if (colonIndex > 0) {
          result.auth = {
            username: auth.slice(0, colonIndex),
            password: auth.slice(colonIndex + 1)
          };
        } else {
          result.auth = { username: auth, password: "" };
        }
      }
    } else if (token === "-x" || token === "--proxy") {
      result.proxy = tokens[++i];
    } else if (token === "--socks5" || token === "--socks5-hostname" || token === "--socks4" || token === "--socks4a") {
      const proxyHost = tokens[++i];
      const protocol = token.replace("--", "").replace("-hostname", "");
      result.proxy = `${protocol}://${proxyHost}`;
    } else if (token === "-A" || token === "--user-agent") {
      result.userAgent = tokens[++i];
      if (result.userAgent) {
        result.headers["user-agent"] = result.userAgent;
      }
    } else if (token === "-L" || token === "--location") {
      result.followRedirects = true;
    } else if (token === "--no-location") {
      result.followRedirects = false;
    } else if (token === "--max-redirs") {
      result.maxRedirects = parseInt(tokens[++i] || "0", 10);
    } else if (token === "--max-time" || token === "-m") {
      result.timeout = parseInt(tokens[++i] || "0", 10) * 1000;
    } else if (token === "--connect-timeout") {
      i++;
    } else if (token === "-k" || token === "--insecure") {
      result.insecure = true;
    } else if (token === "--compressed") {
      result.compressed = true;
    } else if (token === "-s" || token === "--silent" || token === "-S" || token === "--show-error") {} else if (token === "-o" || token === "--output") {
      i++;
    } else if (token === "-I" || token === "--head") {
      result.method = "HEAD";
    } else if (!token.startsWith("-")) {
      if (!result.url) {
        result.url = token;
      }
    }
    i++;
  }
  const config = {
    url: result.url,
    method: result.method,
    headers: result.headers
  };
  if (result.body) {
    config.body = result.body;
  }
  if (result.auth) {
    config.auth = result.auth;
  }
  if (result.proxy) {
    config.proxy = result.proxy;
  }
  if (result.timeout) {
    config.timeout = result.timeout;
  }
  if (result.maxRedirects !== undefined) {
    config.maxRedirects = result.maxRedirects;
  }
  if (result.insecure) {
    config.rejectUnauthorized = false;
  }
  if (result.cookies) {
    config.headers = config.headers || {};
    config.headers["cookie"] = result.cookies;
  }
  return config;
}
function escapeShellArg(arg) {
  if (arg === "")
    return "''";
  if (!/[^a-zA-Z0-9_\-=:/.@]/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
function tokenize(input) {
  const tokens = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (escaped) {
      current += char;
      escaped = false;
      i++;
      continue;
    }
    if (char === "\\" && !inSingleQuote) {
      if (inDoubleQuote) {
        const nextChar = input[i + 1];
        if (nextChar === '"' || nextChar === "\\" || nextChar === "$" || nextChar === "`") {
          escaped = true;
          i++;
          continue;
        }
      } else {
        escaped = true;
        i++;
        continue;
      }
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      i++;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      i++;
      continue;
    }
    if ((char === " " || char === "\t" || char === `
`) && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      while (i + 1 < input.length && (input[i + 1] === " " || input[i + 1] === "\t" || input[i + 1] === `
`)) {
        i++;
      }
      i++;
      continue;
    }
    current += char;
    i++;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}
