import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export class SessionCheckpoint {
  dir;
  path;
  lockPath;
  flushIntervalMs;
  pendingFlush = null;
  closed = false;
  lastState = null;
  constructor(outputDir, flushIntervalMs = 1000) {
    this.dir = join(outputDir, ".rezo-wget");
    this.path = join(this.dir, "session.json");
    this.lockPath = join(this.dir, "session.lock");
    this.flushIntervalMs = flushIntervalMs;
  }
  async acquireLock() {
    await fs.mkdir(this.dir, { recursive: true });
    try {
      const fh = await fs.open(this.lockPath, "wx");
      await fh.writeFile(String(process.pid));
      await fh.close();
      return true;
    } catch (err) {
      if (err.code === "EEXIST") {
        try {
          const existing = await fs.readFile(this.lockPath, "utf-8");
          const pid = parseInt(existing.trim(), 10);
          if (pid > 0) {
            try {
              process.kill(pid, 0);
              return false;
            } catch (probeErr) {
              const code = probeErr.code;
              if (code === "EPERM") {
                return false;
              }
              await fs.writeFile(this.lockPath, String(process.pid));
              return true;
            }
          }
        } catch {}
        return false;
      }
      throw err;
    }
  }
  async releaseLock() {
    try {
      await fs.unlink(this.lockPath);
    } catch {}
  }
  async load() {
    try {
      const raw = await fs.readFile(this.path, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1)
        return null;
      this.lastState = parsed;
      return parsed;
    } catch {
      return null;
    }
  }
  async save(state, immediate = false) {
    if (this.closed)
      return;
    const full = {
      ...state,
      version: 1,
      updatedAt: new Date().toISOString()
    };
    this.lastState = full;
    if (immediate) {
      await this.flushNow();
      return;
    }
    if (this.pendingFlush)
      return;
    this.pendingFlush = setTimeout(() => {
      this.pendingFlush = null;
      this.flushNow();
    }, this.flushIntervalMs);
    this.pendingFlush.unref?.();
  }
  async flushNow() {
    if (!this.lastState)
      return;
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.lastState, null, 2), "utf-8");
    await fs.rename(tmp, this.path);
  }
  async close() {
    if (this.closed)
      return;
    this.closed = true;
    if (this.pendingFlush) {
      clearTimeout(this.pendingFlush);
      this.pendingFlush = null;
    }
    await this.flushNow();
    await this.releaseLock();
  }
  async clear() {
    try {
      await fs.unlink(this.path);
    } catch {}
  }
}
export function hashSeedUrls(urls) {
  const h = createHash("sha1");
  for (const u of urls.slice().sort())
    h.update(u + `
`);
  return h.digest("hex").slice(0, 12);
}
