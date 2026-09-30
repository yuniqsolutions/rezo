function combineWaitInterrupts(callerSignal, totalSignal) {
  const sources = [callerSignal, totalSignal].filter((signal) => signal !== undefined);
  if (sources.length === 0)
    return { signal: undefined, release: () => {
      return;
    } };
  if (sources.length === 1)
    return { signal: sources[0], release: () => {
      return;
    } };
  const controller = new AbortController;
  const onAbort = () => controller.abort();
  for (const signal of sources) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  return { signal: controller.signal, release: () => {
    for (const signal of sources)
      signal.removeEventListener("abort", onAbort);
  } };
}

exports.combineWaitInterrupts = combineWaitInterrupts;