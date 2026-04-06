const XSSI_PREFIXES = [
  `)]}'
`,
  ")]}'",
  ")]}",
  `)]}
`,
  "for(;;);",
  "while(1);",
  "while(true);",
  "/**/"
];
export function hasXssiPrefix(str) {
  const trimmed = str.trimStart();
  return XSSI_PREFIXES.some((p) => trimmed.startsWith(p));
}
export function stripXssiPrefix(str) {
  let trimmed = str.trimStart();
  for (const prefix of XSSI_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      trimmed = trimmed.slice(prefix.length).trimStart();
      break;
    }
  }
  return trimmed;
}
function isLengthPrefixed(body) {
  return /^\d+\n/.test(body);
}
function parseLengthPrefixed(body) {
  const results = [];
  const errors = [];
  const envelopes = [];
  const chunks = [];
  let pos = 0;
  while (pos < body.length) {
    while (pos < body.length && /\s/.test(body[pos]))
      pos++;
    if (pos >= body.length)
      break;
    const lenEnd = body.indexOf(`
`, pos);
    if (lenEnd === -1)
      break;
    const lenStr = body.substring(pos, lenEnd);
    if (!/^\d+$/.test(lenStr))
      break;
    pos = lenEnd + 1;
    const nextLen = body.substring(pos).search(/\n\d+\n/);
    let chunkEnd;
    if (nextLen !== -1) {
      chunkEnd = pos + nextLen;
    } else {
      chunkEnd = body.length;
    }
    chunks.push(body.substring(pos, chunkEnd).trim());
    pos = chunkEnd;
  }
  for (const chunk of chunks) {
    if (!chunk)
      continue;
    let parsed;
    try {
      parsed = JSON.parse(chunk);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed))
      continue;
    for (const envelope of parsed) {
      if (!Array.isArray(envelope))
        continue;
      envelopes.push(envelope);
      const type = envelope[0];
      if (type === "wrb.fr") {
        const rpcId = envelope[1];
        const rawPayload = envelope[2];
        let data = rawPayload;
        if (typeof rawPayload === "string") {
          try {
            data = JSON.parse(rawPayload);
          } catch {}
        }
        results.push({ rpcId, data });
      } else if (type === "e") {
        errors.push({ code: envelope[1], raw: envelope });
      }
    }
  }
  return { results, errors, envelopes };
}
export function parseXssiJson(body) {
  const stripped = stripXssiPrefix(body);
  const first = stripped.charAt(0);
  if (first === "{" || first === "[") {
    try {
      return JSON.parse(stripped);
    } catch {}
  }
  if (isLengthPrefixed(stripped)) {
    const batch = parseLengthPrefixed(stripped);
    if (batch.envelopes.length > 0)
      return batch;
  }
  return stripped;
}
export function parseBatchExecute(body) {
  const stripped = stripXssiPrefix(body);
  const batch = parseLengthPrefixed(stripped);
  if (batch.envelopes.length > 0)
    return batch;
  return stripped;
}
