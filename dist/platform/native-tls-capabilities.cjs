function isNativeAgentPfxKnownUnsupported() {
  return Boolean(typeof process !== "undefined" && process.versions?.bun);
}

exports.isNativeAgentPfxKnownUnsupported = isNativeAgentPfxKnownUnsupported;