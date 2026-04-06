export function createTimingTracker() {
  return {
    startTime: performance.now()
  };
}
export function markDnsStart(tracker) {
  if (!tracker.dnsStart) {
    tracker.dnsStart = performance.now();
  }
}
export function markDnsEnd(tracker) {
  if (!tracker.dnsEnd) {
    tracker.dnsEnd = performance.now();
    if (!tracker.tcpStart) {
      tracker.tcpStart = tracker.dnsEnd;
    }
  }
}
export function markConnectStart(tracker) {
  if (!tracker.tcpStart) {
    tracker.tcpStart = performance.now();
  }
}
export function markSecureConnectStart(tracker) {
  if (!tracker.tlsStart) {
    tracker.tlsStart = performance.now();
  }
}
export function markConnectEnd(tracker) {
  const now = performance.now();
  if (!tracker.tcpEnd) {
    tracker.tcpEnd = now;
  }
  if (!tracker.tlsEnd && tracker.tlsStart) {
    tracker.tlsEnd = now;
  }
  if (!tracker.requestStart) {
    tracker.requestStart = now;
  }
}
export function markRequestStart(tracker) {
  if (!tracker.requestStart) {
    tracker.requestStart = performance.now();
  }
}
export function markResponseStart(tracker) {
  if (!tracker.firstByteTime) {
    tracker.firstByteTime = performance.now();
  }
}
export function markResponseEnd(tracker) {
  tracker.responseEnd = performance.now();
}
export function buildTimingMarks(tracker) {
  const now = tracker.responseEnd || performance.now();
  const start = tracker.startTime;
  return {
    startTime: start,
    domainLookupStart: tracker.dnsStart ?? start,
    domainLookupEnd: tracker.dnsEnd ?? tracker.dnsStart ?? start,
    connectStart: tracker.tcpStart ?? tracker.dnsEnd ?? start,
    secureConnectionStart: tracker.tlsStart ?? 0,
    connectEnd: tracker.tcpEnd ?? tracker.tlsEnd ?? tracker.tcpStart ?? start,
    requestStart: tracker.requestStart ?? tracker.tcpEnd ?? start,
    responseStart: tracker.firstByteTime ?? tracker.requestStart ?? start,
    responseEnd: now
  };
}
export function getTimingDurations(marks) {
  return {
    dns: marks.domainLookupEnd - marks.domainLookupStart,
    tcp: marks.secureConnectionStart > 0 ? marks.secureConnectionStart - marks.connectStart : marks.connectEnd - marks.connectStart,
    tls: marks.secureConnectionStart > 0 ? marks.connectEnd - marks.secureConnectionStart : 0,
    ttfb: marks.responseStart - marks.startTime,
    transfer: marks.responseEnd - marks.responseStart,
    total: marks.responseEnd - marks.startTime
  };
}
