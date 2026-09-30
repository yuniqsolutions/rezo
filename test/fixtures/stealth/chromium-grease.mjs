// Independent re-implementation of Chromium's greased User-Agent brand list
// (components/embedder_support/user_agent_utils.cc, GetGreasedUserAgentBrandVersion):
// seed = major version; the grease brand is "Not" + chars[seed % 11] + "A" + chars[(seed + 1) % 11] + "Brand",
// its version is one of "8" / "99" / "24" by seed % 3, and the three entries are permuted by seed % 6.
// Validated against real captures: 120, 124, 128, 131 (profile constants) and 146 (local Chrome capture, 2026-08-23).

const GREASE_CHARS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
const GREASE_VERSIONS = ['8', '99', '24'];
const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/** Returns the `sec-ch-ua` value Chromium `major` sends for the given product brand (e.g. "Google Chrome", "Microsoft Edge"). */
export function chromiumGreaseBrands(major, brand) {
  const seed = Number(major);
  if (!Number.isInteger(seed) || seed <= 0) throw new Error(`invalid major version ${major}`);
  const greasy = `"Not${GREASE_CHARS[seed % GREASE_CHARS.length]}A${GREASE_CHARS[(seed + 1) % GREASE_CHARS.length]}Brand";v="${GREASE_VERSIONS[seed % GREASE_VERSIONS.length]}"`;
  const chromium = `"Chromium";v="${seed}"`;
  const product = `"${brand}";v="${seed}"`;
  const order = ORDERS[seed % ORDERS.length];
  const list = [];
  list[order[0]] = greasy; list[order[1]] = chromium; list[order[2]] = product;
  return list.join(', ');
}

/** Known real-world observations the algorithm must reproduce (any mismatch means the rule, not the browser, is wrong). */
export const KNOWN_OBSERVATIONS = [
  { major: 120, brand: 'Google Chrome', value: '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"', source: 'profile constant chrome-120 (Chrome 120 capture)' },
  { major: 124, brand: 'Google Chrome', value: '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"', source: 'profile constant chrome-124' },
  { major: 128, brand: 'Google Chrome', value: '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"', source: 'profile constant chrome-128' },
  { major: 131, brand: 'Google Chrome', value: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"', source: 'Chrome 131 navigation capture' },
  // The 2026-08-23 local capture recorded the grease token only, not the brand order — assert exactly what was observed.
  { major: 146, brand: 'Google Chrome', greaseToken: '"Not-A.Brand";v="24"', source: 'local Chrome 146 headless capture 2026-08-23' },
];

/** Checks every known observation against the algorithm; returns the mismatches (empty when the rule holds). */
export function validateKnownObservations() {
  const mismatches = [];
  for (const known of KNOWN_OBSERVATIONS) {
    const produced = chromiumGreaseBrands(known.major, known.brand);
    if (known.value !== undefined && produced !== known.value) mismatches.push({ major: known.major, produced, expected: known.value });
    if (known.greaseToken !== undefined && !produced.split(', ').includes(known.greaseToken)) mismatches.push({ major: known.major, produced, expectedToken: known.greaseToken });
  }
  return mismatches;
}
