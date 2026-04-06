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
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: request.signal ?? undefined,
        redirect: "manual"
      });
      const headers = normalizeHeadersToRecord(response.headers);
      const contentType = getHeaderValue(response.headers, "content-type");
      const contentLengthHeader = getHeaderValue(response.headers, "content-length");
      const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) || undefined : undefined;
      const finalUrl = response.url || request.url;
      await request.onHeaders?.({
        status: response.status,
        statusText: response.statusText || "OK",
        headers,
        finalUrl,
        contentType,
        contentLength
      });
      if (!response.body || typeof response.body.getReader !== "function") {
        throw new Error("Configured RN stream transport requires a readable response body. Use `expo/fetch` or another fetch implementation that exposes `response.body.getReader()`.");
      }
      const reader = response.body.getReader();
      const startedAt = Date.now();
      let loaded = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          const chunk = normalizeFetchStreamChunk(value);
          const chunkSize = typeof chunk === "string" ? chunk.length : chunk.byteLength;
          loaded += chunkSize;
          if (chunkSize > 0) {
            await request.onChunk?.(chunk);
          }
          if (request.onProgress) {
            const elapsedMs = Math.max(Date.now() - startedAt, 1);
            const speed = loaded / (elapsedMs / 1000);
            const total = contentLength ?? 0;
            await request.onProgress({
              loaded,
              total: contentLength,
              speed,
              averageSpeed: speed,
              estimatedTime: total > loaded && speed > 0 ? (total - loaded) / speed * 1000 : 0
            });
          }
        }
      } finally {
        reader.releaseLock?.();
      }
      return {
        status: response.status,
        statusText: response.statusText || "OK",
        headers,
        finalUrl,
        contentType,
        contentLength
      };
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
      const file = await expoFileSystem.File.downloadFileAsync(request.url, destination, {
        headers: request.headers,
        idempotent: true
      });
      const contentLength = typeof file.size === "number" ? file.size : undefined;
      await request.onHeaders?.({
        status: 200,
        statusText: "OK",
        finalUrl: request.url,
        contentLength
      });
      if (contentLength !== undefined) {
        await request.onProgress?.({
          loaded: contentLength,
          total: contentLength,
          averageSpeed: 0,
          speed: 0,
          estimatedTime: 0
        });
      }
      return {
        status: 200,
        statusText: "OK",
        finalUrl: request.url,
        contentType: file.type,
        contentLength,
        filePath: file.uri || request.destination,
        fileSize: contentLength
      };
    },
    ...canUpload ? {
      async uploadFile(request) {
        const uploadType = request.binaryStreamOnly ? uploadTaskModule?.FileSystemUploadType?.BINARY_CONTENT : uploadTaskModule?.FileSystemUploadType?.MULTIPART;
        const startedAt = Date.now();
        const task = uploadTaskModule.createUploadTask(request.url, request.file.uri, {
          headers: request.headers,
          httpMethod: request.method,
          uploadType,
          fieldName: request.file.fieldName,
          mimeType: request.file.type,
          parameters: request.fields
        }, (progress) => {
          const elapsedMs = Math.max(Date.now() - startedAt, 1);
          const speed = progress.totalBytesSent / (elapsedMs / 1000);
          request.onProgress?.(estimateUploadProgress({
            loaded: progress.totalBytesSent,
            total: progress.totalBytesExpectedToSend,
            speed,
            averageSpeed: speed
          }));
        });
        let abortListener;
        if (request.signal && task.cancelAsync) {
          abortListener = () => {
            task.cancelAsync?.();
          };
          request.signal.addEventListener("abort", abortListener, { once: true });
        }
        try {
          const result = await task.uploadAsync();
          const headers = result?.headers || {};
          const contentType = headers["content-type"];
          const contentLength = parseInt(headers["content-length"] || "0", 10) || undefined;
          await request.onHeaders?.({
            status: result?.status || 200,
            statusText: "OK",
            headers,
            finalUrl: request.url,
            contentType,
            contentLength
          });
          return {
            status: result?.status || 200,
            statusText: "OK",
            headers,
            finalUrl: request.url,
            contentType,
            contentLength,
            body: result?.body,
            uploadSize: request.file.size,
            fileName: request.file.name || getFileNameFromUri(request.file.uri)
          };
        } finally {
          if (request.signal && abortListener) {
            request.signal.removeEventListener("abort", abortListener);
          }
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
      const startedAt = Date.now();
      const task = rnfs.downloadFile({
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
          request.onHeaders?.({
            status: result.statusCode,
            headers: result.headers,
            finalUrl: request.url,
            contentLength: result.contentLength
          });
        },
        progress: (result) => {
          const elapsedMs = Math.max(Date.now() - startedAt, 1);
          const speed = result.bytesWritten / (elapsedMs / 1000);
          request.onProgress?.(estimateDownloadProgress({
            loaded: result.bytesWritten,
            total: result.contentLength,
            speed,
            averageSpeed: speed
          }));
        }
      });
      let abortListener;
      if (request.signal && rnfs.stopDownload) {
        abortListener = () => {
          rnfs.stopDownload?.(task.jobId);
        };
        request.signal.addEventListener("abort", abortListener, { once: true });
      }
      try {
        const result = await task.promise;
        return {
          status: result.statusCode,
          headers: result.headers,
          finalUrl: request.url,
          contentLength: result.bytesWritten,
          filePath: request.destination,
          fileSize: result.bytesWritten
        };
      } finally {
        if (request.signal && abortListener) {
          request.signal.removeEventListener("abort", abortListener);
        }
      }
    },
    ...rnfs.uploadFiles ? {
      async uploadFile(request) {
        const startedAt = Date.now();
        const task = rnfs.uploadFiles({
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
            if (request.file.size !== undefined) {
              request.onProgress?.({
                loaded: 0,
                total: request.file.size,
                speed: 0,
                averageSpeed: 0,
                estimatedTime: 0
              });
            }
          },
          progress: (result) => {
            const elapsedMs = Math.max(Date.now() - startedAt, 1);
            const speed = result.totalBytesSent / (elapsedMs / 1000);
            request.onProgress?.(estimateUploadProgress({
              loaded: result.totalBytesSent,
              total: result.totalBytesExpectedToSend,
              speed,
              averageSpeed: speed
            }));
          }
        });
        let abortListener;
        if (request.signal && rnfs.stopUpload) {
          abortListener = () => {
            rnfs.stopUpload?.(task.jobId);
          };
          request.signal.addEventListener("abort", abortListener, { once: true });
        }
        try {
          const result = await task.promise;
          const contentType = result.headers?.["content-type"];
          const contentLength = parseInt(result.headers?.["content-length"] || "0", 10) || undefined;
          await request.onHeaders?.({
            status: result.statusCode,
            headers: result.headers,
            finalUrl: request.url,
            contentType,
            contentLength
          });
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
          if (request.signal && abortListener) {
            request.signal.removeEventListener("abort", abortListener);
          }
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
      const subscription = netInfo.addEventListener((state) => {
        listener({
          type: state.type,
          isConnected: state.isConnected,
          isInternetReachable: state.isInternetReachable,
          isExpensive: state.isConnectionExpensive,
          details: state.details
        });
      });
      if (typeof subscription === "function") {
        return subscription;
      }
      return () => {
        subscription.remove();
      };
    }
  };
}
function createExpoBackgroundTaskProvider(backgroundTask, taskManager) {
  return {
    registerTask(task) {
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