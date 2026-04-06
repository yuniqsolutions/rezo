class ProgressTracker {
  url;
  filename;
  totalBytes = null;
  bytesDownloaded = 0;
  startTime = 0;
  lastUpdateTime = 0;
  lastBytes = 0;
  speed = 0;
  contentType = null;
  speedSamples = [];
  maxSamples = 10;
  constructor(url, filename) {
    this.url = url;
    this.filename = filename;
  }
  start(totalBytes, contentType) {
    this.totalBytes = totalBytes;
    this.bytesDownloaded = 0;
    this.startTime = Date.now();
    this.lastUpdateTime = this.startTime;
    this.lastBytes = 0;
    this.speed = 0;
    this.speedSamples = [];
    this.contentType = contentType || null;
  }
  update(bytesDownloaded) {
    const now = Date.now();
    const timeDiff = now - this.lastUpdateTime;
    if (timeDiff > 0) {
      const bytesDiff = bytesDownloaded - this.lastBytes;
      const instantSpeed = bytesDiff / timeDiff * 1000;
      this.speedSamples.push(instantSpeed);
      if (this.speedSamples.length > this.maxSamples) {
        this.speedSamples.shift();
      }
      this.speed = this.speedSamples.reduce((a, b) => a + b, 0) / this.speedSamples.length;
    }
    this.bytesDownloaded = bytesDownloaded;
    this.lastBytes = bytesDownloaded;
    this.lastUpdateTime = now;
  }
  getProgress() {
    let percent = null;
    let eta = null;
    if (this.totalBytes !== null && this.totalBytes > 0) {
      percent = Math.min(100, this.bytesDownloaded / this.totalBytes * 100);
      if (this.speed > 0) {
        const remaining = this.totalBytes - this.bytesDownloaded;
        eta = remaining / this.speed;
      }
    }
    return {
      url: this.url,
      filename: this.filename,
      bytesDownloaded: this.bytesDownloaded,
      totalBytes: this.totalBytes,
      percent,
      speed: this.speed,
      eta,
      contentType: this.contentType
    };
  }
  getElapsed() {
    return Date.now() - this.startTime;
  }
  getAverageSpeed() {
    const elapsed = this.getElapsed();
    if (elapsed === 0)
      return 0;
    return this.bytesDownloaded / elapsed * 1000;
  }
}

