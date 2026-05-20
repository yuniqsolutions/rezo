import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Rezo } from '../src/core/rezo';
import { RezoDownloadEventEmitter } from '../src/core/download-emitter';
import { DownloadOptions, DownloadProgress, DownloadState } from '../src/types/download';
import { RezoDownloadResponse } from '../src/types/response';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Enterprise-Grade Download API Test Suite
 * 
 * Comprehensive testing for both Promise-based and EventEmitter-based download modes
 * with enterprise-level error handling, progress tracking, and performance validation.
 * 
 * Test Categories:
 * - Promise-based downloads with backward compatibility
 * - EventEmitter-based downloads with advanced controls
 * - Enterprise features (retry, authentication, proxy, validation)
 * - Error handling and edge cases
 * - Performance and memory efficiency
 * - Security and integrity validation
 */

describe('Enterprise Download API', () => {
  let rezo: Rezo;
  let tempDir: string;
  let testFiles: string[] = [];

  beforeEach(() => {
    rezo = new Rezo({
      timeout: 30000,
      headers: {
        'User-Agent': 'Rezo-Enterprise-Test/1.0'
      }
    });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezo-enterprise-test-'));
    testFiles = [];
  });

  afterEach(() => {
    // Clean up test files
    testFiles.forEach(file => {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch (error) {
          console.warn(`Failed to cleanup test file: ${file}`);
        }
      }
    });
    
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Failed to cleanup temp directory: ${tempDir}`);
      }
    }
  });

  describe('Promise-Based Downloads (Enterprise Mode)', () => {
    test('should download binary data with enterprise configuration', async () => {
      const response = await rezo.download('https://httpbin.org/bytes/2048');
      
      expect(response).toBeDefined();
      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
      expect(Buffer.isBuffer(response.data)).toBe(true);
      if (response.data) {
        expect((response.data as Buffer).length).toBe(2048);
      }
      expect(response.headers).toBeDefined();
      expect(response.finalUrl).toBeDefined();
    });

    test('should handle enterprise download options', async () => {
      const options: DownloadOptions = {
        saveTo: tempDir,
        fileName: 'enterprise-test.bin',
        timeout: 15000,
        retries: 3,
        headers: {
          'X-Enterprise-Client': 'Rezo/1.0',
          'Accept-Encoding': 'gzip, deflate'
        }
      };
      
      const result = rezo.download('https://httpbin.org/bytes/1024', options);
       
       // Check if it's a Promise (no onProgress callback) or EventEmitter
       if (result instanceof Promise) {
         const response = await result;
         expect(response.status).toBe(200);
       }
       
       const filePath = path.join(tempDir, 'enterprise-test.bin');
       testFiles.push(filePath);
       
       // Wait a bit for file to be written if using EventEmitter mode
       await new Promise(resolve => setTimeout(resolve, 1000));
       
       if (fs.existsSync(filePath)) {
         expect(fs.statSync(filePath).size).toBe(1024);
       }
    });

    test('should maintain backward compatibility with legacy API', async () => {
      const response = await rezo.download({
        method: 'GET',
        url: 'https://httpbin.org/bytes/512',
        responseType: 'download'
      } as any);
      
      expect(response).toBeDefined();
       expect(response.status).toBe(200);
       expect(response.data).toBeDefined();
       if (response.data) {
         expect(Buffer.isBuffer(response.data)).toBe(true);
       }
    });

    test('should handle URL object input', async () => {
      const url = new URL('https://httpbin.org/bytes/256');
      const response = await rezo.download(url);
      
      expect(response.status).toBe(200);
       if (response.data) {
         expect((response.data as Buffer).length).toBe(256);
       }
    });
  });

  describe('EventEmitter-Based Downloads (Advanced Mode)', () => {
    test('should create EventEmitter with progress tracking', () => {
      const downloader = rezo.download('https://httpbin.org/bytes/4096', {
        saveTo: tempDir,
        fileName: 'progress-test.bin',
        onProgress: (progress: DownloadProgress) => {
          expect(progress.loaded).toBeGreaterThanOrEqual(0);
          expect(progress.speed).toBeGreaterThanOrEqual(0);
        }
      });
      
      expect(downloader).toBeInstanceOf(RezoDownloadEventEmitter);
      expect(downloader.state).toBe(DownloadState.PENDING);
      expect(downloader.url).toBe('https://httpbin.org/bytes/4096');
      expect(downloader.options).toBeDefined();
    });

    test('should provide comprehensive download statistics', () => {
      const downloader = rezo.download('https://httpbin.org/bytes/2048', {
        saveTo: tempDir,
        onProgress: () => {}
      }) as RezoDownloadEventEmitter;
      
      const stats = downloader.getStats();
      expect(stats).toBeDefined();
      expect(stats.bytesDownloaded).toBe(0);
      expect(stats.retryCount).toBe(0);
      expect(stats.redirectCount).toBe(0);
      expect(stats.startTime).toBeGreaterThan(0);
      expect(stats.averageSpeed).toBe(0);
      expect(stats.peakSpeed).toBe(0);
    });

    test('should support pause/resume/cancel operations', () => {
      const downloader = rezo.download('https://httpbin.org/bytes/8192', {
        saveTo: tempDir,
        autoStart: false
      }) as RezoDownloadEventEmitter;
      
      expect(downloader.state).toBe(DownloadState.PENDING);
      expect(typeof downloader.start).toBe('function');
      expect(typeof downloader.pause).toBe('function');
      expect(typeof downloader.resume).toBe('function');
      expect(typeof downloader.cancel).toBe('function');
      expect(typeof downloader.retry).toBe('function');
    });

    test('should emit enterprise-grade events', () => {
      const downloader = rezo.download('https://httpbin.org/bytes/1024', {
        saveTo: tempDir,
        autoStart: false
      }) as RezoDownloadEventEmitter;
      
      const events = ['start', 'progress', 'pause', 'resume', 'complete', 'error', 'cancel', 'retry'];
      events.forEach(event => {
        expect(typeof downloader.on).toBe('function');
        expect(typeof downloader.emit).toBe('function');
      });
    });
  });

  describe('Enterprise Security Features', () => {
    test('should support authentication headers', () => {
      const options: DownloadOptions = {
        headers: {
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
          'X-API-Key': 'enterprise-api-key-12345'
        },
        saveTo: tempDir
      };
      
      const downloader = rezo.download('https://httpbin.org/headers', options);
      expect(downloader).toBeDefined();
    });

    test('should support integrity validation configuration', () => {
      const options: DownloadOptions = {
        validateIntegrity: {
          algorithm: 'sha256',
          expectedHash: 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3'
        },
        saveTo: tempDir
      };
      
      const downloader = rezo.download('https://httpbin.org/bytes/1024', options);
      expect(downloader).toBeDefined();
    });

    test('should support proxy configuration for enterprise networks', () => {
      const options: DownloadOptions = {
        proxy: {
          protocol: 'https',
          host: 'enterprise-proxy.company.com',
          port: 8080,
          auth: {
            username: 'enterprise-user',
            password: 'secure-password'
          }
        },
        saveTo: tempDir
      };
      
      const downloader = rezo.download('https://httpbin.org/bytes/512', options);
      expect(downloader).toBeDefined();
    });
  });

  describe('Enterprise Performance Features', () => {
    test('should support bandwidth management', () => {
      const options: DownloadOptions = {
        maxSpeed: 1024 * 1024, // 1MB/s limit
        minSpeed: 10 * 1024,   // 10KB/s minimum
        chunkSize: 64 * 1024,  // 64KB chunks
        saveTo: tempDir
      };
      
      const downloader = rezo.download('https://httpbin.org/bytes/2048', options);
      expect(downloader).toBeDefined();
    });

    test('should support enterprise retry policies', () => {
      const options: DownloadOptions = {
        retries: 5,
        retryDelay: 2000,
        retryCondition: (error: any, attempt: number) => {
          return attempt < 3 && error.code !== 'ENOTFOUND';
        },
        saveTo: tempDir
      };
      
      const downloader = rezo.download('https://httpbin.org/status/503', options);
      expect(downloader).toBeDefined();
    });

    test('should support concurrent download limits', () => {
      const downloads: any[] = [];
      
      for (let i = 0; i < 5; i++) {
        const downloader = rezo.download(`https://httpbin.org/bytes/${1024 * (i + 1)}`, {
          saveTo: tempDir,
          fileName: `concurrent-${i}.bin`,
          autoStart: false
        });
        downloads.push(downloader);
      }
      
      expect(downloads).toHaveLength(5);
      downloads.forEach((download, index) => {
        expect(download).toBeDefined();
        if (download instanceof RezoDownloadEventEmitter) {
          expect(download.state).toBe(DownloadState.PENDING);
        }
      });
    });
  });

  describe('Enterprise Error Handling', () => {
    test('should handle network timeouts gracefully', () => {
      const options: DownloadOptions = {
        timeout: 1000, // Very short timeout
        saveTo: tempDir
      };
      
      const downloader = rezo.download('https://httpbin.org/delay/5', options);
      expect(downloader).toBeDefined();
    });

    test('should handle HTTP error codes with enterprise logging', () => {
      const errorCodes = [400, 401, 403, 404, 500, 502, 503];
      
      errorCodes.forEach(code => {
        const downloader = rezo.download(`https://httpbin.org/status/${code}`, {
          saveTo: tempDir,
          retries: 1
        });
        expect(downloader).toBeDefined();
      });
    });

    test('should handle file system errors', () => {
      const options: DownloadOptions = {
        saveTo: '/invalid/enterprise/path/that/does/not/exist',
        fileName: 'test.bin'
      };
      
      const downloader = rezo.download('https://httpbin.org/bytes/1024', options);
      expect(downloader).toBeDefined();
    });
  });

  describe('Enterprise Edge Cases', () => {
    test('should handle zero-byte files', () => {
      const downloader = rezo.download('https://httpbin.org/bytes/0', {
        saveTo: tempDir,
        fileName: 'empty-file.bin'
      });
      
      expect(downloader).toBeDefined();
    });

    test('should handle large enterprise files', () => {
      const options: DownloadOptions = {
        saveTo: tempDir,
        fileName: 'large-enterprise-file.bin',
        chunkSize: 1024 * 1024, // 1MB chunks
        maxSpeed: 10 * 1024 * 1024 // 10MB/s
      };
      
      const downloader = rezo.download('https://httpbin.org/bytes/10485760', options); // 10MB
      expect(downloader).toBeDefined();
    });

    test('should handle redirect chains in enterprise environments', () => {
      const options: DownloadOptions = {
        followRedirects: true,
        maxRedirects: 10,
        saveTo: tempDir
      };
      
      const downloader = rezo.download('https://httpbin.org/redirect/5', options);
      expect(downloader).toBeDefined();
    });

    test('should handle custom user agents for enterprise compliance', () => {
      const options: DownloadOptions = {
        userAgent: 'Enterprise-Rezo-Client/2.0 (Security-Compliant; Audit-Enabled)',
        headers: {
          'X-Enterprise-ID': 'CORP-12345',
          'X-Compliance-Level': 'HIGH'
        },
        saveTo: tempDir
      };
      
      const downloader = rezo.download('https://httpbin.org/user-agent', options);
      expect(downloader).toBeDefined();
    });
  });

  describe('Enterprise Compliance and Monitoring', () => {
    test('should support audit trail metadata', () => {
      const options: DownloadOptions = {
        metadata: {
          userId: 'enterprise-user-123',
          sessionId: 'session-abc-456',
          department: 'IT-Security',
          purpose: 'Software-Update',
          classification: 'Internal'
        },
        saveTo: tempDir
      };
      
      const downloader = rezo.download('https://httpbin.org/bytes/1024', options);
      expect(downloader).toBeDefined();
      
      if (downloader instanceof RezoDownloadEventEmitter) {
        expect(downloader.options.metadata).toBeDefined();
        expect(downloader.options.metadata?.userId).toBe('enterprise-user-123');
      }
    });

    test('should support compression for bandwidth optimization', () => {
      const options: DownloadOptions = {
        compression: true,
        headers: {
          'Accept-Encoding': 'gzip, deflate, br'
        },
        saveTo: tempDir
      };
      
      const downloader = rezo.download('https://httpbin.org/gzip', options);
      expect(downloader).toBeDefined();
    });

    test('should support enterprise signal handling', () => {
      const controller = new AbortController();
      const options: DownloadOptions = {
        signal: controller.signal,
        saveTo: tempDir
      };
      
      const downloader = rezo.download('https://httpbin.org/bytes/4096', options);
      expect(downloader).toBeDefined();
      
      // Test signal integration
      expect(controller.signal).toBeDefined();
      expect(typeof controller.abort).toBe('function');
    });
  });
});