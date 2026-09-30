function estimateDownloadProgress(event) {
  const total = event.total || 0;
  const loaded = event.loaded;
  const speed = event.speed || event.averageSpeed || 0;
  const estimatedTime = event.estimatedTime !== undefined ? event.estimatedTime : total > loaded && speed > 0 ? (total - loaded) / speed * 1000 : 0;
  return {
    ...event,
    estimatedTime
  };
}
function estimateUploadProgress(event) {
  const total = event.total || 0;
  const loaded = event.loaded;
  const speed = event.speed || event.averageSpeed || 0;
  const estimatedTime = event.estimatedTime !== undefined ? event.estimatedTime : total > loaded && speed > 0 ? (total - loaded) / speed * 1000 : 0;
  return {
    ...event,
    estimatedTime
  };
}
function normalizeFileUri(uri) {
  return uri.startsWith("file://") ? uri.slice("file://".length) : uri;
}
function getFileNameFromUri(uri) {
  const normalized = uri.split("?")[0]?.split("#")[0] || uri;
  const parts = normalized.split("/");
  return parts[parts.length - 1] || "file";
}
function getUtf8ByteLength(value) {
  let bytes = 0;
  for (let index = 0;index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;
    if (codePoint <= 127) {
      bytes += 1;
    } else if (codePoint <= 2047) {
      bytes += 2;
    } else if (codePoint <= 65535) {
      bytes += 3;
    } else {
      bytes += 4;
      index += 1;
    }
  }
  return bytes;
}
function createProviderAbortError(operation, retainedPartial) {
  const error = new Error(retainedPartial ? `${operation} was aborted; partial output was retained at ${retainedPartial.path} (${retainedPartial.bytes} bytes).` : `${operation} was aborted.`);
  error.name = "AbortError";
  if (retainedPartial) {
    Reflect.set(error, "partialFile", {
      path: retainedPartial.path,
      size: retainedPartial.bytes,
      partial: true,
      retained: true,
      disposition: "retained"
    });
  }
  return error;
}
function observeLateSettlement(promise) {
  promise.then(() => {
    return;
  }, () => {
    return;
  });
  return promise;
}
function callWithAuthoritativeError(work, getAuthoritativeError) {
  try {
    return work();
  } catch (error) {
    throw getAuthoritativeError() ?? error;
  }
}
function containCancellation(work) {
  try {
    Promise.resolve(work()).catch(() => {
      return;
    });
  } catch {}
}
function createNativeCallbackTracker(getAuthoritativeError, onFailure) {
  let tail = Promise.resolve();
  let accepting = true;
  let failed = false;
  let reason;
  let rejectFailure;
  const failure = new Promise((_resolve, reject) => {
    rejectFailure = reject;
  });
  observeLateSettlement(failure);
  const settleFailure = (error) => {
    if (failed) {
      return;
    }
    failed = true;
    reason = getAuthoritativeError() ?? error;
    onFailure();
    rejectFailure(reason);
  };
  return {
    failure,
    get failed() {
      return failed;
    },
    get reason() {
      return reason;
    },
    invoke(work) {
      if (!accepting) {
        return;
      }
      let callbackPromise;
      try {
        callbackPromise = Promise.resolve(work());
      } catch (error) {
        settleFailure(error);
        return;
      }
      observeLateSettlement(callbackPromise);
      callbackPromise.catch(settleFailure);
      const settledCallback = callbackPromise.then(() => {
        return;
      }, () => {
        return;
      });
      tail = Promise.all([tail, settledCallback]).then(() => {
        return;
      });
      observeLateSettlement(tail);
    },
    close() {
      accepting = false;
    },
    async drain() {
      while (true) {
        const pending = tail;
        await pending;
        await Promise.resolve();
        if (pending === tail) {
          return;
        }
      }
    }
  };
}
function assertSupportedNativeDownloadRequest(providerName, request) {
  const method = (request.method || "GET").toUpperCase();
  const hasBody = request.body !== undefined && request.body !== null;
  if (method !== "GET" || hasBody) {
    throw new Error(`${providerName} file downloads only support GET requests without a request body.`);
  }
}
function normalizeHeadersToRecord(headers) {
  if (!headers) {
    return {};
  }
  if (typeof headers.entries === "function") {
    return Object.fromEntries(headers.entries());
  }
  return Object.fromEntries(Object.entries(headers));
}
function getHeaderValue(headers, name) {
  if (!headers) {
    return;
  }
  if (typeof headers.get === "function") {
    const value = headers.get?.(name);
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(normalizeHeadersToRecord(headers))) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }
  return;
}
function normalizeFetchStreamChunk(chunk) {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (!chunk) {
    return new Uint8Array;
  }
  if (chunk instanceof Uint8Array) {
    return chunk;
  }
  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk);
  }
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  return new Uint8Array;
}
function resolveFetchStreamFetcher(fetchImplOrModule) {
  if (typeof fetchImplOrModule === "function") {
    return fetchImplOrModule;
  }
  if (fetchImplOrModule && typeof fetchImplOrModule.fetch === "function") {
    return fetchImplOrModule.fetch.bind(fetchImplOrModule);
  }
  throw new TypeError("createFetchStreamTransport requires a fetch function or an object with a fetch method.");
}
function createFetchStreamTransport(fetchImplOrModule, options = {}) {
  const fetchImpl = resolveFetchStreamFetcher(fetchImplOrModule);
  return {
    name: options.name || "fetch-stream",
    async stream(request) {
      const signal = request.signal ?? undefined;
      if (signal?.aborted) {
        throw createProviderAbortError("Fetch stream");
      }
      let active = true;
      let reader;
      let abortError;
      let rejectAbort;
      const abortPromise = new Promise((_resolve, reject) => {
        rejectAbort = reject;
      });
      observeLateSettlement(abortPromise);
      const handleAbort = () => {
        if (!active) {
          return;
        }
        active = false;
        abortError = createProviderAbortError("Fetch stream");
        if (reader?.cancel) {
          containCancellation(() => reader.cancel(abortError));
        }
        rejectAbort(abortError);
      };
      signal?.addEventListener("abort", handleAbort, { once: true });
      try {
        if (signal?.aborted) {
          handleAbort();
        }
        if (!active) {
          throw abortError ?? createProviderAbortError("Fetch stream");
        }
        const responsePromise = observeLateSettlement(callWithAuthoritativeError(() => fetchImpl(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal,
          redirect: "manual"
        }), () => abortError));
        const response = await Promise.race([responsePromise, abortPromise]);
        if (!active) {
          throw abortError ?? createProviderAbortError("Fetch stream");
        }
        if (!response.body || typeof response.body.getReader !== "function") {
          throw new Error("Configured RN stream transport requires a readable response body. Use `expo/fetch` or another fetch implementation that exposes `response.body.getReader()`.");
        }
        const headers = normalizeHeadersToRecord(response.headers);
        const contentType = getHeaderValue(response.headers, "content-type");
        const contentLengthHeader = getHeaderValue(response.headers, "content-length");
        const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) || undefined : undefined;
        const finalUrl = response.url || request.url;
        reader = callWithAuthoritativeError(() => response.body.getReader(), () => abortError);
        if (signal?.aborted) {
          handleAbort();
        }
        if (!active) {
          throw abortError ?? createProviderAbortError("Fetch stream");
        }
        if (request.onHeaders) {
          const headersPromise = observeLateSettlement(Promise.resolve(callWithAuthoritativeError(() => request.onHeaders({
            status: response.status,
            statusText: response.statusText || "OK",
            headers,
            finalUrl,
            contentType,
            contentLength
          }), () => abortError)));
          await Promise.race([headersPromise, abortPromise]);
          if (!active) {
            throw abortError ?? createProviderAbortError("Fetch stream");
          }
        }
        const startedAt = Date.now();
        let loaded = 0;
        while (true) {
          const readPromise = observeLateSettlement(callWithAuthoritativeError(() => reader.read(), () => abortError));
          const { done, value } = await Promise.race([readPromise, abortPromise]);
          if (!active) {
            throw abortError ?? createProviderAbortError("Fetch stream");
          }
          if (done) {
            break;
          }
          const chunk = normalizeFetchStreamChunk(value);
          const chunkSize = typeof chunk === "string" ? getUtf8ByteLength(chunk) : chunk.byteLength;
          loaded += chunkSize;
          if (chunkSize > 0 && request.onChunk) {
            const chunkPromise = observeLateSettlement(Promise.resolve(callWithAuthoritativeError(() => request.onChunk(chunk), () => abortError)));
            await Promise.race([chunkPromise, abortPromise]);
            if (!active) {
              throw abortError ?? createProviderAbortError("Fetch stream");
            }
          }
          if (request.onProgress) {
            const elapsedMs = Math.max(Date.now() - startedAt, 1);
            const speed = loaded / (elapsedMs / 1000);
            const total = contentLength ?? 0;
            const progressPromise = observeLateSettlement(Promise.resolve(callWithAuthoritativeError(() => request.onProgress({
              loaded,
              total: contentLength,
              speed,
              averageSpeed: speed,
              estimatedTime: total > loaded && speed > 0 ? (total - loaded) / speed * 1000 : 0
            }), () => abortError)));
            await Promise.race([progressPromise, abortPromise]);
            if (!active) {
              throw abortError ?? createProviderAbortError("Fetch stream");
            }
          }
        }
        active = false;
        return {
          status: response.status,
          statusText: response.statusText || "OK",
          headers,
          finalUrl,
          contentType,
          contentLength
        };
      } finally {
        active = false;
        signal?.removeEventListener("abort", handleAbort);
        try {
          reader?.releaseLock?.();
        } catch (error) {
          if (!abortError) {
            throw error;
          }
        }
      }
    }
  };
}
function createExpoFileSystemAdapter(expoFileSystem, options = {}) {
  const uploadTaskModule = options.uploadTaskModule ?? null;
  const canUpload = typeof uploadTaskModule?.createUploadTask === "function" && !!uploadTaskModule?.FileSystemUploadType;
  return {
    name: "expo-file-system",
    capabilities: {
      fileDownload: true,
      downloadProgress: false,
      uploadFromFile: canUpload,
      uploadProgress: canUpload,
      backgroundTasks: false
    },
    async downloadFile(request) {
      assertSupportedNativeDownloadRequest("Expo FileSystem", request);
      const destination = new expoFileSystem.File(request.destination);
      const signal = request.signal ?? undefined;
      if (signal?.aborted) {
        throw createProviderAbortError("Expo FileSystem download");
      }
      let active = true;
      let abortError;
      let rejectAbort;
      const abortPromise = new Promise((_resolve, reject) => {
        rejectAbort = reject;
      });
      observeLateSettlement(abortPromise);
      const handleAbort = () => {
        if (!active) {
          return;
        }
        active = false;
        const bytes = typeof destination.size === "number" && Number.isFinite(destination.size) && destination.size >= 0 ? destination.size : 0;
        const retainedPartial = destination.exists === true || bytes > 0 ? { path: destination.uri || request.destination, bytes } : undefined;
        abortError = createProviderAbortError("Expo FileSystem download", retainedPartial);
        rejectAbort(abortError);
      };
      signal?.addEventListener("abort", handleAbort, { once: true });
      try {
        if (signal?.aborted) {
          handleAbort();
        }
        if (!active) {
          throw abortError ?? createProviderAbortError("Expo FileSystem download");
        }
        const downloadOptions = {
          headers: request.headers,
          idempotent: true,
          ...signal ? { signal } : {}
        };
        const downloadPromise = observeLateSettlement(Promise.resolve(callWithAuthoritativeError(() => expoFileSystem.File.downloadFileAsync(request.url, destination, downloadOptions), () => abortError)));
        if (signal?.aborted) {
          handleAbort();
        }
        const file = await Promise.race([downloadPromise, abortPromise]);
        if (!active) {
          throw abortError ?? createProviderAbortError("Expo FileSystem download");
        }
        const contentLength = typeof file.size === "number" ? file.size : undefined;
        if (request.onHeaders) {
          const headersPromise = observeLateSettlement(Promise.resolve(callWithAuthoritativeError(() => request.onHeaders({
            status: 200,
            statusText: "OK",
            finalUrl: request.url,
            contentLength
          }), () => abortError)));
          await Promise.race([headersPromise, abortPromise]);
          if (!active) {
            throw abortError ?? createProviderAbortError("Expo FileSystem download");
          }
        }
        if (contentLength !== undefined && request.onProgress) {
          const progressPromise = observeLateSettlement(Promise.resolve(callWithAuthoritativeError(() => request.onProgress({
            loaded: contentLength,
            total: contentLength,
            averageSpeed: 0,
            speed: 0,
            estimatedTime: 0
          }), () => abortError)));
          await Promise.race([progressPromise, abortPromise]);
          if (!active) {
            throw abortError ?? createProviderAbortError("Expo FileSystem download");
          }
        }
        active = false;
        return {
          status: 200,
          statusText: "OK",
          finalUrl: request.url,
          contentType: file.type,
          contentLength,
          filePath: file.uri || request.destination,
          fileSize: contentLength
        };
      } finally {
        active = false;
        signal?.removeEventListener("abort", handleAbort);
      }
    },
    ...canUpload ? {
      async uploadFile(request) {
        const signal = request.signal ?? undefined;
        if (signal?.aborted) {
          throw createProviderAbortError("Expo FileSystem upload");
        }
        const uploadType = request.binaryStreamOnly ? uploadTaskModule?.FileSystemUploadType?.BINARY_CONTENT : uploadTaskModule?.FileSystemUploadType?.MULTIPART;
        const startedAt = Date.now();
        let active = true;
        let abortError;
        let cancelTask = () => {
          return;
        };
        const getAbortAuthority = () => {
          if (!abortError && signal?.aborted) {
            abortError = createProviderAbortError("Expo FileSystem upload");
          }
          return abortError;
        };
        const progressCallbacks = createNativeCallbackTracker(getAbortAuthority, () => {
          active = false;
          cancelTask();
        });
        const throwInactive = () => {
          const authoritativeAbort = getAbortAuthority();
          if (authoritativeAbort) {
            throw authoritativeAbort;
          }
          if (progressCallbacks.failed) {
            throw progressCallbacks.reason;
          }
          throw createProviderAbortError("Expo FileSystem upload");
        };
        const task = callWithAuthoritativeError(() => uploadTaskModule.createUploadTask(request.url, request.file.uri, {
          headers: request.headers,
          httpMethod: request.method,
          uploadType,
          fieldName: request.file.fieldName,
          mimeType: request.file.type,
          parameters: request.fields
        }, (progress) => {
          if (!active || signal?.aborted) {
            return;
          }
          const elapsedMs = Math.max(Date.now() - startedAt, 1);
          const speed = progress.totalBytesSent / (elapsedMs / 1000);
          if (request.onProgress) {
            progressCallbacks.invoke(() => request.onProgress(estimateUploadProgress({
              loaded: progress.totalBytesSent,
              total: progress.totalBytesExpectedToSend,
              speed,
              averageSpeed: speed
            })));
          }
        }), getAbortAuthority);
        const abortedAfterTaskCreation = signal?.aborted === true;
        let cancelIssued = false;
        cancelTask = () => {
          if (cancelIssued || !task.cancelAsync) {
            return;
          }
          cancelIssued = true;
          containCancellation(() => task.cancelAsync());
        };
        if (!active) {
          cancelTask();
        }
        let rejectAbort;
        const abortPromise = new Promise((_resolve, reject) => {
          rejectAbort = reject;
        });
        observeLateSettlement(abortPromise);
        const handleAbort = () => {
          if (!active) {
            return;
          }
          active = false;
          abortError = createProviderAbortError("Expo FileSystem upload");
          cancelTask();
          rejectAbort(abortError);
        };
        signal?.addEventListener("abort", handleAbort, { once: true });
        try {
          if ((abortedAfterTaskCreation || signal?.aborted) && active) {
            handleAbort();
          }
          if (!active) {
            throwInactive();
          }
          let uploadPromise;
          try {
            uploadPromise = observeLateSettlement(Promise.resolve(callWithAuthoritativeError(() => task.uploadAsync(), getAbortAuthority)));
          } catch (error) {
            if (!active) {
              throwInactive();
            }
            throw error;
          }
          if (signal?.aborted) {
            handleAbort();
          }
          const result = await Promise.race([
            uploadPromise,
            abortPromise,
            progressCallbacks.failure
          ]);
          if (!active) {
            throwInactive();
          }
          progressCallbacks.close();
          await Promise.race([
            progressCallbacks.drain(),
            progressCallbacks.failure,
            abortPromise
          ]);
          if (!active) {
            throwInactive();
          }
          if (result === null || result === undefined) {
            throw new Error("Expo FileSystem upload result is missing.");
          }
          if (typeof result.status !== "number" || !Number.isFinite(result.status) || result.status <= 0) {
            throw new Error("Expo FileSystem upload status is invalid.");
          }
          const headers = result.headers || {};
          const contentType = headers["content-type"];
          const contentLength = parseInt(headers["content-length"] || "0", 10) || undefined;
          if (request.onHeaders) {
            const headersPromise = observeLateSettlement(Promise.resolve(callWithAuthoritativeError(() => request.onHeaders({
              status: result.status,
              statusText: "OK",
              headers,
              finalUrl: request.url,
              contentType,
              contentLength
            }), () => abortError)));
            await Promise.race([headersPromise, abortPromise]);
            if (!active) {
              throw abortError ?? createProviderAbortError("Expo FileSystem upload");
            }
          }
          active = false;
          return {
            status: result.status,
            statusText: "OK",
            headers,
            finalUrl: request.url,
            contentType,
            contentLength,
            body: result.body,
            uploadSize: request.file.size,
            fileName: request.file.name || getFileNameFromUri(request.file.uri)
          };
        } finally {
          active = false;
          progressCallbacks.close();
          signal?.removeEventListener("abort", handleAbort);
        }
      }
    } : {}
  };
}
function createReactNativeFsAdapter(rnfs, options = {}) {
  return {
    name: "react-native-fs",
    capabilities: {
      fileDownload: true,
      downloadProgress: true,
      uploadFromFile: !!rnfs.uploadFiles,
      uploadProgress: !!rnfs.uploadFiles,
      backgroundTasks: !!options.background
    },
    async downloadFile(request) {
      assertSupportedNativeDownloadRequest("react-native-fs", request);
      const signal = request.signal ?? undefined;
      if (signal?.aborted) {
        throw createProviderAbortError("react-native-fs download");
      }
      const startedAt = Date.now();
      let active = true;
      let jobId;
      let stopIssued = false;
      let lastBytesWritten = 0;
      let abortError;
      let rejectAbort;
      const abortPromise = new Promise((_resolve, reject) => {
        rejectAbort = reject;
      });
      observeLateSettlement(abortPromise);
      const stopTask = () => {
        if (stopIssued || jobId === undefined || !rnfs.stopDownload) {
          return;
        }
        stopIssued = true;
        containCancellation(() => rnfs.stopDownload(jobId));
      };
      const handleAbort = () => {
        if (!active) {
          return;
        }
        active = false;
        abortError = createProviderAbortError("react-native-fs download", lastBytesWritten > 0 ? { path: request.destination, bytes: lastBytesWritten } : undefined);
        stopTask();
        rejectAbort(abortError);
      };
      const nativeCallbacks = createNativeCallbackTracker(() => abortError, () => {
        active = false;
        stopTask();
      });
      const throwInactive = () => {
        if (abortError) {
          throw abortError;
        }
        if (nativeCallbacks.failed) {
          throw nativeCallbacks.reason;
        }
        throw createProviderAbortError("react-native-fs download");
      };
      signal?.addEventListener("abort", handleAbort, { once: true });
      try {
        const task = callWithAuthoritativeError(() => rnfs.downloadFile({
          fromUrl: request.url,
          toFile: request.destination,
          headers: request.headers,
          background: options.background,
          discretionary: options.discretionary,
          cacheable: options.cacheable,
          progressInterval: options.progressInterval,
          progressDivider: options.progressDivider,
          connectionTimeout: options.connectionTimeout,
          readTimeout: options.readTimeout,
          backgroundTimeout: options.backgroundTimeout,
          begin: (result) => {
            if (!active || signal?.aborted) {
              return;
            }
            if (request.onHeaders) {
              nativeCallbacks.invoke(() => request.onHeaders({
                status: result.statusCode,
                headers: result.headers,
                finalUrl: request.url,
                contentLength: result.contentLength
              }));
            }
          },
          progress: (result) => {
            if (!active || signal?.aborted) {
              return;
            }
            lastBytesWritten = result.bytesWritten;
            const elapsedMs = Math.max(Date.now() - startedAt, 1);
            const speed = result.bytesWritten / (elapsedMs / 1000);
            if (request.onProgress) {
              nativeCallbacks.invoke(() => request.onProgress(estimateDownloadProgress({
                loaded: result.bytesWritten,
                total: result.contentLength,
                speed,
                averageSpeed: speed
              })));
            }
          }
        }), () => abortError);
        const abortedAfterTaskCreation = signal?.aborted === true;
        jobId = task.jobId;
        const taskPromise = observeLateSettlement(task.promise);
        if (!active) {
          stopTask();
        } else if (abortedAfterTaskCreation || signal?.aborted) {
          handleAbort();
        }
        if (!active) {
          throwInactive();
        }
        const result = await Promise.race([
          taskPromise,
          abortPromise,
          nativeCallbacks.failure
        ]);
        if (!active) {
          throwInactive();
        }
        nativeCallbacks.close();
        await Promise.race([
          nativeCallbacks.drain(),
          nativeCallbacks.failure,
          abortPromise
        ]);
        if (!active) {
          throwInactive();
        }
        active = false;
        return {
          status: result.statusCode,
          headers: result.headers,
          finalUrl: request.url,
          contentLength: result.bytesWritten,
          filePath: request.destination,
          fileSize: result.bytesWritten
        };
      } finally {
        active = false;
        nativeCallbacks.close();
        signal?.removeEventListener("abort", handleAbort);
      }
    },
    ...rnfs.uploadFiles ? {
      async uploadFile(request) {
        const signal = request.signal ?? undefined;
        if (signal?.aborted) {
          throw createProviderAbortError("react-native-fs upload");
        }
        const startedAt = Date.now();
        let active = true;
        let jobId;
        let stopIssued = false;
        let abortError;
        let rejectAbort;
        const abortPromise = new Promise((_resolve, reject) => {
          rejectAbort = reject;
        });
        observeLateSettlement(abortPromise);
        const stopTask = () => {
          if (stopIssued || jobId === undefined || !rnfs.stopUpload) {
            return;
          }
          stopIssued = true;
          containCancellation(() => rnfs.stopUpload(jobId));
        };
        const handleAbort = () => {
          if (!active) {
            return;
          }
          active = false;
          abortError = createProviderAbortError("react-native-fs upload");
          stopTask();
          rejectAbort(abortError);
        };
        const nativeCallbacks = createNativeCallbackTracker(() => abortError, () => {
          active = false;
          stopTask();
        });
        const throwInactive = () => {
          if (abortError) {
            throw abortError;
          }
          if (nativeCallbacks.failed) {
            throw nativeCallbacks.reason;
          }
          throw createProviderAbortError("react-native-fs upload");
        };
        signal?.addEventListener("abort", handleAbort, { once: true });
        try {
          const task = callWithAuthoritativeError(() => rnfs.uploadFiles({
            toUrl: request.url,
            binaryStreamOnly: request.binaryStreamOnly,
            files: [{
              name: request.file.fieldName || "file",
              filename: request.file.name || getFileNameFromUri(request.file.uri),
              filepath: normalizeFileUri(request.file.uri),
              filetype: request.file.type
            }],
            headers: request.headers,
            fields: request.fields,
            method: request.method,
            begin: () => {
              if (!active || signal?.aborted || request.file.size === undefined) {
                return;
              }
              if (request.onProgress) {
                nativeCallbacks.invoke(() => request.onProgress({
                  loaded: 0,
                  total: request.file.size,
                  speed: 0,
                  averageSpeed: 0,
                  estimatedTime: 0
                }));
              }
            },
            progress: (result) => {
              if (!active || signal?.aborted) {
                return;
              }
              const elapsedMs = Math.max(Date.now() - startedAt, 1);
              const speed = result.totalBytesSent / (elapsedMs / 1000);
              if (request.onProgress) {
                nativeCallbacks.invoke(() => request.onProgress(estimateUploadProgress({
                  loaded: result.totalBytesSent,
                  total: result.totalBytesExpectedToSend,
                  speed,
                  averageSpeed: speed
                })));
              }
            }
          }), () => abortError);
          const abortedAfterTaskCreation = signal?.aborted === true;
          jobId = task.jobId;
          const taskPromise = observeLateSettlement(task.promise);
          if (!active) {
            stopTask();
          } else if (abortedAfterTaskCreation || signal?.aborted) {
            handleAbort();
          }
          if (!active) {
            throwInactive();
          }
          const result = await Promise.race([
            taskPromise,
            abortPromise,
            nativeCallbacks.failure
          ]);
          if (!active) {
            throwInactive();
          }
          nativeCallbacks.close();
          await Promise.race([
            nativeCallbacks.drain(),
            nativeCallbacks.failure,
            abortPromise
          ]);
          if (!active) {
            throwInactive();
          }
          const contentType = result.headers?.["content-type"];
          const contentLength = parseInt(result.headers?.["content-length"] || "0", 10) || undefined;
          if (request.onHeaders) {
            const headersPromise = observeLateSettlement(Promise.resolve(callWithAuthoritativeError(() => request.onHeaders({
              status: result.statusCode,
              headers: result.headers,
              finalUrl: request.url,
              contentType,
              contentLength
            }), () => abortError)));
            await Promise.race([headersPromise, abortPromise]);
            if (!active) {
              throw abortError ?? createProviderAbortError("react-native-fs upload");
            }
          }
          active = false;
          return {
            status: result.statusCode,
            headers: result.headers,
            finalUrl: request.url,
            contentType,
            contentLength,
            body: result.body,
            uploadSize: request.file.size,
            fileName: request.file.name || getFileNameFromUri(request.file.uri)
          };
        } finally {
          active = false;
          nativeCallbacks.close();
          signal?.removeEventListener("abort", handleAbort);
        }
      }
    } : {}
  };
}
function createNetInfoProvider(netInfo) {
  return {
    async fetch() {
      const state = await netInfo.fetch();
      return {
        type: state.type,
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
        isExpensive: state.isConnectionExpensive,
        details: state.details
      };
    },
    subscribe(listener) {
      let active = true;
      const subscription = netInfo.addEventListener((state) => {
        if (!active) {
          return;
        }
        listener({
          type: state.type,
          isConnected: state.isConnected,
          isInternetReachable: state.isInternetReachable,
          isExpensive: state.isConnectionExpensive,
          details: state.details
        });
      });
      let removed = false;
      return () => {
        if (removed) {
          return;
        }
        active = false;
        removed = true;
        if (typeof subscription === "function") {
          subscription();
        } else {
          subscription.remove();
        }
      };
    }
  };
}
function createExpoBackgroundTaskProvider(backgroundTask, taskManager) {
  return {
    registerTask(task) {
      if (task.metadata !== undefined) {
        return Promise.reject(new Error("Expo background task metadata is unsupported and was refused."));
      }
      return backgroundTask.registerTaskAsync(task.name, {
        minimumInterval: task.minimumInterval
      });
    },
    unregisterTask(name) {
      return backgroundTask.unregisterTaskAsync(name);
    },
    isTaskRegistered(name) {
      return taskManager.isTaskRegisteredAsync(name);
    }
  };
}

exports.createFetchStreamTransport = createFetchStreamTransport;
exports.createExpoFileSystemAdapter = createExpoFileSystemAdapter;
exports.createReactNativeFsAdapter = createReactNativeFsAdapter;
exports.createNetInfoProvider = createNetInfoProvider;
exports.createExpoBackgroundTaskProvider = createExpoBackgroundTaskProvider;