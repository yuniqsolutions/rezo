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
function parseHTML(html) {
  return getLinkedom().parseHTML(html);
}
function createDOMParser() {
  const Linkedom = getLinkedom();
  return new Linkedom.DOMParser;
}

exports.parseHTML = parseHTML;
exports.createDOMParser = createDOMParser;