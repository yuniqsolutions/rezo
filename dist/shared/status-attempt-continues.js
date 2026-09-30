import { shouldWaitOnStatus } from '../utils/rate-limit-wait.js';
export function statusAttemptContinues(status, retry, retryAttempt, waitOnStatus) {
  if (shouldWaitOnStatus(status, waitOnStatus))
    return true;
  if (!retry)
    return false;
  return retry.statusCodes.includes(status) && retryAttempt < retry.maxRetries;
}
