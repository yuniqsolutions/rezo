import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NavigationHistory } from '../src/crawler/index.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rezo-navigation-history-test-'));
}

describe('NavigationHistory', () => {
  it('returns failed URLs using the stored originalUrl field', async () => {
    const tempDir = createTempDir();

    try {
      const history = await NavigationHistory.create({
        storeDir: tempDir,
        dbFileName: 'navigation.db'
      });

      await history.createSession('failed-session', 'https://example.com');
      await history.markVisited('failed-session', 'https://example.com/failure', {
        status: 503,
        finalUrl: 'https://example.com/failure',
        contentType: 'text/html',
        errorMessage: 'Upstream error'
      });

      await expect(history.getFailedUrls('failed-session')).resolves.toEqual([
        expect.objectContaining({
          url: 'https://example.com/failure',
          status: 503,
          errorMessage: 'Upstream error'
        })
      ]);

      await history.close();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
