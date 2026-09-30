function ownFetchRequestStream(source, onCleanupError) {
  const reader = source.getReader();
  let ended = false;
  let released = false;
  const unlock = () => {
    if (!released) {
      released = true;
      reader.releaseLock();
    }
  };
  const cancel = async (reason) => {
    if (ended)
      return;
    ended = true;
    try {
      await reader.cancel(reason);
    } finally {
      unlock();
    }
  };
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const item = await reader.read();
        if (ended)
          return;
        if (item.done) {
          ended = true;
          unlock();
          controller.close();
        } else
          controller.enqueue(item.value);
      } catch (error) {
        if (!ended) {
          ended = true;
          unlock();
          controller.error(error);
        }
      }
    },
    cancel
  }, { highWaterMark: 0 });
  return {
    body,
    release() {
      cancel().catch(onCleanupError);
    }
  };
}

exports.ownFetchRequestStream = ownFetchRequestStream;