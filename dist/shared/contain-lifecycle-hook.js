export function containLifecycleHook(run, onFailure) {
  const report = (error) => {
    try {
      onFailure?.(error);
    } catch {}
  };
  let outcome;
  try {
    outcome = run();
  } catch (error) {
    report(error);
    return;
  }
  if (outcome === null || typeof outcome !== "object" && typeof outcome !== "function")
    return;
  Promise.resolve(outcome).then(undefined, report);
}
