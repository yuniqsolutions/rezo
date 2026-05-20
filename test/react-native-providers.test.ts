import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFetchStreamTransport,
  createExpoBackgroundTaskProvider,
  createExpoFileSystemAdapter,
  createNetInfoProvider,
  createReactNativeFsAdapter,
} from '../src/platform/react-native-providers.js';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('react-native provider factories', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates an Expo file-system adapter for downloads and leaves upload disabled when unsupported', async () => {
    class MockFile {
      uri?: string;
      size?: number;
      type?: string;

      constructor(public path: string) {}
    }

    const downloadFileAsync = vi.fn(async (_url: string, destination: MockFile) => {
      destination.uri = 'file:///tmp/file.bin';
      destination.size = 5;
      destination.type = 'application/octet-stream';
      return destination;
    });

    const adapter = createExpoFileSystemAdapter({
      File: Object.assign(MockFile, { downloadFileAsync })
    });

    const onHeaders = vi.fn();
    const onProgress = vi.fn();

    const result = await adapter.downloadFile!({
      url: 'https://example.com/file.bin',
      destination: '/tmp/file.bin',
      method: 'GET',
      headers: {
        accept: '*/*'
      },
      onHeaders,
      onProgress
    });

    expect(adapter.capabilities).toMatchObject({
      fileDownload: true,
      downloadProgress: false,
      uploadFromFile: false,
      uploadProgress: false
    });
    expect(downloadFileAsync).toHaveBeenCalledTimes(1);
    expect(onHeaders).toHaveBeenCalledWith(expect.objectContaining({
      status: 200,
      contentLength: 5
    }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      loaded: 5,
      total: 5
    }));
    expect(result).toMatchObject({
      status: 200,
      filePath: 'file:///tmp/file.bin',
      fileSize: 5
    });
  });

  it('does not enable Expo upload support from top-level createUploadTask exports alone', () => {
    class MockFile {
      constructor(public path: string) {}
    }

    const adapter = createExpoFileSystemAdapter({
      File: Object.assign(MockFile, {
        downloadFileAsync: vi.fn()
      }),
      createUploadTask: vi.fn(),
      FileSystemUploadType: {
        BINARY_CONTENT: 'binary',
        MULTIPART: 'multipart'
      }
    });

    expect(adapter.capabilities).toMatchObject({
      uploadFromFile: false,
      uploadProgress: false
    });
    expect(adapter.uploadFile).toBeUndefined();
  });

  it('rejects Expo file downloads that are not plain GET requests', async () => {
    class MockFile {
      constructor(public path: string) {}
    }

    const adapter = createExpoFileSystemAdapter({
      File: Object.assign(MockFile, {
        downloadFileAsync: vi.fn()
      })
    });

    await expect(adapter.downloadFile!({
      url: 'https://example.com/file.bin',
      destination: '/tmp/file.bin',
      method: 'POST',
      headers: {},
      body: '{"force":true}'
    })).rejects.toThrow(
      'Expo FileSystem file downloads only support GET requests without a request body.'
    );
  });

  it('creates an Expo file-system adapter upload transport when upload task APIs are available', async () => {
    class MockFile {
      constructor(public path: string) {}
    }

    const cancelAsync = vi.fn().mockResolvedValue(undefined);
    const createUploadTask = vi.fn((_url: string, _fileUri: string, _options: any, callback?: (progress: any) => void) => ({
      uploadAsync: async () => {
        callback?.({
          totalBytesSent: 4,
          totalBytesExpectedToSend: 8
        });
        callback?.({
          totalBytesSent: 8,
          totalBytesExpectedToSend: 8
        });
        return {
          status: 201,
          headers: {
            'content-type': 'application/json',
            'content-length': '11'
          },
          body: '{"ok":true}'
        };
      },
      cancelAsync
    }));

    const adapter = createExpoFileSystemAdapter({
      File: Object.assign(MockFile, {
        downloadFileAsync: vi.fn()
      })
    }, {
      uploadTaskModule: {
        createUploadTask,
        FileSystemUploadType: {
          BINARY_CONTENT: 'binary',
          MULTIPART: 'multipart'
        }
      }
    });

    const onHeaders = vi.fn();
    const onProgress = vi.fn();

    const result = await adapter.uploadFile!({
      url: 'https://example.com/upload',
      method: 'POST',
      headers: {
        authorization: 'Bearer token'
      },
      file: {
        uri: 'file:///tmp/picture.jpg',
        name: 'picture.jpg',
        type: 'image/jpeg',
        fieldName: 'photo',
        size: 8
      },
      fields: {
        album: 'summer'
      },
      onHeaders,
      onProgress
    });

    expect(adapter.capabilities).toMatchObject({
      uploadFromFile: true,
      uploadProgress: true
    });
    expect(createUploadTask).toHaveBeenCalledWith(
      'https://example.com/upload',
      'file:///tmp/picture.jpg',
      expect.objectContaining({
        httpMethod: 'POST',
        fieldName: 'photo',
        mimeType: 'image/jpeg',
        parameters: {
          album: 'summer'
        }
      }),
      expect.any(Function)
    );
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onHeaders).toHaveBeenCalledWith(expect.objectContaining({
      status: 201,
      contentType: 'application/json'
    }));
    expect(result).toMatchObject({
      status: 201,
      body: '{"ok":true}',
      fileName: 'picture.jpg',
      uploadSize: 8
    });
    expect(cancelAsync).not.toHaveBeenCalled();
  });

  it('cancels Expo upload tasks when the request signal aborts', async () => {
    class MockFile {
      constructor(public path: string) {}
    }

    const deferred = createDeferred<{
      status: number;
      headers?: Record<string, string>;
      body: string;
    }>();
    const cancelAsync = vi.fn().mockResolvedValue(undefined);
    const createUploadTask = vi.fn(() => ({
      uploadAsync: () => deferred.promise,
      cancelAsync
    }));

    const adapter = createExpoFileSystemAdapter({
      File: Object.assign(MockFile, {
        downloadFileAsync: vi.fn()
      })
    }, {
      uploadTaskModule: {
        createUploadTask,
        FileSystemUploadType: {
          BINARY_CONTENT: 'binary',
          MULTIPART: 'multipart'
        }
      }
    });

    const controller = new AbortController();
    const requestPromise = adapter.uploadFile!({
      url: 'https://example.com/upload',
      method: 'POST',
      headers: {},
      file: {
        uri: 'file:///tmp/video.mov',
        name: 'video.mov'
      },
      signal: controller.signal
    });

    controller.abort();
    deferred.resolve({
      status: 200,
      headers: {
        'content-type': 'application/json'
      },
      body: '{"ok":true}'
    });

    await requestPromise;

    expect(cancelAsync).toHaveBeenCalledTimes(1);
  });

  it('creates a fetch-based stream transport for readable fetch implementations', async () => {
    const releaseLock = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 206,
      statusText: 'Partial Content',
      url: 'https://example.com/stream?cursor=2',
      headers: {
        entries: function* () {
          yield ['content-type', 'text/plain'];
          yield ['content-length', '11'];
        }
      },
      body: {
        getReader() {
          const chunks = [
            new Uint8Array([104, 101, 108, 108, 111, 32]),
            new Uint8Array([119, 111, 114, 108, 100])
          ];

          return {
            async read() {
              const value = chunks.shift();
              return value
                ? { done: false, value }
                : { done: true, value: undefined };
            },
            releaseLock
          };
        }
      }
    });

    const transport = createFetchStreamTransport({ fetch: fetchImpl }, {
      name: 'expo-fetch'
    });
    const onHeaders = vi.fn();
    const onChunk = vi.fn();
    const onProgress = vi.fn();

    const result = await transport.stream({
      url: 'https://example.com/stream',
      method: 'GET',
      headers: {
        accept: 'text/plain'
      },
      onHeaders,
      onChunk,
      onProgress
    });

    expect(transport.name).toBe('expo-fetch');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.com/stream',
      expect.objectContaining({
        method: 'GET',
        headers: {
          accept: 'text/plain'
        },
        redirect: 'manual'
      })
    );
    expect(onHeaders).toHaveBeenCalledWith(expect.objectContaining({
      status: 206,
      contentType: 'text/plain',
      contentLength: 11,
      finalUrl: 'https://example.com/stream?cursor=2'
    }));
    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(Array.from(onChunk.mock.calls[0][0] as Uint8Array)).toEqual([104, 101, 108, 108, 111, 32]);
    expect(Array.from(onChunk.mock.calls[1][0] as Uint8Array)).toEqual([119, 111, 114, 108, 100]);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      loaded: 11,
      total: 11
    }));
    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 206,
      statusText: 'Partial Content',
      finalUrl: 'https://example.com/stream?cursor=2',
      contentType: 'text/plain',
      contentLength: 11
    });
  });

  it('rejects unreadable fetch responses in the stream transport factory', async () => {
    const transport = createFetchStreamTransport(vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      url: 'https://example.com/stream',
      headers: {
        entries: function* () {
          yield ['content-type', 'text/plain'];
        }
      },
      body: null
    }));

    await expect(transport.stream({
      url: 'https://example.com/stream',
      method: 'GET',
      headers: {}
    })).rejects.toThrow(
      'Configured RN stream transport requires a readable response body.'
    );
  });

  it('creates a react-native-fs adapter for downloads and stops the job on abort', async () => {
    const deferred = createDeferred<{
      jobId: number;
      statusCode: number;
      bytesWritten: number;
      headers?: Record<string, string>;
    }>();
    const stopDownload = vi.fn();

    const adapter = createReactNativeFsAdapter({
      downloadFile: vi.fn((options: any) => {
        options.begin?.({
          jobId: 7,
          statusCode: 200,
          contentLength: 5,
          headers: {
            'content-length': '5'
          }
        });
        options.progress?.({
          jobId: 7,
          contentLength: 5,
          bytesWritten: 2
        });
        return { jobId: 7, promise: deferred.promise };
      }),
      stopDownload
    }, {
      background: true,
      progressInterval: 100
    });

    const controller = new AbortController();
    const onHeaders = vi.fn();
    const onProgress = vi.fn();

    const requestPromise = adapter.downloadFile!({
      url: 'https://example.com/file.bin',
      destination: '/tmp/file.bin',
      method: 'GET',
      headers: {},
      signal: controller.signal,
      onHeaders,
      onProgress
    });

    controller.abort();
    deferred.resolve({
      jobId: 7,
      statusCode: 200,
      bytesWritten: 5,
      headers: {
        'content-type': 'application/octet-stream'
      }
    });

    const result = await requestPromise;

    expect(adapter.capabilities).toMatchObject({
      fileDownload: true,
      downloadProgress: true,
      backgroundTasks: true
    });
    expect(stopDownload).toHaveBeenCalledWith(7);
    expect(onHeaders).toHaveBeenCalledWith(expect.objectContaining({
      status: 200,
      contentLength: 5
    }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      loaded: 2,
      total: 5
    }));
    expect(result).toMatchObject({
      status: 200,
      filePath: '/tmp/file.bin',
      fileSize: 5
    });
  });

  it('rejects react-native-fs downloads that are not plain GET requests', async () => {
    const adapter = createReactNativeFsAdapter({
      downloadFile: vi.fn()
    });

    await expect(adapter.downloadFile!({
      url: 'https://example.com/file.bin',
      destination: '/tmp/file.bin',
      method: 'POST',
      headers: {},
      body: '{"force":true}'
    })).rejects.toThrow(
      'react-native-fs file downloads only support GET requests without a request body.'
    );
  });

  it('creates a react-native-fs adapter for uploads and strips file:// paths', async () => {
    const deferred = createDeferred<{
      jobId: number;
      statusCode: number;
      headers: Record<string, string>;
      body: string;
    }>();
    const stopUpload = vi.fn();

    const uploadFiles = vi.fn((options: any) => {
      options.begin?.({ jobId: 12 });
      options.progress?.({
        jobId: 12,
        totalBytesExpectedToSend: 9,
        totalBytesSent: 3
      });
      return { jobId: 12, promise: deferred.promise };
    });

    const adapter = createReactNativeFsAdapter({
      downloadFile: vi.fn(),
      uploadFiles,
      stopUpload
    });

    const controller = new AbortController();
    const onHeaders = vi.fn();
    const onProgress = vi.fn();

    const requestPromise = adapter.uploadFile!({
      url: 'https://example.com/upload',
      method: 'PUT',
      headers: {
        authorization: 'Bearer token'
      },
      file: {
        uri: 'file:///tmp/photo.jpg',
        name: 'photo.jpg',
        type: 'image/jpeg',
        fieldName: 'photo',
        size: 9
      },
      fields: {
        album: 'summer'
      },
      signal: controller.signal,
      onHeaders,
      onProgress
    });

    controller.abort();
    deferred.resolve({
      jobId: 12,
      statusCode: 201,
      headers: {
        'content-type': 'application/json',
        'content-length': '11'
      },
      body: '{"ok":true}'
    });

    const result = await requestPromise;

    expect(adapter.capabilities).toMatchObject({
      uploadFromFile: true,
      uploadProgress: true
    });
    expect(uploadFiles).toHaveBeenCalledWith(expect.objectContaining({
      toUrl: 'https://example.com/upload',
      method: 'PUT',
      fields: {
        album: 'summer'
      },
      files: [
        expect.objectContaining({
          name: 'photo',
          filename: 'photo.jpg',
          filepath: '/tmp/photo.jpg',
          filetype: 'image/jpeg'
        })
      ]
    }));
    expect(stopUpload).toHaveBeenCalledWith(12);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      loaded: 0,
      total: 9
    }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      loaded: 3,
      total: 9
    }));
    expect(onHeaders).toHaveBeenCalledWith(expect.objectContaining({
      status: 201,
      contentType: 'application/json'
    }));
    expect((adapter as any).uploadFiles).toBeUndefined();
    expect(result).toMatchObject({
      status: 201,
      body: '{"ok":true}',
      fileName: 'photo.jpg',
      uploadSize: 9
    });
  });

  it('creates a NetInfo provider that maps fetch and subscription state', async () => {
    const remove = vi.fn();
    const listenerHolder: { current?: (state: any) => void } = {};
    const netInfo = {
      fetch: vi.fn().mockResolvedValue({
        type: 'wifi',
        isConnected: true,
        isInternetReachable: true,
        isConnectionExpensive: false,
        details: {
          strength: 4
        }
      }),
      addEventListener: vi.fn((listener: (state: any) => void) => {
        listenerHolder.current = listener;
        return { remove };
      })
    };

    const provider = createNetInfoProvider(netInfo);
    const state = await provider.fetch();
    const listener = vi.fn();
    const unsubscribe = provider.subscribe!(listener);

    listenerHolder.current?.({
      type: 'cellular',
      isConnected: false,
      isInternetReachable: false,
      isConnectionExpensive: true,
      details: {
        carrier: 'demo'
      }
    });
    unsubscribe();

    expect(state).toEqual({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      isExpensive: false,
      details: {
        strength: 4
      }
    });
    expect(listener).toHaveBeenCalledWith({
      type: 'cellular',
      isConnected: false,
      isInternetReachable: false,
      isExpensive: true,
      details: {
        carrier: 'demo'
      }
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('creates an Expo background task provider that proxies task-manager calls', async () => {
    const backgroundTask = {
      registerTaskAsync: vi.fn().mockResolvedValue(undefined),
      unregisterTaskAsync: vi.fn().mockResolvedValue(undefined)
    };
    const taskManager = {
      isTaskRegisteredAsync: vi.fn().mockResolvedValue(true)
    };

    const provider = createExpoBackgroundTaskProvider(backgroundTask, taskManager);

    await provider.registerTask({
      name: 'rezo.sync',
      minimumInterval: 900
    });
    await provider.unregisterTask('rezo.sync');
    const isRegistered = await provider.isTaskRegistered?.('rezo.sync');

    expect(backgroundTask.registerTaskAsync).toHaveBeenCalledWith('rezo.sync', {
      minimumInterval: 900
    });
    expect(backgroundTask.unregisterTaskAsync).toHaveBeenCalledWith('rezo.sync');
    expect(taskManager.isTaskRegisteredAsync).toHaveBeenCalledWith('rezo.sync');
    expect(isRegistered).toBe(true);
  });
});
