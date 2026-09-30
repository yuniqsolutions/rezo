function createFetchRequestDeadline(timeout) {
  const totalTimeout = typeof timeout === "number" ? Number.isFinite(timeout) && timeout > 0 ? timeout : undefined : Number.isFinite(timeout?.total) && Number(timeout?.total) > 0 ? timeout?.total : undefined;
  const headersTimeout = typeof timeout === "object" && timeout !== null && Number.isFinite(timeout.headers) && Number(timeout.headers) > 0 ? timeout.headers : undefined;
  const bodyTimeout = typeof timeout === "object" && timeout !== null && Number.isFinite(timeout.body) && Number(timeout.body) > 0 ? timeout.body : undefined;
  if (totalTimeout === undefined && headersTimeout === undefined && bodyTimeout === undefined) {
    return;
  }
  const requestStartedAt = performance.now();
  const totalController = totalTimeout === undefined ? undefined : new AbortController;
  let attemptController;
  let phaseTimer;
  let totalTimer;
  let attemptExpiration;
  let totalExpiration;
  const expire = (phase, configuredTimeout, phaseStartedAt, controller) => {
    if (phase === "total") {
      if (totalExpiration !== undefined)
        return;
    } else if (totalExpiration !== undefined || attemptExpiration !== undefined) {
      return;
    }
    const expiration = Object.freeze({
      phase,
      timeout: configuredTimeout,
      elapsed: Math.max(configuredTimeout, Math.round(performance.now() - phaseStartedAt))
    });
    if (phase === "total")
      totalExpiration = expiration;
    else
      attemptExpiration = expiration;
    controller?.abort();
    if (controller !== attemptController)
      attemptController?.abort();
  };
  if (totalTimeout !== undefined) {
    totalTimer = setTimeout(() => {
      expire("total", totalTimeout, requestStartedAt, totalController);
    }, totalTimeout);
  }
  return {
    totalSignal: totalController?.signal,
    startAttempt() {
      if (phaseTimer !== undefined) {
        clearTimeout(phaseTimer);
        phaseTimer = undefined;
      }
      attemptController = headersTimeout === undefined && bodyTimeout === undefined ? undefined : new AbortController;
      attemptExpiration = undefined;
      if (totalExpiration !== undefined) {
        attemptController?.abort();
      } else if (headersTimeout !== undefined && attemptController !== undefined) {
        const phaseStartedAt = performance.now();
        phaseTimer = setTimeout(() => {
          expire("headers", headersTimeout, phaseStartedAt, attemptController);
        }, headersTimeout);
      }
      return attemptController?.signal;
    },
    startBody() {
      if (phaseTimer !== undefined) {
        clearTimeout(phaseTimer);
        phaseTimer = undefined;
      }
      if (totalExpiration === undefined && attemptExpiration === undefined && bodyTimeout !== undefined && attemptController !== undefined) {
        const phaseStartedAt = performance.now();
        phaseTimer = setTimeout(() => {
          expire("body", bodyTimeout, phaseStartedAt, attemptController);
        }, bodyTimeout);
      }
    },
    finishAttempt() {
      if (phaseTimer !== undefined) {
        clearTimeout(phaseTimer);
        phaseTimer = undefined;
      }
      attemptController = undefined;
      attemptExpiration = undefined;
    },
    expiration() {
      return totalExpiration ?? attemptExpiration;
    },
    clear() {
      if (phaseTimer !== undefined) {
        clearTimeout(phaseTimer);
        phaseTimer = undefined;
      }
      if (totalTimer !== undefined) {
        clearTimeout(totalTimer);
        totalTimer = undefined;
      }
      attemptController = undefined;
      attemptExpiration = undefined;
      totalExpiration = undefined;
    }
  };
}

exports.createFetchRequestDeadline = createFetchRequestDeadline;