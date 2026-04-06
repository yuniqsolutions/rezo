function getDynamicRequire() {
  try {
    return Function('return typeof require !== "undefined" ? require : undefined;')();
  } catch {
    return;
  }
}
const dynamicImport = Function("specifier", "return import(specifier);");
export function requireNodeModule(specifier) {
  const dynamicRequire = getDynamicRequire();
  if (!dynamicRequire) {
    return;
  }
  try {
    return dynamicRequire(specifier);
  } catch {
    return;
  }
}
export async function importNodeModule(specifier) {
  try {
    return await dynamicImport(specifier);
  } catch {
    return requireNodeModule(specifier);
  }
}
