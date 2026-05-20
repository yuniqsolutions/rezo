import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeRequest } from '../src/adapters/react-native.js';
import { buildAdapterContext, getAdapterCapabilities, selectAdapter } from '../src/adapters/picker.js';
import { RezoCookieJar } from '../src/cookies/cookie-jar.js';
import { DownloadResponse } from '../src/responses/universal/download.js';
import { UploadResponse } from '../src/responses/universal/upload.js';

function createMockResponse({
  body,
  headers = {},
  status = 200,
  statusText = 'OK',
  url = 'https://example.com/final'
}: {
  body: unknown;
  headers?: Record<string, string>;
  status?: number;
  statusText?: string;
  url?: string;
}): Response {
  const responseHeaders = new Headers(headers);

  return {
    status,
    statusText,
    headers: responseHeaders,
    url,
    async text() {
      if (typeof body === 'string') return body;
      if (body instanceof ArrayBuffer) {
        return new TextDecoder().decode(body);
      }
      return JSON.stringify(body);
    },
    async json() {
      if (typeof body === 'string') {
        return JSON.parse(body);
      }
      return body;
    },
    async arrayBuffer() {
      if (body instanceof ArrayBuffer) {
        return body;
      }
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      return new TextEncoder().encode(text).buffer;
    },
    async blob() {
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      return new Blob([text]);
    }
  } as Response;
}

