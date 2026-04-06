function isIPv4(host) {
  const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
  return ipv4Regex.test(host);
}
function isDomain(host) {
  const domainRegex = /^(?=.{1,253}$)(?!-)([a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/;
  return domainRegex.test(host);
}
function isNumeric(value) {
  if (typeof value === "number")
    return isFinite(value);
  if (typeof value === "string" && value.trim() !== "") {
    return !isNaN(Number(value));
  }
  return false;
}
function parseProxyString(input) {
  if (!input)
    return null;
  let host = "";
  let port = 0;
  let username;
  let password;
  const proto = input.includes("://") ? input.split("://")[0].toLowerCase() : "";
  const protocol = proto.startsWith("http") ? "http" : proto.startsWith("https") ? "https" : proto.startsWith("socks4") ? "socks4" : "socks5";
  if (protocol !== "socks5" || input.includes("://")) {
    input = input.split("://")[1];
  }
  const getProxy = (authPart, hostPart) => {
    if (authPart && authPart.includes(":")) {
      const [p1, ..._p2] = authPart.split(":");
      const p2 = _p2.join(":");
      if ((isIPv4(p1) || isDomain(p1)) && isNumeric(p2)) {
        host = p1;
        port = parseInt(p2, 10);
      } else {
        username = p1;
        password = p2;
      }
    }
    if (hostPart && hostPart.includes(":")) {
      const [p1, ..._p2] = hostPart.split(":");
      const p2 = _p2.join(":");
      if ((isIPv4(p1) || isDomain(p1)) && isNumeric(p2)) {
        host = p1;
        port = parseInt(p2, 10);
      } else {
        username = p1;
        password = p2;
      }
    }
    if (!host && !port)
      return null;
    if (username && password) {
      return { protocol, host, port, auth: { username, password } };
    }
    return {
      protocol,
      host,
      port
    };
  };
  input = input.trim();
  if (input.includes("@")) {
    const [authPart, hostPart] = input.split("@");
    if (!authPart && !hostPart)
      return null;
    return getProxy(authPart, hostPart);
  } else if (input.split(":").length === 4 || input.split(":").length === 2) {
    const parts = input.split(":");
    const authPart = input.split(":").length === 2 ? undefined : parts[2] + ":" + parts[3];
    const hostPart = parts[0] + ":" + parts[1];
    return getProxy(authPart || "", hostPart || "");
  } else {
    return null;
  }
}

exports.parseProxyString = parseProxyString;