import o from"node:fs";import d from"node:path";import{createHash as a}from"node:crypto";import{createDatabase as E}from"./sqlite-utils.js";class n{db=null;options;storeDir;dbPath;closed=!1;initPromise=null;constructor(s={}){if(this.options={storeDir:s.storeDir||"/tmp/rezo-crawler/navigation",dbFileName:s.dbFileName||"navigation.db",hashUrls:s.hashUrls??!1},this.storeDir=d.resolve(this.options.storeDir),this.dbPath=d.join(this.storeDir,this.options.dbFileName),!o.existsSync(this.storeDir))o.mkdirSync(this.storeDir,{recursive:!0})}static async create(s={}){let i=new n(s);return await i.initialize(),i}async initialize(){if(this.initPromise)return this.initPromise;return this.initPromise=(async()=>{this.db=await E(this.dbPath),this.db.run("PRAGMA journal_mode = WAL"),this.db.run("PRAGMA synchronous = NORMAL"),this.db.run("PRAGMA cache_size = -32000"),this.db.run("PRAGMA temp_store = MEMORY"),this.db.run("PRAGMA mmap_size = 134217728"),this.db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          sessionId TEXT PRIMARY KEY,
          baseUrl TEXT NOT NULL,
          startedAt INTEGER NOT NULL,
          lastActivityAt INTEGER NOT NULL,
          status TEXT DEFAULT 'running',
          urlsVisited INTEGER DEFAULT 0,
          urlsQueued INTEGER DEFAULT 0,
          urlsFailed INTEGER DEFAULT 0,
          metadata TEXT
        )
      `),this.db.run(`
        CREATE TABLE IF NOT EXISTS queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sessionId TEXT NOT NULL,
          urlKey TEXT NOT NULL,
          originalUrl TEXT NOT NULL,
          method TEXT DEFAULT 'GET',
          priority INTEGER DEFAULT 0,
          body TEXT,
          headers TEXT,
          metadata TEXT,
          addedAt INTEGER NOT NULL,
          UNIQUE(sessionId, urlKey)
        )
      `),this.db.run(`
        CREATE TABLE IF NOT EXISTS visited (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sessionId TEXT NOT NULL,
          urlKey TEXT NOT NULL,
          originalUrl TEXT NOT NULL,
          status INTEGER,
          visitedAt INTEGER NOT NULL,
          finalUrl TEXT,
          contentType TEXT,
          errorMessage TEXT,
          UNIQUE(sessionId, urlKey)
        )
      `),this.db.run("CREATE INDEX IF NOT EXISTS idx_queue_session ON queue(sessionId)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_queue_priority ON queue(sessionId, priority DESC)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_visited_session ON visited(sessionId)"),this.db.run("CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)")})(),this.initPromise}getUrlKey(s){if(this.options.hashUrls)return a("sha256").update(s).digest("hex");return s}async createSession(s,i,t){if(this.closed||!this.db)throw Error("NavigationHistory is closed");let e=Date.now(),r={sessionId:s,baseUrl:i,startedAt:e,lastActivityAt:e,status:"running",urlsVisited:0,urlsQueued:0,urlsFailed:0,metadata:t?JSON.stringify(t):void 0};return this.db.run(`INSERT OR REPLACE INTO sessions (sessionId, baseUrl, startedAt, lastActivityAt, status, urlsVisited, urlsQueued, urlsFailed, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,s,i,e,e,"running",0,0,0,r.metadata??null),r}async getSession(s){if(this.closed||!this.db)throw Error("NavigationHistory is closed");return this.db.get("SELECT * FROM sessions WHERE sessionId = ?",s)}async updateSessionStatus(s,i){if(this.closed||!this.db)throw Error("NavigationHistory is closed");this.db.run("UPDATE sessions SET status = ?, lastActivityAt = ? WHERE sessionId = ?",i,Date.now(),s)}async updateSessionStats(s,i){if(this.closed||!this.db)throw Error("NavigationHistory is closed");let t=["lastActivityAt = ?"],e=[Date.now()];if(i.urlsVisited!==void 0)t.push("urlsVisited = ?"),e.push(i.urlsVisited);if(i.urlsQueued!==void 0)t.push("urlsQueued = ?"),e.push(i.urlsQueued);if(i.urlsFailed!==void 0)t.push("urlsFailed = ?"),e.push(i.urlsFailed);e.push(s),this.db.run(`UPDATE sessions SET ${t.join(", ")} WHERE sessionId = ?`,...e)}async addToQueue(s,i,t={}){if(this.closed||!this.db)throw Error("NavigationHistory is closed");let e=this.getUrlKey(i);if(this.db.get("SELECT id FROM queue WHERE sessionId = ? AND urlKey = ?",s,e))return!1;if(this.db.get("SELECT id FROM visited WHERE sessionId = ? AND urlKey = ?",s,e))return!1;return this.db.run(`INSERT INTO queue (sessionId, urlKey, originalUrl, method, priority, body, headers, metadata, addedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,s,e,i,t.method||"GET",t.priority||0,t.body?JSON.stringify(t.body):null,t.headers?JSON.stringify(t.headers):null,t.metadata?JSON.stringify(t.metadata):null,Date.now()),!0}async getNextFromQueue(s){if(this.closed||!this.db)throw Error("NavigationHistory is closed");return this.db.get("SELECT originalUrl as url, method, priority, body, headers, metadata, addedAt FROM queue WHERE sessionId = ? ORDER BY priority DESC, addedAt ASC LIMIT 1",s)}async removeFromQueue(s,i){if(this.closed||!this.db)throw Error("NavigationHistory is closed");let t=this.getUrlKey(i);return this.db.run("DELETE FROM queue WHERE sessionId = ? AND urlKey = ?",s,t),!0}async getQueueSize(s){if(this.closed||!this.db)throw Error("NavigationHistory is closed");return this.db.get("SELECT COUNT(*) as count FROM queue WHERE sessionId = ?",s)?.count||0}async markVisited(s,i,t={}){if(this.closed||!this.db)throw Error("NavigationHistory is closed");let e=this.getUrlKey(i);this.db.run("DELETE FROM queue WHERE sessionId = ? AND urlKey = ?",s,e),this.db.run(`INSERT OR REPLACE INTO visited (sessionId, urlKey, originalUrl, status, visitedAt, finalUrl, contentType, errorMessage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,s,e,i,t.status||0,Date.now(),t.finalUrl??null,t.contentType??null,t.errorMessage??null)}async isVisited(s,i){if(this.closed||!this.db)throw Error("NavigationHistory is closed");let t=this.getUrlKey(i);return!!this.db.get("SELECT id FROM visited WHERE sessionId = ? AND urlKey = ?",s,t)}async getVisitedCount(s){if(this.closed||!this.db)throw Error("NavigationHistory is closed");return this.db.get("SELECT COUNT(*) as count FROM visited WHERE sessionId = ?",s)?.count||0}async getFailedUrls(s){if(this.closed||!this.db)throw Error("NavigationHistory is closed");return this.db.all("SELECT originalUrl as url, status, visitedAt, finalUrl, contentType, errorMessage FROM visited WHERE sessionId = ? AND (status >= 400 OR errorMessage IS NOT NULL)",s)}async getAllQueuedUrls(s){if(this.closed||!this.db)throw Error("NavigationHistory is closed");return this.db.all("SELECT originalUrl as url, method, priority, body, headers, metadata, addedAt FROM queue WHERE sessionId = ? ORDER BY priority DESC, addedAt ASC",s)}async clearQueue(s){if(this.closed||!this.db)throw Error("NavigationHistory is closed");this.db.run("DELETE FROM queue WHERE sessionId = ?",s)}async clearVisited(s){if(this.closed||!this.db)throw Error("NavigationHistory is closed");this.db.run("DELETE FROM visited WHERE sessionId = ?",s)}async deleteSession(s){if(this.closed||!this.db)throw Error("NavigationHistory is closed");this.db.run("DELETE FROM queue WHERE sessionId = ?",s),this.db.run("DELETE FROM visited WHERE sessionId = ?",s),this.db.run("DELETE FROM sessions WHERE sessionId = ?",s)}async getResumableSessions(){if(this.closed||!this.db)throw Error("NavigationHistory is closed");return this.db.all("SELECT * FROM sessions WHERE status IN ('running', 'paused') ORDER BY lastActivityAt DESC")}async close(){if(this.closed)return;if(this.closed=!0,this.db){try{this.db.run("PRAGMA wal_checkpoint(TRUNCATE)")}catch{}try{this.db.close()}catch{}this.db=null}}get isClosed(){return this.closed}get databasePath(){return this.dbPath}}export{n as NavigationHistory};