describe('react-native adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses the final response url, merges request and response cookies, and runs afterHeaders/afterParse hooks', async () => {
    const jar = new RezoCookieJar();
    jar.setCookiesSync(['session=abc; Path=/'], 'https://example.com/original');

    const afterHeaders = vi.fn();
    const afterParse = vi.fn((event: any) => ({
      ...event.data,
      transformed: true
    }));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createMockResponse({
      body: '{"ok":true}',
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'token=xyz; Path=/'
      },
      url: 'https://example.com/final'
    })));

    const response = await executeRequest<any>({
      url: 'https://example.com/original',
      method: 'GET',
      hooks: {
        afterHeaders: [afterHeaders],
        afterParse: [afterParse]
      }
    } as any, {}, jar) as any;

    expect(response.finalUrl).toBe('https://example.com/final');
    expect(response.urls).toEqual([
      'https://example.com/original',
      'https://example.com/final'
    ]);
    expect(response.data).toEqual({
      ok: true,
      transformed: true
    });

    expect(afterHeaders).toHaveBeenCalledTimes(1);
    expect(afterHeaders.mock.calls[0][0]).toMatchObject({
      status: 200,
      contentType: 'application/json'
    });

    expect(afterParse).toHaveBeenCalledTimes(1);
    expect(afterParse.mock.calls[0][0]).toMatchObject({
      rawData: '{"ok":true}',
      contentType: 'application/json'
    });

    expect(response.config.adapterMetadata).toMatchObject({
      version: 'react-native',
      capabilities: {
        finalUrl: true,
        afterHeaders: true,
        afterParse: true,
        streaming: false,
        fileDownload: false
      }
    });
    expect(response.config.adapterMetadata.features).toEqual(
      expect.arrayContaining(['fetch', 'timeout', 'abort', 'cookies', 'redirects', 'hooks'])
    );
    expect(response.config.responseCookies.array.map((cookie: any) => cookie.key)).toEqual(['token']);
    expect(response.cookies.array.map((cookie: any) => cookie.key).sort()).toEqual(['session', 'token']);
  });

  it('normalizes binary responseType to buffer-compatible arrayBuffer output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createMockResponse({
      body: 'hello world',
      headers: {
        'content-type': 'application/octet-stream'
      }
    })));

    const response = await executeRequest<ArrayBuffer>({
      url: 'https://example.com/file.bin',
      method: 'GET',
      responseType: 'binary' as any
    }, {}, new RezoCookieJar()) as any;

    expect(response.config.responseType).toBe('buffer');
    expect(response.data).toBeInstanceOf(ArrayBuffer);
    expect(response.contentLength).toBeGreaterThan(0);
  });

  it('runs timeout and abort hooks when the request times out', async () => {
    const onTimeout = vi.fn();
    const onAbort = vi.fn();

    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        signal.addEventListener('abort', () => {
          const error = new Error('aborted') as Error & { name: string };
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    }));

    await expect(executeRequest({
      url: 'https://example.com/slow',
      method: 'GET',
      timeout: 10,
      hooks: {
        onTimeout: [onTimeout],
        onAbort: [onAbort]
      }
    } as any, {}, new RezoCookieJar())).rejects.toBeInstanceOf(Error);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAbort.mock.calls[0][0]).toMatchObject({
      reason: 'timeout'
    });
  });

  it('handles manual redirects on the RN fetch path and rebuilds cookies from the jar', async () => {
    const beforeRedirect = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createMockResponse({
        body: '',
        headers: {
          location: '/next',
          'set-cookie': 'token=xyz; Path=/'
        },
        status: 302,
        statusText: 'Found',
        url: 'https://example.com/original'
      }))
      .mockResolvedValueOnce(createMockResponse({
        body: '{"ok":true}',
        headers: {
          'content-type': 'application/json'
        },
        status: 200,
        statusText: 'OK',
        url: 'https://example.com/next'
      }));

    vi.stubGlobal('fetch', fetchMock);

    const response = await executeRequest<any>({
      url: 'https://example.com/original',
      method: 'GET',
      hooks: {
        beforeRedirect: [beforeRedirect]
      }
    } as any, {}, new RezoCookieJar()) as any;

    const secondCallHeaders = fetchMock.mock.calls[1][1]?.headers as Headers;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      redirect: 'manual'
    }));
    expect(beforeRedirect).toHaveBeenCalledTimes(1);
    expect(beforeRedirect.mock.calls[0][0]).toMatchObject({
      fromUrl: 'https://example.com/original',
      status: 302,
      method: 'GET'
    });
    expect(secondCallHeaders.get('Cookie')).toContain('token=xyz');
    expect(response.finalUrl).toBe('https://example.com/next');
    expect(response.urls).toEqual([
      'https://example.com/original',
      'https://example.com/next'
    ]);
    expect(response.config.redirectHistory).toHaveLength(1);
    expect(response.data).toEqual({ ok: true });
  });

  it('waits on configured rate-limit responses before retrying the RN fetch path', async () => {
    const onRateLimitWait = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createMockResponse({
        body: '{"message":"slow down"}',
        headers: {
          'content-type': 'application/json',
          'retry-after': '0'
        },
        status: 429,
        statusText: 'Too Many Requests'
      }))
      .mockResolvedValueOnce(createMockResponse({
        body: '{"ok":true}',
        headers: {
          'content-type': 'application/json'
        },
        status: 200,
        statusText: 'OK'
      }));

    vi.stubGlobal('fetch', fetchMock);

    const response = await executeRequest<any>({
      url: 'https://example.com/rate-limit',
      method: 'GET',
      waitOnStatus: true,
      hooks: {
        onRateLimitWait: [onRateLimitWait]
      }
    } as any, {}, new RezoCookieJar()) as any;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onRateLimitWait).toHaveBeenCalledTimes(1);
    expect(onRateLimitWait.mock.calls[0][0]).toMatchObject({
      status: 429
    });
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true });
  });

  it('records network state from networkInfoProvider when the device is online', async () => {
    const networkInfoProvider = {
      fetch: vi.fn().mockResolvedValue({
        type: 'wifi',
        isConnected: true,
        isInternetReachable: true,
        isExpensive: false
      })
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createMockResponse({
      body: '{"ok":true}',
      headers: {
        'content-type': 'application/json'
      }
    })));

    const response = await executeRequest<any>({
      url: 'https://example.com/online',
      method: 'GET'
    } as any, {
      reactNative: {
        networkInfoProvider
      }
    } as any, new RezoCookieJar()) as any;

    expect(networkInfoProvider.fetch).toHaveBeenCalledTimes(1);
    expect(response.data).toEqual({ ok: true });
    expect(response.config.trackingData).toMatchObject({
      reactNative: {
        networkInfoEnabled: true,
        networkState: {
          type: 'wifi',
          isConnected: true,
          isInternetReachable: true,
          isExpensive: false
        }
      }
    });
  });

  it('fails fast when networkInfoProvider reports the device is offline', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(executeRequest({
      url: 'https://example.com/offline',
      method: 'GET'
    } as any, {
      reactNative: {
        networkInfoProvider: {
          fetch: vi.fn().mockResolvedValue({
            type: 'wifi',
            isConnected: false,
            isInternetReachable: false
          })
        }
      }
    } as any, new RezoCookieJar())).rejects.toMatchObject({
      code: 'ENETUNREACH',
      message: 'React Native request blocked because the device is offline.'
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not block requests when networkInfoProvider fetch fails', async () => {
    const networkInfoProvider = {
      fetch: vi.fn().mockRejectedValue(new Error('netinfo unavailable'))
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createMockResponse({
      body: '{"ok":true}',
      headers: {
        'content-type': 'application/json'
      }
    })));

    const response = await executeRequest<any>({
      url: 'https://example.com/netinfo-fallback',
      method: 'GET'
    } as any, {
      reactNative: {
        networkInfoProvider
      }
    } as any, new RezoCookieJar()) as any;

    expect(networkInfoProvider.fetch).toHaveBeenCalledTimes(1);
    expect(response.data).toEqual({ ok: true });
    expect(response.config.trackingData).toMatchObject({
      reactNative: {
        networkInfoEnabled: true,
        networkInfoError: 'netinfo unavailable'
      }
    });
  });

  it('rejects requested RN background tasks without a provider', async () => {
    await expect(executeRequest({
      url: 'https://example.com/background-missing-provider',
      method: 'GET',
      reactNative: {
        backgroundTask: {
          name: 'rezo.sync'
        }
      }
    } as any, {}, new RezoCookieJar())).rejects.toThrow(
      'React Native background task requests require `reactNative.backgroundTaskProvider`.'
    );
  });

  it('registers and unregisters RN background tasks around a request', async () => {
    const backgroundTaskProvider = {
      isTaskRegistered: vi.fn().mockResolvedValue(false),
      registerTask: vi.fn().mockResolvedValue(undefined),
      unregisterTask: vi.fn().mockResolvedValue(undefined)
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createMockResponse({
      body: '{"ok":true}',
      headers: {
        'content-type': 'application/json'
      }
    })));

    const response = await executeRequest<any>({
      url: 'https://example.com/background-register',
      method: 'GET',
      reactNative: {
        backgroundTask: {
          name: 'rezo.sync',
          minimumInterval: 900,
          metadata: {
            scope: 'download'
          }
        }
      }
    } as any, {
      reactNative: {
        backgroundTaskProvider
      }
    } as any, new RezoCookieJar()) as any;

    expect(backgroundTaskProvider.isTaskRegistered).toHaveBeenCalledWith('rezo.sync');
    expect(backgroundTaskProvider.registerTask).toHaveBeenCalledWith({
      name: 'rezo.sync',
      minimumInterval: 900,
      metadata: {
        scope: 'download'
      }
    });
    expect(backgroundTaskProvider.unregisterTask).toHaveBeenCalledWith('rezo.sync');
    expect(response.config.trackingData).toMatchObject({
      reactNative: {
        backgroundTask: {
          name: 'rezo.sync',
          registeredByAdapter: true,
          unregistered: true,
          active: false
        }
      }
    });
  });

  it('keeps RN background tasks registered when requested', async () => {
    const backgroundTaskProvider = {
      isTaskRegistered: vi.fn().mockResolvedValue(false),
      registerTask: vi.fn().mockResolvedValue(undefined),
      unregisterTask: vi.fn().mockResolvedValue(undefined)
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createMockResponse({
      body: '{"ok":true}',
      headers: {
        'content-type': 'application/json'
      }
    })));

    const response = await executeRequest<any>({
      url: 'https://example.com/background-keep',
      method: 'GET',
      reactNative: {
        backgroundTask: {
          name: 'rezo.keep',
          keepRegistered: true
        }
      }
    } as any, {
      reactNative: {
        backgroundTaskProvider
      }
    } as any, new RezoCookieJar()) as any;

    expect(backgroundTaskProvider.registerTask).toHaveBeenCalledWith({
      name: 'rezo.keep',
      minimumInterval: undefined,
      metadata: undefined
    });
    expect(backgroundTaskProvider.unregisterTask).not.toHaveBeenCalled();
    expect(response.config.trackingData).toMatchObject({
      reactNative: {
        backgroundTask: {
          name: 'rezo.keep',
          keepRegistered: true,
          unregistered: false,
          active: false
        }
      }
    });
  });

  it('rejects RN file uploads without a configured upload provider', async () => {
    await expect(executeRequest({
      url: 'https://example.com/upload',
      method: 'POST',
      body: {
        uri: 'file:///tmp/picture.jpg',
        name: 'picture.jpg',
        type: 'image/jpeg'
      },
      _isUpload: true
    } as any, {}, new RezoCookieJar())).rejects.toThrow(
      'React Native file uploads require `reactNative.fileSystemAdapter.uploadFile`.'
    );
  });

  it('rejects reactNative.upload when upload mode is not explicitly requested', async () => {
    await expect(executeRequest({
      url: 'https://example.com/upload',
      method: 'POST',
      reactNative: {
        upload: {
          uri: 'file:///tmp/picture.jpg',
          name: 'picture.jpg',
          type: 'image/jpeg'
        }
      }
    } as any, {}, new RezoCookieJar())).rejects.toThrow(
      'React Native `reactNative.upload` requires `rezo.upload(...)` or `responseType: \'upload\'`.'
    );
  });

  it('uses reactNative.upload with responseType upload through the standard upload response flow', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const uploadResponse = await executeRequest({
      url: 'https://example.com/upload-explicit',
      method: 'POST',
      responseType: 'upload',
      reactNative: {
        upload: {
          uri: 'file:///tmp/picture.jpg',
          name: 'picture.jpg',
          type: 'image/jpeg',
          size: 9,
          fieldName: 'photo',
          fields: {
            album: 'summer'
          }
        }
      }
    } as any, {
      reactNative: {
        fileSystemAdapter: {
          name: 'mock-fs',
          capabilities: {
            uploadFromFile: true,
            uploadProgress: true
          },
          uploadFile: vi.fn(async (request: any) => {
            expect(request.file).toMatchObject({
              uri: 'file:///tmp/picture.jpg',
              name: 'picture.jpg',
              type: 'image/jpeg',
              fieldName: 'photo',
              size: 9
            });
            expect(request.fields).toEqual({
              album: 'summer'
            });

            return {
              status: 201,
              statusText: 'Created',
              headers: {
                'content-type': 'application/json',
                'content-length': '11'
              },
              finalUrl: 'https://example.com/upload-explicit',
              body: '{"ok":true}',
              uploadSize: 9,
              fileName: 'picture.jpg'
            };
          })
        }
      }
    } as any, new RezoCookieJar()) as any;

    const finish = await new Promise<any>((resolve, reject) => {
      uploadResponse.once('complete', resolve);
      uploadResponse.once('error', reject);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(finish).toMatchObject({
      finalUrl: 'https://example.com/upload-explicit',
      uploadSize: 9,
      fileName: 'picture.jpg'
    });
    expect(finish.response).toMatchObject({
      status: 201,
      data: {
        ok: true
      }
    });
  });

  it('uses a configured RN fileSystemAdapter for file uploads', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const progress = vi.fn();
    const uploadProgressEvent = vi.fn();
    const uploadProgressCallback = vi.fn();
    const uploadResponse = new UploadResponse('https://example.com/upload', 'picture.jpg');
    uploadResponse.on('progress', progress);
    uploadResponse.on('upload-progress', uploadProgressEvent);

    const finishPromise = new Promise<any>((resolve, reject) => {
      uploadResponse.once('complete', resolve);
      uploadResponse.once('error', reject);
    });

    const uploadFile = vi.fn(async (request: any) => {
      await request.onProgress?.({
        loaded: 3,
        total: 9,
        speed: 30,
        averageSpeed: 30,
        estimatedTime: 200
      });
      await request.onProgress?.({
        loaded: 9,
        total: 9,
        speed: 45,
        averageSpeed: 36,
        estimatedTime: 0
      });

      return {
        status: 201,
        statusText: 'Created',
        headers: {
          'content-type': 'application/json',
          'content-length': '11'
        },
        finalUrl: 'https://example.com/upload',
        body: '{"ok":true}',
        uploadSize: 9,
        fileName: 'picture.jpg'
      };
    });

    const returned = await executeRequest({
      url: 'https://example.com/upload',
      method: 'POST',
      body: {
        uri: 'file:///tmp/picture.jpg',
        name: 'picture.jpg',
        type: 'image/jpeg',
        size: 9
      },
      onUploadProgress: uploadProgressCallback,
      _isUpload: true,
      _uploadResponse: uploadResponse
    } as any, {
      reactNative: {
        fileSystemAdapter: {
          name: 'mock-fs',
          capabilities: {
            uploadFromFile: true,
            uploadProgress: true
          },
          uploadFile
        }
      }
    } as any, new RezoCookieJar());

    const finish = await finishPromise;

    expect(returned).toBe(uploadResponse);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(uploadFile.mock.calls[0][0]).toMatchObject({
      url: 'https://example.com/upload',
      method: 'POST',
      file: {
        uri: 'file:///tmp/picture.jpg',
        name: 'picture.jpg',
        type: 'image/jpeg',
        size: 9
      }
    });
    expect(progress).toHaveBeenCalledTimes(2);
    expect(uploadProgressEvent).toHaveBeenCalledTimes(2);
    expect(uploadProgressCallback).toHaveBeenCalledTimes(2);
    expect(finish).toMatchObject({
      finalUrl: 'https://example.com/upload',
      uploadSize: 9,
      fileName: 'picture.jpg'
    });
    expect(finish.response).toMatchObject({
      status: 201,
      statusText: 'Created',
      data: {
        ok: true
      }
    });
  });

  it('runs timeout and abort hooks when a configured RN file upload provider times out', async () => {
    const onTimeout = vi.fn();
    const onAbort = vi.fn();
    let providerSignal: AbortSignal | undefined;

    const uploadResponse = await executeRequest({
      url: 'https://example.com/upload-timeout',
      method: 'POST',
      timeout: 10,
      body: {
        uri: 'file:///tmp/picture.jpg',
        name: 'picture.jpg',
        type: 'image/jpeg'
      },
      hooks: {
        onTimeout: [onTimeout],
        onAbort: [onAbort]
      },
      _isUpload: true
    } as any, {
      reactNative: {
        fileSystemAdapter: {
          name: 'mock-fs',
          capabilities: {
            uploadFromFile: true
          },
          uploadFile: vi.fn(async (request: any) => {
            providerSignal = request.signal;
            return new Promise(() => {});
          })
        }
      }
    } as any, new RezoCookieJar()) as any;

    await expect(new Promise((resolve, reject) => {
      uploadResponse.once('complete', resolve);
      uploadResponse.once('error', reject);
    })).rejects.toBeInstanceOf(Error);

    expect(providerSignal?.aborted).toBe(true);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAbort.mock.calls[0][0]).toMatchObject({
      reason: 'timeout'
    });
  });

  it('rejects stream mode explicitly in react native', async () => {
    await expect(executeRequest({
      url: 'https://example.com/stream',
      method: 'GET',
      responseType: 'stream'
    } as any, {}, new RezoCookieJar())).rejects.toThrow(
      'React Native streaming requires `reactNative.streamTransport`.'
    );
  });

  it('uses a configured RN stream transport for stream mode', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const streamResponse = await executeRequest({
      url: 'https://example.com/stream',
      method: 'GET',
      responseType: 'stream'
    } as any, {
      reactNative: {
        streamTransport: {
          name: 'mock-stream',
          async stream(request: any) {
            await request.onHeaders?.({
              status: 200,
              statusText: 'OK',
              headers: {
                'content-type': 'text/plain',
                'content-length': '11'
              },
              finalUrl: 'https://example.com/stream'
            });
            await request.onChunk?.('hello ');
            await request.onProgress?.({
              loaded: 6,
              total: 11,
              speed: 12,
              averageSpeed: 12,
              estimatedTime: 400
            });
            await request.onChunk?.('world');
            await request.onProgress?.({
              loaded: 11,
              total: 11,
              speed: 15,
              averageSpeed: 13,
              estimatedTime: 0
            });
            return {
              status: 200,
              statusText: 'OK',
              headers: {
                'content-type': 'text/plain',
                'content-length': '11'
              },
              finalUrl: 'https://example.com/stream',
              contentType: 'text/plain',
              contentLength: 11
            };
          }
        }
      }
    } as any, new RezoCookieJar()) as any;

    const data = vi.fn();
    const downloadProgress = vi.fn();
    streamResponse.on('data', data);
    streamResponse.on('download-progress', downloadProgress);

    const finish = await new Promise<any>((resolve, reject) => {
      streamResponse.once('complete', resolve);
      streamResponse.once('error', reject);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(data).toHaveBeenCalledTimes(2);
    expect(data.mock.calls[0][0]).toBe('hello ');
    expect(data.mock.calls[1][0]).toBe('world');
    expect(downloadProgress).toHaveBeenCalledTimes(2);
    expect(finish).toMatchObject({
      status: 200,
      finalUrl: 'https://example.com/stream',
      contentLength: 11
    });
  });

  it('follows manual redirects on RN stream transports before emitting body data', async () => {
    const streamResponse = await executeRequest({
      url: 'https://example.com/stream',
      method: 'GET',
      responseType: 'stream'
    } as any, {
      reactNative: {
        streamTransport: {
          name: 'mock-stream',
          stream: vi.fn()
            .mockImplementationOnce(async (request: any) => {
              await request.onHeaders?.({
                status: 302,
                statusText: 'Found',
                headers: {
                  location: '/stream-final',
                  'set-cookie': 'token=xyz; Path=/'
                },
                finalUrl: 'https://example.com/stream'
              });
              return {
                status: 302,
                statusText: 'Found',
                headers: {
                  location: '/stream-final',
                  'set-cookie': 'token=xyz; Path=/'
                },
                finalUrl: 'https://example.com/stream'
              };
            })
            .mockImplementationOnce(async (request: any) => {
              await request.onHeaders?.({
                status: 200,
                statusText: 'OK',
                headers: {
                  'content-type': 'text/plain',
                  'content-length': '5'
                },
                finalUrl: 'https://example.com/stream-final'
              });
              await request.onChunk?.('hello');
              await request.onProgress?.({
                loaded: 5,
                total: 5,
                speed: 25,
                averageSpeed: 25,
                estimatedTime: 0
              });
              return {
                status: 200,
                statusText: 'OK',
                headers: {
                  'content-type': 'text/plain',
                  'content-length': '5'
                },
                finalUrl: 'https://example.com/stream-final',
                contentType: 'text/plain',
                contentLength: 5
              };
            })
        }
      }
    } as any, new RezoCookieJar()) as any;

    const redirect = vi.fn();
    const data = vi.fn();
    streamResponse.on('redirect', redirect);
    streamResponse.on('data', data);

    const finish = await new Promise<any>((resolve, reject) => {
      streamResponse.once('complete', resolve);
      streamResponse.once('error', reject);
    });

    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect.mock.calls[0][0]).toMatchObject({
      sourceUrl: 'https://example.com/stream',
      destinationUrl: 'https://example.com/stream-final',
      sourceStatus: 302
    });
    expect(data).toHaveBeenCalledTimes(1);
    expect(data).toHaveBeenCalledWith('hello');
    expect(finish).toMatchObject({
      status: 200,
      finalUrl: 'https://example.com/stream-final'
    });
  });

  it('retries RN stream transports before body data starts and runs beforeRetry hooks', async () => {
    const beforeRetry = vi.fn();

    const streamResponse = await executeRequest({
      url: 'https://example.com/stream-retry',
      method: 'GET',
      responseType: 'stream',
      retry: {
        limit: 1,
        delay: 0
      },
      hooks: {
        beforeRetry: [beforeRetry]
      }
    } as any, {
      reactNative: {
        streamTransport: {
          name: 'mock-stream',
          stream: vi.fn()
            .mockImplementationOnce(async () => {
              throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
            })
            .mockImplementationOnce(async (request: any) => {
              await request.onHeaders?.({
                status: 200,
                statusText: 'OK',
                headers: {
                  'content-type': 'text/plain',
                  'content-length': '5'
                },
                finalUrl: 'https://example.com/stream-retry'
              });
              await request.onChunk?.('hello');
              return {
                status: 200,
                statusText: 'OK',
                headers: {
                  'content-type': 'text/plain',
                  'content-length': '5'
                },
                finalUrl: 'https://example.com/stream-retry',
                contentType: 'text/plain',
                contentLength: 5
              };
            })
        }
      }
    } as any, new RezoCookieJar()) as any;

    const finish = await new Promise<any>((resolve, reject) => {
      streamResponse.once('complete', resolve);
      streamResponse.once('error', reject);
    });

    expect(beforeRetry).toHaveBeenCalledTimes(1);
    expect(finish).toMatchObject({
      status: 200,
      finalUrl: 'https://example.com/stream-retry'
    });
  });

  it('runs timeout and abort hooks when a configured RN stream transport times out', async () => {
    const onTimeout = vi.fn();
    const onAbort = vi.fn();

    const streamResponse = await executeRequest({
      url: 'https://example.com/stream-timeout',
      method: 'GET',
      responseType: 'stream',
      timeout: 10,
      hooks: {
        onTimeout: [onTimeout],
        onAbort: [onAbort]
      }
    } as any, {
      reactNative: {
        streamTransport: {
          name: 'mock-stream',
          async stream(request: any) {
            return new Promise((_resolve, reject) => {
              request.signal.addEventListener('abort', () => {
                const error = new Error('aborted') as Error & { name: string };
                error.name = 'AbortError';
                reject(error);
              }, { once: true });
            });
          }
        }
      }
    } as any, new RezoCookieJar()) as any;

    await expect(new Promise((resolve, reject) => {
      streamResponse.once('complete', resolve);
      streamResponse.once('error', reject);
    })).rejects.toBeInstanceOf(Error);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAbort.mock.calls[0][0]).toMatchObject({
      reason: 'timeout'
    });
  });

  it('rejects file download mode explicitly in react native', async () => {
    await expect(executeRequest({
      url: 'https://example.com/file.bin',
      method: 'GET',
      saveTo: '/tmp/file.bin',
      _isDownload: true
    } as any, {}, new RezoCookieJar())).rejects.toThrow(
      'React Native file downloads require `reactNative.fileSystemAdapter`'
    );
  });

  it('uses a configured RN fileSystemAdapter for file downloads', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const progress = vi.fn();
    const downloadProgressEvent = vi.fn();
    const downloadProgressCallback = vi.fn();
    const downloadResponse = new DownloadResponse('/tmp/file.bin', 'https://example.com/file.bin');
    downloadResponse.on('progress', progress);
    downloadResponse.on('download-progress', downloadProgressEvent);

    const finishPromise = new Promise<any>((resolve, reject) => {
      downloadResponse.once('complete', resolve);
      downloadResponse.once('error', reject);
    });

    const downloadFile = vi.fn(async (request: any) => {
      await request.onHeaders?.({
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': '5'
        },
        finalUrl: 'https://example.com/file.bin'
      });
      await request.onProgress?.({
        loaded: 2,
        total: 5,
        speed: 20,
        averageSpeed: 20,
        estimatedTime: 150
      });
      await request.onProgress?.({
        loaded: 5,
        total: 5,
        speed: 25,
        averageSpeed: 22,
        estimatedTime: 0
      });

      return {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': '5'
        },
        finalUrl: 'https://example.com/file.bin',
        filePath: '/tmp/file.bin',
        fileSize: 5
      };
    });

    const returned = await executeRequest({
      url: 'https://example.com/file.bin',
      method: 'GET',
      saveTo: '/tmp/file.bin',
      onDownloadProgress: downloadProgressCallback,
      _isDownload: true,
      _downloadResponse: downloadResponse
    } as any, {
      reactNative: {
        fileSystemAdapter: {
          name: 'mock-fs',
          capabilities: {
            fileDownload: true,
            downloadProgress: true
          },
          downloadFile
        }
      }
    } as any, new RezoCookieJar());

    const finish = await finishPromise;

    expect(returned).toBe(downloadResponse);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledTimes(2);
    expect(downloadProgressEvent).toHaveBeenCalledTimes(2);
    expect(downloadProgressCallback).toHaveBeenCalledTimes(2);
    expect(finish).toMatchObject({
      status: 200,
      finalUrl: 'https://example.com/file.bin',
      fileName: '/tmp/file.bin',
      fileSize: 5
    });
  });

  it('parses and merges response cookies for provider-backed file downloads', async () => {
    const jar = new RezoCookieJar();
    jar.setCookiesSync(['session=abc; Path=/'], 'https://example.com/file.bin');

    const downloadResponse = new DownloadResponse('/tmp/file.bin', 'https://example.com/file.bin');
    const cookiesEvent = vi.fn();
    downloadResponse.on('cookies', cookiesEvent);

    const finishPromise = new Promise<any>((resolve, reject) => {
      downloadResponse.once('complete', resolve);
      downloadResponse.once('error', reject);
    });

    const returned = await executeRequest({
      url: 'https://example.com/file.bin',
      method: 'GET',
      saveTo: '/tmp/file.bin',
      _isDownload: true,
      _downloadResponse: downloadResponse
    } as any, {
      reactNative: {
        fileSystemAdapter: {
          name: 'mock-fs',
          capabilities: {
            fileDownload: true
          },
          downloadFile: vi.fn(async (request: any) => {
            await request.onHeaders?.({
              status: 200,
              statusText: 'OK',
              headers: {
                'set-cookie': 'token=xyz; Path=/',
                'content-type': 'application/octet-stream',
                'content-length': '5'
              },
              finalUrl: 'https://example.com/file.bin'
            });
            return {
              status: 200,
              statusText: 'OK',
              headers: {
                'set-cookie': 'token=xyz; Path=/',
                'content-type': 'application/octet-stream',
                'content-length': '5'
              },
              finalUrl: 'https://example.com/file.bin',
              filePath: '/tmp/file.bin',
              fileSize: 5
            };
          })
        }
      }
    } as any, jar);

    const finish = await finishPromise;

    expect(returned).toBe(downloadResponse);
    expect(cookiesEvent).toHaveBeenCalled();
    expect(cookiesEvent.mock.calls[0][0].map((cookie: any) => cookie.key)).toContain('token');
    expect(finish.cookies.array.map((cookie: any) => cookie.key).sort()).toEqual(['session', 'token']);
  });

  it('runs timeout and abort hooks when a configured RN file download provider times out', async () => {
    const onTimeout = vi.fn();
    const onAbort = vi.fn();
    let providerSignal: AbortSignal | undefined;

    const downloadResponse = await executeRequest({
      url: 'https://example.com/file-timeout.bin',
      method: 'GET',
      saveTo: '/tmp/file-timeout.bin',
      timeout: 10,
      hooks: {
        onTimeout: [onTimeout],
        onAbort: [onAbort]
      },
      _isDownload: true
    } as any, {
      reactNative: {
        fileSystemAdapter: {
          name: 'mock-fs',
          capabilities: {
            fileDownload: true
          },
          downloadFile: vi.fn(async (request: any) => {
            providerSignal = request.signal;
            return new Promise(() => {});
          })
        }
      }
    } as any, new RezoCookieJar()) as any;

    await expect(new Promise((resolve, reject) => {
      downloadResponse.once('complete', resolve);
      downloadResponse.once('error', reject);
    })).rejects.toBeInstanceOf(Error);

    expect(providerSignal?.aborted).toBe(true);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAbort.mock.calls[0][0]).toMatchObject({
      reason: 'timeout'
    });
  });

  it('retries provider-backed file downloads and runs beforeRetry hooks', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const beforeRetry = vi.fn();
    const downloadResponse = new DownloadResponse('/tmp/file.bin', 'https://example.com/file.bin');
    const finishPromise = new Promise<any>((resolve, reject) => {
      downloadResponse.once('complete', resolve);
      downloadResponse.once('error', reject);
    });

    const downloadFile = vi.fn()
      .mockImplementationOnce(async (request: any) => {
        await request.onHeaders?.({
          status: 500,
          statusText: 'Internal Server Error',
          headers: {
            'content-type': 'application/octet-stream'
          },
          finalUrl: 'https://example.com/file.bin'
        });

        return {
          status: 500,
          statusText: 'Internal Server Error',
          headers: {
            'content-type': 'application/octet-stream'
          },
          finalUrl: 'https://example.com/file.bin',
          filePath: '/tmp/file.bin',
          fileSize: 0
        };
      })
      .mockImplementationOnce(async (request: any) => {
        await request.onHeaders?.({
          status: 200,
          statusText: 'OK',
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': '5'
          },
          finalUrl: 'https://example.com/file.bin'
        });
        await request.onProgress?.({
          loaded: 5,
          total: 5,
          speed: 50,
          averageSpeed: 50,
          estimatedTime: 0
        });

        return {
          status: 200,
          statusText: 'OK',
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': '5'
          },
          finalUrl: 'https://example.com/file.bin',
          filePath: '/tmp/file.bin',
          fileSize: 5
        };
      });

    const returned = await executeRequest({
      url: 'https://example.com/file.bin',
      method: 'GET',
      saveTo: '/tmp/file.bin',
      retry: {
        limit: 1,
        delay: 0
      },
      hooks: {
        beforeRetry: [beforeRetry]
      },
      _isDownload: true,
      _downloadResponse: downloadResponse
    } as any, {
      reactNative: {
        fileSystemAdapter: {
          name: 'mock-fs',
          capabilities: {
            fileDownload: true,
            downloadProgress: true
          },
          downloadFile
        }
      }
    } as any, new RezoCookieJar());

    const finish = await finishPromise;

    expect(returned).toBe(downloadResponse);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(downloadFile).toHaveBeenCalledTimes(2);
    expect(beforeRetry).toHaveBeenCalledTimes(1);
    expect(finish).toMatchObject({
      status: 200,
      finalUrl: 'https://example.com/file.bin',
      fileSize: 5
    });
  });

  it('retries retriable responses and returns the successful retry result', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createMockResponse({
        body: 'server error',
        headers: {
          'content-type': 'text/plain'
        },
        status: 500,
        statusText: 'Internal Server Error'
      }))
      .mockResolvedValueOnce(createMockResponse({
        body: '{"ok":true}',
        headers: {
          'content-type': 'application/json'
        },
        status: 200,
        statusText: 'OK'
      }));

    vi.stubGlobal('fetch', fetchMock);

    const response = await executeRequest<any>({
      url: 'https://example.com/retry',
      method: 'GET',
      retry: {
        limit: 1,
        delay: 0
      }
    } as any, {}, new RezoCookieJar()) as any;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true });
    expect(response.config.retryAttempts).toBe(1);
  });

  it('revalidates cached responses with etag headers and serves cached data on 304', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createMockResponse({
        body: '{"version":1}',
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-cache',
          etag: '"etag-1"'
        },
        url: 'https://example.com/cache'
      }))
      .mockResolvedValueOnce(createMockResponse({
        body: '',
        headers: {
          'cache-control': 'no-cache',
          etag: '"etag-1"'
        },
        status: 304,
        statusText: 'Not Modified',
        url: 'https://example.com/cache'
      }));

    vi.stubGlobal('fetch', fetchMock);

    const firstResponse = await executeRequest<any>({
      url: 'https://example.com/cache',
      method: 'GET',
      cache: true
    } as any, {}, new RezoCookieJar()) as any;

    const secondResponse = await executeRequest<any>({
      url: 'https://example.com/cache',
      method: 'GET',
      cache: true
    } as any, {}, new RezoCookieJar()) as any;

    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Headers;

    expect(firstResponse.data).toEqual({ version: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(secondHeaders.get('If-None-Match')).toBe('"etag-1"');
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.data).toEqual({ version: 1 });
    expect(secondResponse.config.fromCache).toBe(true);
  });

  it('reports RN picker capabilities truthfully and detects unsupported request modes', () => {
    const capabilities = getAdapterCapabilities('react-native');
    expect(capabilities).toMatchObject({
      cookies: true,
      streaming: false,
      downloadProgress: false,
      fileDownload: false
    });

    const streamContext = buildAdapterContext({
      url: 'https://example.com/stream',
      method: 'GET',
      responseType: 'stream'
    } as any, {});
    const downloadContext = buildAdapterContext({
      url: 'https://example.com/file.bin',
      method: 'GET',
      responseType: 'download'
    } as any, {});

    expect(streamContext.needsStreaming).toBe(true);
    expect(downloadContext.needsDownloadProgress).toBe(true);

    const selected = selectAdapter(streamContext, {
      isNode: false,
      isBrowser: false,
      isDeno: false,
      isBun: false,
      isReactNative: true,
      isEdge: false,
      isWebWorker: false,
      isElectronMain: false,
      isElectronRenderer: false
    });

    expect(selected).toBe('react-native');
  });

  it('detects configured RN file-system providers in picker context', () => {
    const context = buildAdapterContext({
      url: 'https://example.com/file.bin',
      method: 'GET',
      saveTo: '/tmp/file.bin',
      _isDownload: true,
      reactNative: {
        backgroundTask: {
          name: 'rezo.download'
        }
      }
    } as any, {
      reactNative: {
        backgroundTaskProvider: {
          registerTask: vi.fn(),
          unregisterTask: vi.fn()
        },
        fileSystemAdapter: {
          name: 'mock-fs',
          capabilities: {
            fileDownload: true,
            downloadProgress: true
          },
          downloadFile: vi.fn()
        }
      }
    } as any);

    expect(context.reactNative).toMatchObject({
      hasFileSystemAdapter: true,
      hasStreamTransport: false,
      hasFileDownloadSupport: true,
      hasDownloadProgressSupport: true,
      hasFileUploadSupport: false,
      hasUploadProgressSupport: false,
      hasBackgroundTaskProvider: true
    });
    expect(context.needsBackgroundTasks).toBe(true);
  });

  it('detects configured RN upload providers in picker context', () => {
    const context = buildAdapterContext({
      url: 'https://example.com/upload',
      method: 'POST',
      responseType: 'upload',
      reactNative: {
        upload: {
          uri: 'file:///tmp/picture.jpg',
          name: 'picture.jpg'
        }
      }
    } as any, {
      reactNative: {
        fileSystemAdapter: {
          name: 'mock-fs',
          capabilities: {
            uploadFromFile: true,
            uploadProgress: true
          },
          uploadFile: vi.fn()
        }
      }
    } as any);

    expect(context.reactNative).toMatchObject({
      hasFileUploadSupport: true,
      hasUploadProgressSupport: true
    });
    expect(context.needsUploadProgress).toBe(true);
  });

  it('detects configured RN stream transports in picker context', () => {
    const context = buildAdapterContext({
      url: 'https://example.com/stream',
      method: 'GET',
      responseType: 'stream'
    } as any, {
      reactNative: {
        streamTransport: {
          name: 'mock-stream',
          stream: vi.fn()
        }
      }
    } as any);

    expect(context.reactNative).toMatchObject({
      hasStreamTransport: true
    });
    expect(context.needsStreaming).toBe(true);
  });
});