class ProgressReporter {
  options;
  stats;
  activeDownloads = new Map;
  progressCallback;
  constructor(options) {
    this.options = options;
    this.stats = {
      urlsDownloaded: 0,
      urlsFailed: 0,
      urlsSkipped: 0,
      bytesDownloaded: 0,
      filesWritten: 0,
      startTime: Date.now()
    };
  }
  onProgress(callback) {
    this.progressCallback = callback;
  }
  createTracker(url, filename) {
    const tracker = new ProgressTracker(url, filename);
    this.activeDownloads.set(url, tracker);
    return tracker;
  }
  reportProgress(tracker) {
    const progress = tracker.getProgress();
    if (this.progressCallback) {
      this.progressCallback(progress);
    }
    if (!this.options.quiet && this.options.progress !== "none") {
      this.displayProgress(progress);
    }
  }
  reportComplete(url, size) {
    this.stats.urlsDownloaded++;
    this.stats.bytesDownloaded += size;
    this.stats.filesWritten++;
    this.activeDownloads.delete(url);
  }
  reportFailed(url) {
    this.stats.urlsFailed++;
    this.activeDownloads.delete(url);
  }
  reportSkipped(url, reason) {
    this.stats.urlsSkipped++;
    if (this.options.verbose && !this.options.quiet) {
      this.log(`Skipped: ${url} (${reason})`);
    }
  }
  displayProgress(progress) {
    const style = this.options.progress || "bar";
    if (style === "bar") {
      this.displayBar(progress);
    } else if (style === "dot") {
      this.displayDot(progress);
    }
  }
  displayBar(progress) {
    const width = 40;
    const percent = progress.percent ?? 0;
    const filled = Math.round(width * percent / 100);
    const empty = width - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    const speedStr = this.formatSpeed(progress.speed);
    const etaStr = progress.eta !== null ? this.formatTime(progress.eta) : "--:--";
    const sizeStr = this.formatBytes(progress.bytesDownloaded);
    const totalStr = progress.totalBytes !== null ? "/" + this.formatBytes(progress.totalBytes) : "";
    const line = `[${bar}] ${percent.toFixed(1)}% ${sizeStr}${totalStr} ${speedStr} ETA: ${etaStr}`;
    if (this.options.showProgress || process.stdout.isTTY) {
      process.stdout.write("\r" + line);
    }
  }
  displayDot(progress) {
    const kb = Math.floor(progress.bytesDownloaded / 1024);
    const dots = kb - this.getDotCount(progress.url);
    if (dots > 0) {
      process.stdout.write(".".repeat(Math.min(dots, 50)));
    }
  }
  dotCounts = new Map;
  getDotCount(url) {
    return this.dotCounts.get(url) || 0;
  }
  log(message) {
    if (!this.options.quiet) {
      console.log(message);
    }
  }
  debug(message) {
    if (this.options.debug && !this.options.quiet) {
      console.log(`[DEBUG] ${message}`);
    }
  }
  verbose(message) {
    if (this.options.verbose && !this.options.quiet) {
      console.log(message);
    }
  }
  formatBytes(bytes) {
    if (bytes < 1024)
      return `${bytes} B`;
    if (bytes < 1024 * 1024)
      return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  formatSpeed(bytesPerSecond) {
    const unit = this.options.reportSpeed || "bytes";
    if (unit === "bits") {
      const bps = bytesPerSecond * 8;
      if (bps < 1024)
        return `${bps.toFixed(0)} bps`;
      if (bps < 1024 * 1024)
        return `${(bps / 1024).toFixed(1)} Kbps`;
      if (bps < 1024 * 1024 * 1024)
        return `${(bps / (1024 * 1024)).toFixed(1)} Mbps`;
      return `${(bps / (1024 * 1024 * 1024)).toFixed(2)} Gbps`;
    }
    if (bytesPerSecond < 1024)
      return `${bytesPerSecond.toFixed(0)} B/s`;
    if (bytesPerSecond < 1024 * 1024)
      return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    if (bytesPerSecond < 1024 * 1024 * 1024)
      return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
    return `${(bytesPerSecond / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
  }
  formatTime(seconds) {
    if (seconds < 0)
      return "--:--";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  }
  finish() {
    this.stats.endTime = Date.now();
    this.stats.duration = this.stats.endTime - this.stats.startTime;
    return this.stats;
  }
  getStats() {
    return { ...this.stats };
  }
  formatStats() {
    const stats = this.getStats();
    const duration = stats.duration || Date.now() - stats.startTime;
    const avgSpeed = duration > 0 ? stats.bytesDownloaded / duration * 1000 : 0;
    const lines = [
      "",
      `FINISHED --${new Date().toISOString()}--`,
      `Total: ${stats.urlsDownloaded} file(s), ${this.formatBytes(stats.bytesDownloaded)}`,
      `Downloaded: ${stats.filesWritten} file(s) in ${this.formatTime(duration / 1000)}`,
      `Average speed: ${this.formatSpeed(avgSpeed)}`
    ];
    if (stats.urlsFailed > 0) {
      lines.push(`Failed: ${stats.urlsFailed} URL(s)`);
    }
    if (stats.urlsSkipped > 0) {
      lines.push(`Skipped: ${stats.urlsSkipped} URL(s)`);
    }
    return lines.join(`
`);
  }
  newline() {
    if (!this.options.quiet && this.options.progress !== "none") {
      console.log("");
    }
  }
}
function parseSize(size) {
  if (typeof size === "number")
    return size;
  const match = size.match(/^(\d+(?:\.\d+)?)\s*([kmgKMG])?$/);
  if (!match)
    return parseInt(size, 10) || 0;
  const value = parseFloat(match[1]);
  const unit = (match[2] || "").toLowerCase();
  switch (unit) {
    case "k":
      return value * 1024;
    case "m":
      return value * 1024 * 1024;
    case "g":
      return value * 1024 * 1024 * 1024;
    default:
      return value;
  }
}

exports.ProgressTracker = ProgressTracker;
exports.ProgressReporter = ProgressReporter;
exports.parseSize = parseSize;
exports.default = ProgressReporter;
module.exports = Object.assign(ProgressReporter, exports);