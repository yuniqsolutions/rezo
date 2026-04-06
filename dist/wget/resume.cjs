const { promises: fs } = require("node:fs");

class ResumeHandler {
  options;
  constructor(options) {
    this.options = options;
  }
  async getResumeInfo(localPath) {
    try {
      const stats = await fs.stat(localPath);
      return {
        path: localPath,
        bytesDownloaded: stats.size,
        mtime: stats.mtime,
        exists: true,
        canResume: this.options.continueDownload === true && stats.size > 0
      };
    } catch {
      return {
        path: localPath,
        bytesDownloaded: 0,
        mtime: new Date(0),
        exists: false,
        canResume: false
      };
    }
  }
  getResumeHeaders(info) {
    if (!info.canResume) {
      return {};
    }
    return {
      Range: `bytes=${info.bytesDownloaded}-`,
      "If-Range": info.mtime.toUTCString()
    };
  }
  async getTimestampHeaders(localPath) {
    if (!this.options.timestamping) {
      return {};
    }
    try {
      const stats = await fs.stat(localPath);
      return {
        "If-Modified-Since": stats.mtime.toUTCString()
      };
    } catch {
      return {};
    }
  }
  async checkTimestamp(localPath, remoteMtime) {
    if (!this.options.timestamping) {
      return {
        shouldDownload: true,
        reason: "no-timestamp"
      };
    }
    if (!remoteMtime) {
      return {
        shouldDownload: true,
        reason: "no-timestamp"
      };
    }
    try {
      const stats = await fs.stat(localPath);
      const localMtime = stats.mtime;
      const timeDiff = remoteMtime.getTime() - localMtime.getTime();
      if (timeDiff > 1000) {
        return {
          shouldDownload: true,
          reason: "newer",
          localMtime,
          remoteMtime
        };
      } else if (timeDiff < -1000) {
        return {
          shouldDownload: false,
          reason: "older",
          localMtime,
          remoteMtime
        };
      } else {
        return {
          shouldDownload: false,
          reason: "same",
          localMtime,
          remoteMtime
        };
      }
    } catch {
      return {
        shouldDownload: true,
        reason: "not-found",
        remoteMtime
      };
    }
  }
  isValidPartialResponse(statusCode, contentRange, expectedStart) {
    if (statusCode !== 206) {
      return false;
    }
    if (!contentRange) {
      return false;
    }
    const match = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
    if (!match) {
      return false;
    }
    const start = parseInt(match[1], 10);
    if (start !== expectedStart) {
      return false;
    }
    return true;
  }
  parseContentRange(contentRange) {
    if (!contentRange)
      return null;
    const match = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
    if (!match)
      return null;
    return {
      start: parseInt(match[1], 10),
      end: parseInt(match[2], 10),
      total: match[3] === "*" ? null : parseInt(match[3], 10)
    };
  }
  supportsRanges(acceptRanges) {
    if (!acceptRanges)
      return true;
    return acceptRanges.toLowerCase() !== "none";
  }
  parseLastModified(lastModified) {
    if (!lastModified)
      return null;
    try {
      const date = new Date(lastModified);
      return isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }
  determineAction(statusCode, contentRange, resumeInfo) {
    if (statusCode === 304) {
      return "skip";
    }
    if (statusCode === 206) {
      if (this.isValidPartialResponse(statusCode, contentRange, resumeInfo.bytesDownloaded)) {
        return "resume";
      }
      return "restart";
    }
    if (statusCode === 200) {
      return "restart";
    }
    if (statusCode === 416) {
      return "skip";
    }
    return "restart";
  }
  updateOptions(options) {
    this.options = { ...this.options, ...options };
  }
}

exports.ResumeHandler = ResumeHandler;
exports.default = ResumeHandler;
module.exports = Object.assign(ResumeHandler, exports);