import { RezoError } from '../errors/rezo-error.js';
const PHASE_MESSAGES = {
  connect: (elapsed) => `Connection timeout: Failed to establish TCP connection within ${elapsed}ms`,
  headers: (elapsed) => `Headers timeout: Server did not send response headers within ${elapsed}ms`,
  body: (elapsed) => `Body timeout: Response body transfer stalled for ${elapsed}ms`,
  total: (elapsed) => `Total timeout: Request exceeded maximum duration of ${elapsed}ms`
};
export function createStagedTimeoutError(phase, elapsed, config, request) {
  const code = phase === "connect" ? "ETIMEDOUT" : phase === "total" ? "ECONNABORTED" : "ESOCKETTIMEDOUT";
  const error = new RezoError(PHASE_MESSAGES[phase](elapsed), config, code, request);
  error.phase = phase;
  error.elapsed = elapsed;
  return error;
}
