export function parseLinkHeader(header) {
  if (!header)
    return {};
  const links = {};
  const parts = header.split(",");
  for (const part of parts) {
    const urlMatch = part.match(/<([^>]+)>/);
    const relMatch = part.match(/rel\s*=\s*"?([^";,]+)"?/i);
    if (urlMatch && relMatch) {
      links[relMatch[1].trim()] = urlMatch[1].trim();
    }
  }
  return links;
}
