class RezoPerformance {
  start;
  constructor() {
    this.start = performance.now();
  }
  now() {
    return parseFloat((performance.now() - this.start).toFixed(2));
  }
  reset() {
    this.start = performance.now();
  }
}
function isSameDomain(url1, url2) {
  return new URL(url1).hostname === new URL(url2).hostname;
}
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const REDACTED = "[REDACTED]";
const URL_TO_STRING = URL.prototype.toString;
const SENSITIVE_PARAMETER_NAMES = new Set([
  "access_token",
  "accesstoken",
  "api-key",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "authenticity_token",
  "awsaccesskeyid",
  "client_assertion",
  "client_secret",
  "clientsecret",
  "cookie",
  "credential",
  "id_token",
  "idtoken",
  "oauth_signature",
  "oauth_token",
  "oauth_token_secret",
  "oauth_verifier",
  "password",
  "passwd",
  "proxy-authorization",
  "pwd",
  "refresh_token",
  "refreshtoken",
  "secret",
  "session",
  "session_id",
  "session_token",
  "sessionid",
  "sessiontoken",
  "set-cookie",
  "sig",
  "signature",
  "token",
  "x-amz-credential",
  "x-amz-security-token",
  "x-amz-signature",
  "x-api-key",
  "x-goog-credential",
  "x-goog-signature"
]);
const CREDENTIAL_HEADER_NAMES = [
  "proxy-authorization",
  "authorization",
  "set-cookie",
  "cookie"
];
const CREDENTIAL_HEADER = `(?:${CREDENTIAL_HEADER_NAMES.join("|")})`;
const DIAGNOSTIC_CONTROL_SOURCE = "[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]";
const CONTROL_SPLIT_CREDENTIAL_HEADER = new RegExp(`(?:${CREDENTIAL_HEADER_NAMES.map((name) => [...name].join(`${DIAGNOSTIC_CONTROL_SOURCE}*`)).join("|")})(?=\\s*:)`, "gi");
const DIAGNOSTIC_URL_SCHEMES = [
  "socks5h:",
  "socks4a:",
  "socks5:",
  "socks4:",
  "https:",
  "socks:",
  "http:",
  "ftp:"
];
const MAX_DIAGNOSTIC_URL_SCHEME_LENGTH = Math.max(...DIAGNOSTIC_URL_SCHEMES.map((scheme) => scheme.length));
const MAX_DIAGNOSTIC_SANITIZATION_PASSES = 4;
const FULL_CREDENTIAL_HEADER = new RegExp(`^(\\s*)(${CREDENTIAL_HEADER})(\\s*:\\s*)`, "i");
const INLINE_CREDENTIAL_HEADER = new RegExp(`(^|[^A-Za-z0-9_-])(${CREDENTIAL_HEADER})(\\s*:\\s*)(.*?)(?=(?:;\\s*(?:${CREDENTIAL_HEADER}|url)\\s*:)|$)`, "gi");
function urlString(value) {
  return typeof value === "string" ? value : URL_TO_STRING.call(value);
}
function classifyRedirectOrigin(sourceUrl, destinationUrl) {
  try {
    const source = new URL(urlString(sourceUrl));
    if (!HTTP_PROTOCOLS.has(source.protocol))
      return "invalid";
    const destination = new URL(urlString(destinationUrl), source);
    if (!HTTP_PROTOCOLS.has(destination.protocol))
      return "invalid";
    if (source.protocol === "https:" && destination.protocol === "http:") {
      return "downgrade";
    }
    return source.origin === destination.origin ? "same-origin" : "cross-origin";
  } catch {
    return "invalid";
  }
}
function safeDiagnosticString(value) {
  if (typeof value === "string")
    return value;
  if (value === null)
    return "null";
  if (value === undefined)
    return "undefined";
  if (typeof value === "object" || typeof value === "function") {
    try {
      return URL_TO_STRING.call(value);
    } catch {
      return;
    }
  }
  try {
    return String(value);
  } catch {
    return;
  }
}
function neutralizeDiagnosticBreaks(value) {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ");
}
function isDiagnosticControl(character) {
  const code = character.charCodeAt(0);
  return code <= 31 || code >= 127 && code <= 159 || code === 8232 || code === 8233;
}
function isDiagnosticPadding(character) {
  return character === " " || character === "\t" || character === "\f";
}
function normalizedParameterName(rawName) {
  try {
    return decodeURIComponent(rawName.replace(/\+/g, " ")).trim().toLowerCase();
  } catch {
    return;
  }
}
function analyzeParameterPair(pair, inspectEmbeddedCredentials = true) {
  let segmentStart = 0;
  while (segmentStart <= pair.length) {
    const questionMark = pair.indexOf("?", segmentStart);
    const segmentEnd = questionMark < 0 ? pair.length : questionMark;
    const segment = pair.slice(segmentStart, segmentEnd);
    const equals = segment.indexOf("=");
    if (equals >= 0) {
      const rawName = segment.slice(0, equals);
      const name = normalizedParameterName(rawName);
      if (name === undefined || SENSITIVE_PARAMETER_NAMES.has(name)) {
        return {
          sanitized: `${pair.slice(0, segmentStart)}${rawName.trim()}=${REDACTED}`,
          containsSensitiveAssignment: true
        };
      }
      if (inspectEmbeddedCredentials && containsEmbeddedCredentialUrl(segment.slice(equals + 1))) {
        return {
          sanitized: `${pair.slice(0, segmentStart)}${rawName.trim()}=${REDACTED}`,
          containsSensitiveAssignment: true
        };
      }
    }
    if (questionMark < 0)
      break;
    segmentStart = questionMark + 1;
  }
  return { sanitized: pair, containsSensitiveAssignment: false };
}
function sanitizeParameterPair(pair) {
  return analyzeParameterPair(pair).sanitized;
}
function sanitizeParameterList(value) {
  return value.split(/([&;])/).map((part, index) => index % 2 === 0 ? sanitizeParameterPair(part) : part).join("");
}
function sanitizeUrlComponents(value) {
  const fragmentAt = value.indexOf("#");
  const beforeFragment = fragmentAt < 0 ? value : value.slice(0, fragmentAt);
  const fragment = fragmentAt < 0 ? undefined : value.slice(fragmentAt + 1);
  const queryAt = beforeFragment.indexOf("?");
  const base = queryAt < 0 ? beforeFragment : beforeFragment.slice(0, queryAt);
  const query = queryAt < 0 ? undefined : beforeFragment.slice(queryAt + 1);
  return base + (query === undefined ? "" : `?${sanitizeParameterList(query)}`) + (fragment === undefined ? "" : `#${sanitizeParameterList(fragment)}`);
}
function parameterListContainsSensitiveAssignment(value) {
  let pairStart = 0;
  for (let index = 0;index <= value.length; index += 1) {
    if (index < value.length && value[index] !== "&" && value[index] !== ";") {
      continue;
    }
    if (analyzeParameterPair(value.slice(pairStart, index), false).containsSensitiveAssignment) {
      return true;
    }
    pairStart = index + 1;
  }
  return false;
}
function urlParametersContainSensitiveAssignment(value) {
  const fragmentAt = value.indexOf("#");
  const beforeFragment = fragmentAt < 0 ? value : value.slice(0, fragmentAt);
  const fragment = fragmentAt < 0 ? undefined : value.slice(fragmentAt + 1);
  const queryAt = beforeFragment.indexOf("?");
  const query = queryAt < 0 ? undefined : beforeFragment.slice(queryAt + 1);
  return query !== undefined && parameterListContainsSensitiveAssignment(query) || fragment !== undefined && parameterListContainsSensitiveAssignment(fragment);
}
function sanitizeDiagnosticUrl(value) {
  const extracted = safeDiagnosticString(value);
  if (extracted === undefined)
    return REDACTED;
  let contentStart = 0;
  let contentEnd = extracted.length;
  while (contentStart < contentEnd && (isDiagnosticControl(extracted[contentStart]) || /[\f ]/.test(extracted[contentStart]))) {
    contentStart += 1;
  }
  while (contentEnd > contentStart && (isDiagnosticControl(extracted[contentEnd - 1]) || /[\f ]/.test(extracted[contentEnd - 1]))) {
    contentEnd -= 1;
  }
  for (let index = contentStart;index < contentEnd; index += 1) {
    if (isDiagnosticControl(extracted[index]) || extracted[index] === "\\")
      return REDACTED;
  }
  const input = neutralizeDiagnosticBreaks(extracted);
  let coreStart = 0;
  let coreEnd = input.length;
  while (coreStart < coreEnd && isDiagnosticPadding(input[coreStart])) {
    coreStart += 1;
  }
  while (coreEnd > coreStart && isDiagnosticPadding(input[coreEnd - 1])) {
    coreEnd -= 1;
  }
  const leading = input.slice(0, coreStart);
  const core = input.slice(coreStart, coreEnd);
  const trailing = input.slice(coreEnd);
  const protocolRelative = core.startsWith("//");
  const absolute = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(core);
  if (!protocolRelative && !absolute)
    return sanitizeUrlComponents(input);
  try {
    const preparedCore = urlParametersContainSensitiveAssignment(core) ? sanitizeUrlComponents(core) : core;
    const parsed = new URL(protocolRelative ? `https:${preparedCore}` : preparedCore);
    parsed.username = "";
    parsed.password = "";
    const sanitized = sanitizeUrlComponents(URL_TO_STRING.call(parsed));
    const url = protocolRelative ? sanitized.slice("https:".length) : sanitized;
    return `${leading}${url}${trailing}`;
  } catch {
    return REDACTED;
  }
}
function sanitizeCredentialHeaders(value) {
  let previousWasCredential = false;
  return value.split(/\r\n|\r|\n|\u2028|\u2029/).map((line) => {
    if (previousWasCredential && /^[ \t]+/.test(line)) {
      return `${line.match(/^[ \t]*/)?.[0] ?? ""}${REDACTED}`;
    }
    let remaining = line;
    let sanitized = "";
    let matchedCredential = false;
    while (true) {
      const fullHeader = remaining.match(FULL_CREDENTIAL_HEADER);
      if (!fullHeader)
        break;
      matchedCredential = true;
      const headerValue = remaining.slice(fullHeader[0].length);
      const safeTailAt = headerValue.search(/\s+(?=(?:https?|ftp):\/\/|\/\/|[A-Za-z][A-Za-z0-9-]*\s*:)/i);
      sanitized += `${fullHeader[1]}${fullHeader[2]}${fullHeader[3]}${REDACTED}`;
      if (safeTailAt < 0) {
        remaining = "";
        break;
      }
      remaining = headerValue.slice(safeTailAt);
    }
    if (matchedCredential) {
      previousWasCredential = true;
      INLINE_CREDENTIAL_HEADER.lastIndex = 0;
      return sanitized + remaining.replace(INLINE_CREDENTIAL_HEADER, (_match, prefix, name, separator) => `${prefix}${name}${separator}${REDACTED}`);
    }
    previousWasCredential = false;
    INLINE_CREDENTIAL_HEADER.lastIndex = 0;
    return line.replace(INLINE_CREDENTIAL_HEADER, (_match, prefix, name, separator) => `${prefix}${name}${separator}${REDACTED}`);
  }).join(`
`);
}
function normalizeControlSplitCredentialHeaders(value) {
  return value.replace(CONTROL_SPLIT_CREDENTIAL_HEADER, (name) => name.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ""));
}
function hasRedactedSuffixAt(value, end) {
  const start = end - REDACTED.length;
  return start >= 0 && value.startsWith(REDACTED, start);
}
function splitTrailingPunctuation(candidate, beforeAnotherUrl = false) {
  if (beforeAnotherUrl) {
    if (hasRedactedSuffixAt(candidate, candidate.length))
      return [candidate, ""];
    const lastIndex = candidate.length - 1;
    if (!isEmbeddedUrlProseBoundary(candidate[lastIndex]))
      return [candidate, ""];
    let punctuationStart = lastIndex;
    for (let cursor = lastIndex;cursor > 0; cursor -= 1) {
      if (hasRedactedSuffixAt(candidate, cursor)) {
        punctuationStart = cursor;
        break;
      }
      if (!isEmbeddedUrlProseBoundary(candidate[cursor - 1]))
        break;
    }
    return [candidate.slice(0, punctuationStart), candidate.slice(punctuationStart)];
  }
  let end = candidate.length;
  while (end > 0) {
    if (hasRedactedSuffixAt(candidate, end))
      break;
    const trailing = candidate[end - 1];
    const isBoundary = /[.!?,|—;#()\]}]/.test(trailing);
    if (!isBoundary)
      break;
    end -= 1;
  }
  return [candidate.slice(0, end), candidate.slice(end)];
}
function isEmbeddedUrlTerminator(character) {
  return !isDiagnosticControl(character) && /[\s<>"'`]/.test(character);
}
function isWhatwgIgnoredUrlControl(character) {
  return character === "\t" || character === `
` || character === "\r";
}
function foldedMarkerEndAt(value, index, marker) {
  let cursor = index;
  for (let markerIndex = 0;markerIndex < marker.length; markerIndex += 1) {
    while (markerIndex > 0 && cursor < value.length && isWhatwgIgnoredUrlControl(value[cursor])) {
      cursor += 1;
    }
    if (value[cursor]?.toLowerCase() !== marker[markerIndex])
      return 0;
    cursor += 1;
  }
  return cursor;
}
function networkMarkerEndAt(value, index) {
  if (value[index] !== "/" && value[index] !== "\\")
    return 0;
  let cursor = index + 1;
  while (cursor < value.length && isWhatwgIgnoredUrlControl(value[cursor])) {
    cursor += 1;
  }
  return value[cursor] === "/" || value[cursor] === "\\" ? cursor + 1 : 0;
}
function foldedAbsoluteUrlMarkerEndAt(value, index) {
  let schemeEnd = 0;
  for (const scheme of DIAGNOSTIC_URL_SCHEMES) {
    schemeEnd = foldedMarkerEndAt(value, index, scheme);
    if (schemeEnd > 0)
      break;
  }
  if (schemeEnd === 0)
    return 0;
  let nextIndex = schemeEnd;
  while (nextIndex < value.length && isWhatwgIgnoredUrlControl(value[nextIndex])) {
    nextIndex += 1;
  }
  const next = value[nextIndex];
  if (next === undefined || isEmbeddedUrlTerminator(next))
    return 0;
  return networkMarkerEndAt(value, nextIndex) || schemeEnd;
}
function absoluteUrlMarkerEndAt(value, index) {
  const markerEnd = foldedAbsoluteUrlMarkerEndAt(value, index);
  if (markerEnd === 0)
    return 0;
  if (index === 0 || !/[A-Za-z0-9_]/.test(value[index - 1]))
    return markerEnd;
  return urlCandidateContainsCredentials(value, index, markerEnd) ? markerEnd : 0;
}
function ignoredControlFallsInsideUrlMarker(value, index, lowerBound) {
  if (!isWhatwgIgnoredUrlControl(value[index]))
    return false;
  let markerCharacters = 0;
  for (let candidateStart = index - 1;candidateStart >= lowerBound && markerCharacters < MAX_DIAGNOSTIC_URL_SCHEME_LENGTH; candidateStart -= 1) {
    if (isWhatwgIgnoredUrlControl(value[candidateStart]))
      continue;
    markerCharacters += 1;
    const markerEnd = foldedAbsoluteUrlMarkerEndAt(value, candidateStart) || networkMarkerEndAt(value, candidateStart);
    if (markerEnd > index)
      return true;
  }
  return false;
}
function authorityContainsUserInfo(value, start) {
  for (let index = start;index < value.length; index += 1) {
    const character = value[index];
    if (character === "@")
      return true;
    if (character === "/" || character === "\\" || character === "?" || character === "#" || isEmbeddedUrlTerminator(character)) {
      return false;
    }
  }
  return false;
}
function findEmbeddedUrlStarts(value) {
  const starts = [];
  for (let index = 0;index < value.length; index += 1) {
    const absoluteMarkerEnd = absoluteUrlMarkerEndAt(value, index);
    if (absoluteMarkerEnd > 0) {
      starts.push(index);
      index = absoluteMarkerEnd - 1;
      continue;
    }
    const networkMarkerEnd = networkMarkerEndAt(value, index);
    if (networkMarkerEnd === 0)
      continue;
    const hasOrdinaryBoundary = index === 0 || !/[A-Za-z0-9+.:/_-]/.test(value[index - 1]);
    const authorityStart = value[networkMarkerEnd];
    if (hasOrdinaryBoundary || authorityStart !== "/" && authorityStart !== "\\" && urlCandidateContainsCredentials(value, index, networkMarkerEnd)) {
      starts.push(index);
      index = networkMarkerEnd - 1;
    }
  }
  return starts;
}
function findParameterEquals(value, parameterStart, limit) {
  for (let index = parameterStart;index < limit; index += 1) {
    const character = value[index];
    if (character === "=")
      return index;
    if (character === "&" || character === ";" || character === "?" || character === "#" || isEmbeddedUrlTerminator(character) && !/\s/.test(character)) {
      return -1;
    }
  }
  return -1;
}
function parameterNameIsSensitiveOrUnsafe(value, parameterStart, equalsAt) {
  const rawName = value.slice(parameterStart, equalsAt);
  for (const character of rawName) {
    if (isDiagnosticControl(character) || character === "\\")
      return true;
  }
  const name = normalizedParameterName(rawName);
  return name === undefined || SENSITIVE_PARAMETER_NAMES.has(name);
}
function findEmbeddedUrlEnd(value, start, limit, nestedMarkerAfter) {
  let parameterStart = -1;
  let assignmentAt = -1;
  let pendingAssignmentAt = -1;
  let assignmentIsSensitive = false;
  let valueStarted = false;
  for (let index = start;index < limit; index += 1) {
    const character = value[index];
    if (nestedMarkerAfter !== undefined && index >= nestedMarkerAfter && (foldedAbsoluteUrlMarkerEndAt(value, index) > 0 || networkMarkerEndAt(value, index) > 0)) {
      return index;
    }
    if (character === "?" || character === "#" || character === "&" || character === ";") {
      parameterStart = index + 1;
      assignmentAt = -1;
      pendingAssignmentAt = -1;
      assignmentIsSensitive = false;
      valueStarted = false;
      continue;
    }
    if (character === "=" && parameterStart >= 0 && assignmentAt < 0) {
      assignmentAt = index;
      assignmentIsSensitive = pendingAssignmentAt === index ? assignmentIsSensitive : parameterNameIsSensitiveOrUnsafe(value, parameterStart, index);
      pendingAssignmentAt = -1;
      valueStarted = false;
      continue;
    }
    if (isEmbeddedUrlTerminator(character)) {
      if (/\s/.test(character) && parameterStart >= 0) {
        if (assignmentAt < 0 && pendingAssignmentAt < index) {
          pendingAssignmentAt = findParameterEquals(value, parameterStart, limit);
          assignmentIsSensitive = pendingAssignmentAt >= 0 && parameterNameIsSensitiveOrUnsafe(value, parameterStart, pendingAssignmentAt);
        }
        if (assignmentIsSensitive && (pendingAssignmentAt > index || assignmentAt >= 0 && !valueStarted)) {
          continue;
        }
      }
      return index;
    }
    if (assignmentAt >= 0)
      valueStarted = true;
  }
  return limit;
}
function urlCandidateContainsCredentials(value, start, markerEnd) {
  const candidateEnd = findEmbeddedUrlEnd(value, start, value.length, markerEnd);
  const candidate = value.slice(start, candidateEnd);
  const authorityStart = markerEnd - start;
  return authorityContainsUserInfo(candidate, authorityStart) || urlParametersContainSensitiveAssignment(candidate);
}
function containsEmbeddedCredentialUrl(value) {
  for (let index = 0;index < value.length; index += 1) {
    const markerEnd = foldedAbsoluteUrlMarkerEndAt(value, index) || networkMarkerEndAt(value, index);
    if (markerEnd === 0)
      continue;
    if (urlCandidateContainsCredentials(value, index, markerEnd))
      return true;
    index = markerEnd - 1;
  }
  return false;
}
function isEmbeddedUrlProseBoundary(character) {
  return character !== undefined && (character.charCodeAt(0) <= 126 || character === "—") && !isDiagnosticControl(character) && character !== "\\" && !/[A-Za-z0-9+.:/_-]/.test(character);
}
function splitExistingRedactionSuffix(candidate) {
  if (!candidate.endsWith(REDACTED))
    return [candidate, ""];
  const sentinelStart = candidate.length - REDACTED.length;
  let punctuationStart = sentinelStart;
  while (punctuationStart > 0 && !hasRedactedSuffixAt(candidate, punctuationStart) && isEmbeddedUrlProseBoundary(candidate[punctuationStart - 1])) {
    punctuationStart -= 1;
  }
  return punctuationStart === sentinelStart ? [candidate, ""] : [candidate.slice(0, punctuationStart), candidate.slice(punctuationStart)];
}
function includeFailClosedBoundaryPrefixes(value, starts) {
  if (starts.length < 2)
    return starts;
  const prefixed = [starts[0]];
  for (let index = 1;index < starts.length; index += 1) {
    const start = starts[index];
    let prefix = start;
    while (prefix > starts[index - 1]) {
      const character = value[prefix - 1];
      if (!isDiagnosticControl(character) && character !== "\\")
        break;
      prefix -= 1;
    }
    prefixed.push(prefix < start && isEmbeddedUrlProseBoundary(value[prefix - 1]) ? prefix : start);
  }
  return prefixed;
}
function isUnambiguousEmbeddedUrlBoundary(character) {
  return character !== undefined && /[|,—;#()\]}]/.test(character);
}
function findControlSeparatedProseBoundaries(value, rawStarts, effectiveStarts) {
  const boundaries = new Map;
  for (let startIndex = 1;startIndex < rawStarts.length; startIndex += 1) {
    const nextStart = rawStarts[startIndex];
    let hasGenericBoundary = false;
    let hasStrongBoundary = false;
    for (let index = rawStarts[startIndex - 1];index < nextStart; index += 1) {
      if (value.startsWith(REDACTED, index)) {
        index += REDACTED.length - 1;
        continue;
      }
      const character = value[index];
      if (isEmbeddedUrlTerminator(character))
        break;
      if (isDiagnosticControl(character) || character === "\\") {
        if (hasStrongBoundary || hasGenericBoundary) {
          const previousStart = rawStarts[startIndex - 1];
          const previousMarkerEnd = absoluteUrlMarkerEndAt(value, previousStart) || networkMarkerEndAt(value, previousStart);
          if (previousMarkerEnd > index || ignoredControlFallsInsideUrlMarker(value, index, previousStart)) {
            break;
          }
          boundaries.set(effectiveStarts[startIndex], {
            at: index,
            candidateStart: character === "\\" ? index : effectiveStarts[startIndex],
            releasesSensitiveValue: !hasRedactedSuffixAt(value, index) && isUnambiguousEmbeddedUrlBoundary(value[index - 1])
          });
        }
        break;
      }
      if (isEmbeddedUrlProseBoundary(character)) {
        hasGenericBoundary = true;
        if (isUnambiguousEmbeddedUrlBoundary(character)) {
          hasStrongBoundary = true;
        }
      }
    }
  }
  return boundaries;
}
function filterFailClosedCandidateStarts(value, starts, controlSeparatedBoundaries) {
  if (starts.length < 2)
    return starts;
  const filtered = [];
  let segmentStartIndex = 0;
  let scanCursor = starts[0];
  let segmentFailsClosed = false;
  for (let nextStartIndex = 1;nextStartIndex <= starts.length; nextStartIndex += 1) {
    const nextStart = starts[nextStartIndex] ?? value.length;
    const separatedAt = controlSeparatedBoundaries.get(nextStart)?.at;
    const scanEnd = separatedAt ?? nextStart;
    let crossedTerminator = false;
    for (let index = scanCursor;index < scanEnd; index += 1) {
      const character = value[index];
      if (isEmbeddedUrlTerminator(character)) {
        crossedTerminator = true;
        break;
      }
      if (isDiagnosticControl(character) || character === "\\") {
        segmentFailsClosed = true;
      }
    }
    const crossedProseBoundary = separatedAt !== undefined || nextStartIndex < starts.length && isEmbeddedUrlProseBoundary(value[nextStart - 1]);
    if (crossedTerminator || crossedProseBoundary || nextStartIndex === starts.length) {
      if (segmentFailsClosed) {
        filtered.push(starts[segmentStartIndex]);
      } else {
        for (let index = segmentStartIndex;index < nextStartIndex; index += 1) {
          filtered.push(starts[index]);
        }
      }
      segmentStartIndex = nextStartIndex;
      segmentFailsClosed = false;
    }
    scanCursor = nextStart;
  }
  return filtered;
}
function filterSensitiveValueStarts(value, starts, controlSeparatedBoundaries) {
  if (starts.length < 2)
    return starts;
  const filtered = [starts[0]];
  let cursor = starts[0];
  let parameterStart = -1;
  let assigned = false;
  let sensitive = false;
  let crossedHardBoundary = false;
  for (let startIndex = 1;startIndex < starts.length; startIndex += 1) {
    const start = starts[startIndex];
    for (let index = cursor;index < start; index += 1) {
      const character = value[index];
      if (isEmbeddedUrlTerminator(character)) {
        parameterStart = -1;
        assigned = false;
        sensitive = false;
        crossedHardBoundary = true;
        continue;
      }
      if (crossedHardBoundary)
        continue;
      if (parameterStart < 0) {
        if (character === "?" || character === "#")
          parameterStart = index + 1;
        continue;
      }
      if (character === "&" || character === ";" || character === "#" || character === "?" && !sensitive) {
        parameterStart = index + 1;
        assigned = false;
        sensitive = false;
        continue;
      }
      if (character === "=" && !assigned) {
        const name = normalizedParameterName(value.slice(parameterStart, index));
        sensitive = name === undefined || SENSITIVE_PARAMETER_NAMES.has(name);
        assigned = true;
      }
    }
    const boundary = controlSeparatedBoundaries.get(start);
    const explicitProseBoundary = boundary === undefined ? /[|,—()\]}]/.test(value[start - 1]) : boundary.releasesSensitiveValue;
    if (!sensitive || crossedHardBoundary || explicitProseBoundary) {
      filtered.push(start);
      parameterStart = -1;
      assigned = false;
      sensitive = false;
      crossedHardBoundary = false;
    }
    cursor = start;
  }
  return filtered;
}
function sanitizeEmbeddedUrlCandidate(candidate, beforeAnotherUrl) {
  const [url, punctuation] = splitTrailingPunctuation(candidate, beforeAnotherUrl);
  for (const character of url) {
    if (isDiagnosticControl(character) || character === "\\") {
      return {
        value: beforeAnotherUrl ? `${REDACTED}${punctuation}` : REDACTED,
        detachedPunctuation: punctuation,
        hasActiveSensitivePair: false,
        collapsedToSentinel: true
      };
    }
  }
  const hasActiveSensitivePair = urlParametersContainSensitiveAssignment(candidate) || url !== candidate && urlParametersContainSensitiveAssignment(url);
  const preparedUrl = hasActiveSensitivePair ? sanitizeUrlComponents(url) : url;
  const sanitizedUrl = sanitizeDiagnosticUrl(preparedUrl);
  if (hasActiveSensitivePair) {
    const value = beforeAnotherUrl ? `${sanitizedUrl}${punctuation}` : sanitizeDiagnosticUrl(sanitizeUrlComponents(candidate));
    return {
      value,
      detachedPunctuation: punctuation,
      hasActiveSensitivePair: true,
      collapsedToSentinel: value === REDACTED
    };
  }
  if (beforeAnotherUrl && url.endsWith(REDACTED) && sanitizedUrl.endsWith(REDACTED)) {
    return {
      value: `${sanitizedUrl}${punctuation}`,
      detachedPunctuation: punctuation,
      hasActiveSensitivePair: false,
      collapsedToSentinel: sanitizedUrl === REDACTED
    };
  }
  const [urlBeforeSentinel, sentinelSuffix] = splitExistingRedactionSuffix(url);
  if (sentinelSuffix.length > 0) {
    const sanitizedPrefix = sanitizeDiagnosticUrl(urlBeforeSentinel);
    return {
      value: `${sanitizedPrefix}${sentinelSuffix}${punctuation}`,
      detachedPunctuation: punctuation,
      hasActiveSensitivePair: false,
      collapsedToSentinel: sanitizedPrefix === REDACTED
    };
  }
  if (beforeAnotherUrl) {
    return {
      value: `${sanitizedUrl}${punctuation}`,
      detachedPunctuation: punctuation,
      hasActiveSensitivePair: false,
      collapsedToSentinel: sanitizedUrl === REDACTED
    };
  }
  const complete = punctuation.length === 0 ? sanitizedUrl : sanitizeDiagnosticUrl(candidate);
  const value = complete.endsWith(REDACTED) ? complete : punctuation.length === 0 ? complete : `${sanitizedUrl}${punctuation}`;
  return {
    value,
    detachedPunctuation: punctuation,
    hasActiveSensitivePair: false,
    collapsedToSentinel: value === REDACTED
  };
}
function containsDiagnosticHardBoundary(value) {
  for (const character of value) {
    if (isEmbeddedUrlTerminator(character) || isDiagnosticControl(character)) {
      return true;
    }
  }
  return false;
}
function sanitizeEmbeddedUrls(value) {
  const rawStarts = findEmbeddedUrlStarts(value);
  const prefixedStarts = includeFailClosedBoundaryPrefixes(value, rawStarts);
  const controlSeparatedBoundaries = findControlSeparatedProseBoundaries(value, rawStarts, prefixedStarts);
  const sensitiveStarts = filterSensitiveValueStarts(value, prefixedStarts, controlSeparatedBoundaries);
  const starts = filterFailClosedCandidateStarts(value, sensitiveStarts, controlSeparatedBoundaries);
  if (starts.length === 0)
    return value;
  const candidates = starts.flatMap((start, index) => {
    const candidateStart = controlSeparatedBoundaries.get(start)?.candidateStart ?? start;
    const nextStart = starts[index + 1] ?? value.length;
    const separatedAt = controlSeparatedBoundaries.get(nextStart)?.at;
    const endLimit = separatedAt ?? nextStart;
    const end = findEmbeddedUrlEnd(value, candidateStart, endLimit);
    const beforeAnotherUrl = index + 1 < starts.length;
    if (candidateStart < start && end < start) {
      const actualEnd = findEmbeddedUrlEnd(value, start, endLimit);
      return [
        {
          candidateStart,
          end,
          sanitized: sanitizeEmbeddedUrlCandidate(value.slice(candidateStart, end), true)
        },
        {
          candidateStart: start,
          end: actualEnd,
          sanitized: sanitizeEmbeddedUrlCandidate(value.slice(start, actualEnd), beforeAnotherUrl)
        }
      ];
    }
    return [{
      candidateStart,
      end,
      sanitized: sanitizeEmbeddedUrlCandidate(value.slice(candidateStart, end), beforeAnotherUrl)
    }];
  });
  const output = [];
  let cursor = 0;
  for (let index = 0;index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const nextCandidate = candidates[index + 1];
    let sanitized = candidate.sanitized.value;
    if (nextCandidate?.sanitized.collapsedToSentinel && candidate.sanitized.hasActiveSensitivePair) {
      const gap = value.slice(candidate.end, nextCandidate.candidateStart);
      const hasHardBoundary = containsDiagnosticHardBoundary(gap);
      const punctuation = candidate.sanitized.detachedPunctuation;
      if (punctuation.length > 0 && sanitized.endsWith(punctuation)) {
        sanitized = `${sanitized.slice(0, -punctuation.length)} ${punctuation}`;
      }
      if (!hasHardBoundary)
        sanitized += " ";
    }
    output.push(value.slice(cursor, candidate.candidateStart));
    output.push(sanitized);
    cursor = candidate.end;
  }
  output.push(value.slice(cursor));
  return output.join("");
}
function sanitizeDiagnosticTextPass(value) {
  const normalizedHeaders = normalizeControlSplitCredentialHeaders(value);
  return sanitizeCredentialHeaders(neutralizeDiagnosticBreaks(sanitizeEmbeddedUrls(sanitizeCredentialHeaders(normalizedHeaders))));
}
function sanitizeDiagnosticText(value) {
  const extracted = safeDiagnosticString(value);
  if (extracted === undefined)
    return REDACTED;
  let sanitized = extracted;
  for (let pass = 0;pass < MAX_DIAGNOSTIC_SANITIZATION_PASSES; pass += 1) {
    const next = sanitizeDiagnosticTextPass(sanitized);
    if (next === sanitized)
      return next;
    sanitized = next;
  }
  return REDACTED;
}

exports.RezoPerformance = RezoPerformance;
exports.isSameDomain = isSameDomain;
exports.classifyRedirectOrigin = classifyRedirectOrigin;
exports.sanitizeDiagnosticUrl = sanitizeDiagnosticUrl;
exports.sanitizeDiagnosticText = sanitizeDiagnosticText;