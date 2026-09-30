const { shouldWaitOnStatus } = require('../utils/rate-limit-wait.cjs');
function statusAttemptContinues(status, retry, retryAttempt, waitOnStatus) {
  if (shouldWaitOnStatus(status, waitOnStatus))
    return true;
  if (!retry)
    return false;
  return retry.statusCodes.includes(status) && retryAttempt < retry.maxRetries;
}

exports.statusAttemptContinues = statusAttemptContinues;