function createTotalDeadline(totalMs) {
  const controller = new AbortController;
  const armedAt = performance.now();
  let expired = false;
  let timer = setTimeout(() => {
    timer = undefined;
    expired = true;
    controller.abort();
  }, totalMs);
  if (typeof timer === "object" && typeof timer.unref === "function")
    timer.unref();
  return {
    signal: controller.signal,
    totalMs,
    elapsed() {
      const measured = Math.round(performance.now() - armedAt);
      return expired ? Math.max(totalMs, measured) : measured;
    },
    expired() {
      return expired;
    },
    clear() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    }
  };
}

exports.createTotalDeadline = createTotalDeadline;