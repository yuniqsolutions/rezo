import { RezoError } from '../errors/rezo-error.js';
export function createFetchTimeoutError(expiration, config, request) {
  const message = expiration.phase === "total" ? `Total timeout: Request exceeded maximum duration of ${expiration.elapsed}ms` : expiration.phase === "headers" ? `Headers timeout: Server did not send response headers within ${expiration.elapsed}ms` : `Body timeout: Response body transfer stalled for ${expiration.elapsed}ms`;
  const error = new RezoError(message, config, expiration.phase === "total" ? "ECONNABORTED" : "ESOCKETTIMEDOUT", request);
  Object.defineProperties(error, {
    phase: { configurable: true, enumerable: true, value: expiration.phase },
    elapsed: { configurable: true, enumerable: true, value: expiration.elapsed }
  });
  return error;
}
