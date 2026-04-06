let _linkedom = null;
function getLinkedom() {
  if (_linkedom)
    return _linkedom;
  try {
    _linkedom = require("linkedom");
    return _linkedom;
  } catch {
    throw new Error(`linkedom is required for DOM parsing but is not installed.
` + `Install it with: npm install linkedom
` + "Or: bun add linkedom");
  }
}
export function parseHTML(html) {
  return getLinkedom().parseHTML(html);
}
export function createDOMParser() {
  const Linkedom = getLinkedom();
  return new Linkedom.DOMParser;
}
