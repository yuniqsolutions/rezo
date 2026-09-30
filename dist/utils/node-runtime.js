function getBuiltinModuleResolver() {
  const host = globalThis.process;
  const resolver = host?.getBuiltinModule;
  return typeof resolver === "function" ? resolver.bind(host) : undefined;
}
function getDynamicRequire() {
  try {
    return Function('return typeof require !== "undefined" ? require : undefined;')();
  } catch {
    return;
  }
}
const dynamicImport = Function("specifier", "return import(specifier);");
export function requireNodeModule(specifier) {
  for (const resolve of [getBuiltinModuleResolver(), getDynamicRequire()]) {
    if (!resolve)
      continue;
    try {
      const resolved = resolve(specifier);
      if (resolved)
        return resolved;
    } catch {}
  }
  return;
}
export async function importNodeModule(specifier) {
  try {
    return await dynamicImport(specifier);
  } catch {
    return requireNodeModule(specifier);
  }
}
