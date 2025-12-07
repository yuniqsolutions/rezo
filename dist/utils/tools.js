export class RezoPerformance {
  start;
  constructor() {
    this.start = performance.now();
  }
  now() {
    return parseFloat((performance.now() - this.start).toFixed(2));
  }
  reset() {
    this.start = performance.now();
  }
}
export function isSameDomain(url1, url2) {
  return new URL(url1).hostname === new URL(url2).hostname;
}
