import { Blob as Blob$1 } from 'node:buffer';
import { Agent as HttpAgent, OutgoingHttpHeaders } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { Socket } from 'node:net';
import { SecureContext, TLSSocket } from 'node:tls';
import { Cookie as TouchCookie, CookieJar as TouchCookieJar, CreateCookieJarOptions, CreateCookieOptions, Nullable, Store } from 'tough-cookie';

/**
 * CrawlerCache - High-performance SQLite-based response caching for web crawlers
 *
 * Optimized specifically for crawler workloads with:
 * - WAL mode for high-throughput concurrent reads/writes
 * - Batch operations for efficient bulk storage
 * - Domain-based namespacing via column (single database)
 * - Optional zstd compression for storage efficiency
 * - LRU eviction to prevent unbounded growth
 *
 * @module cache/file-cacher
 * @author Rezo HTTP Client Library
 */
/**
 * Configuration options for CrawlerCache
 */
export interface FileCacherOptions {
	/**
	 * Directory path for storing the cache database
	 * @default '/tmp/rezo-crawler/cache'
	 */
	cacheDir?: string;
	/**
	 * Database filename
	 * @default 'cache.db'
	 */
	dbFileName?: string;
	/**
	 * Default time-to-live in milliseconds
	 * @default 604800000 (7 days)
	 */
	ttl?: number;
	/**
	 * Enable zstd compression for stored values (Node.js 22.15+)
	 * Reduces storage size but adds CPU overhead
	 * @default false
	 */
	compression?: boolean;
	/**
	 * Maximum total entries (0 = unlimited, recommended: 100000)
	 * Uses LRU eviction when limit is reached
	 * @default 100000
	 */
	maxEntries?: number;
}
declare class FileCacher {
	private db;
	private readonly options;
	private readonly cacheDir;
	private readonly dbPath;
	private closed;
	private initPromise;
	private evictionInProgress;
	/** Approximate in-memory entry count — avoids COUNT(*) on every eviction check */
	private approxEntryCount;
	private constructor();
	/**
	 * Create a new FileCacher instance
	 */
	static create(options?: FileCacherOptions): Promise<FileCacher>;
	/**
	 * Initialize the single database with optimized settings
	 */
	private initialize;
	/**
	 * Ensure database is initialized
	 */
	private ensureDb;
	/**
	 * Store a response in the cache
	 */
	set<T = any>(key: string, value: T, ttl?: number, namespace?: string): Promise<void>;
	/**
	 * Store multiple responses in a single transaction (batch operation)
	 */
	setMany<T = any>(entries: Array<{
		key: string;
		value: T;
		ttl?: number;
	}>, namespace?: string): Promise<void>;
	/**
	 * LRU eviction - removes oldest entries when limit exceeded
	 * Uses in-memory approxEntryCount for fast check, defers actual eviction
	 */
	private maybeEvict;
	/**
	 * Retrieve a cached response
	 */
	get<T = any>(key: string, namespace?: string): Promise<T | null>;
	/**
	 * Check if a key exists and is not expired
	 */
	has(key: string, namespace?: string): Promise<boolean>;
	/**
	 * Check multiple keys at once (batch operation)
	 */
	hasMany(keys: string[], namespace?: string): Promise<Set<string>>;
	/**
	 * Delete a key from the cache
	 */
	delete(key: string, namespace?: string): Promise<boolean>;
	/**
	 * Clear all entries in a namespace
	 */
	clear(namespace?: string): Promise<void>;
	/**
	 * Remove all expired entries across all namespaces
	 */
	cleanup(): Promise<number>;
	/**
	 * Get cache statistics
	 */
	stats(namespace?: string): Promise<{
		count: number;
		expired: number;
		namespaces: number;
	}>;
	/**
	 * Close the database connection
	 */
	close(): Promise<void>;
	get isClosed(): boolean;
	get directory(): string;
	get databasePath(): string;
}
export interface CrawlSession {
	sessionId: string;
	baseUrl: string;
	startedAt: number;
	lastActivityAt: number;
	status: "running" | "paused" | "completed" | "failed";
	urlsVisited: number;
	urlsQueued: number;
	urlsFailed: number;
	metadata?: string;
}
export interface RezoHttpHeaders {
	accept?: string | undefined;
	"accept-encoding"?: string | undefined;
	"accept-language"?: string | undefined;
	"accept-patch"?: string | undefined;
	"accept-ranges"?: string | undefined;
	"access-control-allow-credentials"?: string | undefined;
	"access-control-allow-headers"?: string | undefined;
	"access-control-allow-methods"?: string | undefined;
	"access-control-allow-origin"?: string | undefined;
	"access-control-expose-headers"?: string | undefined;
	"access-control-max-age"?: string | undefined;
	"access-control-request-headers"?: string | undefined;
	"access-control-request-method"?: string | undefined;
	age?: string | undefined;
	allow?: string | undefined;
	"alt-svc"?: string | undefined;
	authorization?: string | undefined;
	"cache-control"?: string | undefined;
	connection?: string | undefined;
	"content-disposition"?: string | undefined;
	"content-encoding"?: string | undefined;
	"content-language"?: string | undefined;
	"content-length"?: string | undefined;
	"content-location"?: string | undefined;
	"content-range"?: string | undefined;
	"content-type"?: string | undefined;
	cookie?: string | undefined;
	date?: string | undefined;
	etag?: string | undefined;
	expect?: string | undefined;
	expires?: string | undefined;
	forwarded?: string | undefined;
	from?: string | undefined;
	host?: string | undefined;
	"if-match"?: string | undefined;
	"if-modified-since"?: string | undefined;
	"if-none-match"?: string | undefined;
	"if-unmodified-since"?: string | undefined;
	"last-modified"?: string | undefined;
	location?: string | undefined;
	origin?: string | undefined;
	pragma?: string | undefined;
	"proxy-authenticate"?: string | undefined;
	"proxy-authorization"?: string | undefined;
	"public-key-pins"?: string | undefined;
	range?: string | undefined;
	referer?: string | undefined;
	"retry-after"?: string | undefined;
	"sec-fetch-site"?: string | undefined;
	"sec-fetch-mode"?: string | undefined;
	"sec-fetch-user"?: string | undefined;
	"sec-fetch-dest"?: string | undefined;
	"sec-websocket-accept"?: string | undefined;
	"sec-websocket-extensions"?: string | undefined;
	"sec-websocket-key"?: string | undefined;
	"sec-websocket-protocol"?: string | undefined;
	"sec-websocket-version"?: string | undefined;
	"sec-ch-ua"?: string | undefined;
	"sec-ch-ua-mobile"?: string | undefined;
	"sec-ch-ua-platform"?: string | undefined;
	"sec-ch-ua-full-version-list"?: string | undefined;
	"sec-ch-ua-arch"?: string | undefined;
	"sec-ch-ua-bitness"?: string | undefined;
	"sec-ch-ua-model"?: string | undefined;
	"sec-ch-ua-platform-version"?: string | undefined;
	"strict-transport-security"?: string | undefined;
	tk?: string | undefined;
	trailer?: string | undefined;
	"transfer-encoding"?: string | undefined;
	upgrade?: string | undefined;
	"user-agent"?: string | undefined;
	vary?: string | undefined;
	via?: string | undefined;
	warning?: string | undefined;
	"www-authenticate"?: string | undefined;
	"accept-charset"?: string | undefined;
	"cdn-cache-control"?: string | undefined;
	"content-security-policy"?: string | undefined;
	"content-security-policy-report-only"?: string | undefined;
	dav?: string | undefined;
	dnt?: string | undefined;
	"if-range"?: string | undefined;
	link?: string | undefined;
	"max-forwards"?: string | undefined;
	"public-key-pins-report-only"?: string | undefined;
	"referrer-policy"?: string | undefined;
	refresh?: string | undefined;
	server?: string | undefined;
	te?: string | undefined;
	"upgrade-insecure-requests"?: string | undefined;
	"x-content-type-options"?: string | undefined;
	"x-dns-prefetch-control"?: string | undefined;
	"x-frame-options"?: string | undefined;
	"x-xss-protection"?: string | undefined;
	"set-cookie"?: string[];
}
export type RezoHeadersInit = [
	string,
	string
][] | Record<string, string> | Headers | RezoHttpHeaders | RezoHeaders | OutgoingHttpHeaders;
declare class RezoHeaders extends Headers {
	[key: string]: any;
	constructor(init?: RezoHeadersInit);
	getAll(name: "set-cookie" | "Set-Cookie"): string[];
	getSetCookie(): string[];
	get size(): number;
	setContentType(value: string): this;
	getContentType(): string | undefined;
	setAuthorization(value: string): this;
	setUserAgent(value: string): this;
	getUserAgent(): string | undefined;
	getKeys(): string[];
	getValues(): string[];
	toEntries(): [
		string,
		string | string
	][];
	toNative(): Headers;
	toRaw(): [
		string,
		string
	][];
	toArray(): {
		key: string;
		value: string;
	}[];
	/**
	 * Returns headers as a plain object with keys in the specified order.
	 * Keys present in `order` come first (in that order), remaining keys appended at end.
	 * Used by stealth adapters to match browser header ordering.
	 */
	toOrderedObject(order: string[]): Record<string, string | string[]>;
	toObject(omit?: Array<keyof RezoHttpHeaders> | keyof RezoHttpHeaders): Record<string, string | string[]>;
	toString(): string;
	set(name: keyof RezoHttpHeaders, value: string): void;
	set(name: string, value: string): void;
	append(name: keyof RezoHttpHeaders, value: string): void;
	append(name: string, value: string): void;
	get(name: keyof RezoHttpHeaders): string | null;
	get(name: string): string | null;
	has(name: keyof RezoHttpHeaders): boolean;
	has(name: string): boolean;
	[Symbol.iterator](): HeadersIterator<[
		string,
		string
	]>;
	get [Symbol.toStringTag](): string;
}
declare class Cookie extends TouchCookie {
	constructor(options?: CreateCookieOptions);
	/**
	 * Fixes date fields that may have become strings during JSON deserialization.
	 * This is a workaround for tough-cookie's deserialization behavior in Bun/Node.js
	 * where Date objects become ISO strings.
	 */
	private fixDateFields;
	private getExpires;
	toNetscapeFormat(): string;
	toSetCookieString(): string;
	/**
	   * Retrieves the complete URL from the cookie object
	   * @returns {string | undefined} The complete URL including protocol, domain and path. Returns undefined if domain is not set
	   * @example
	   * const cookie = new Cookie({
	   *   domain: "example.com",
	   *   path: "/path",
	   *   secure: true
	   * });
	   * cookie.getURL(); // Returns: "https://example.com/path"
	   */
	getURL(): string | undefined;
	/**
	 * Type guard to check if an object is an instance of Cookie
	 * @param cookie - The object to check
	 * @returns {boolean} True if the object is a Cookie instance, false otherwise
	 * @example
	 * const obj = new Cookie();
	 * if (Cookie.isCookie(obj)) {
	 *   // obj is confirmed to be a Cookie instance
	 * }
	 */
	static isCookie(cookie: any): cookie is Cookie;
}
export interface SerializedCookie {
	key: string;
	value: string;
	expires?: string;
	maxAge?: number | "Infinity" | "-Infinity";
	domain?: string;
	path?: string;
	secure?: boolean;
	hostOnly?: boolean;
	creation?: string;
	lastAccessed?: string;
	[key: string]: unknown;
}
export interface Cookies {
	array: Cookie[];
	serialized: SerializedCookie[];
	netscape: string;
	string: string;
	setCookiesString: string[];
}
declare class RezoCookieJar extends TouchCookieJar {
	constructor();
	constructor(cookies: Cookie[]);
	constructor(cookies: Cookie[], url: string);
	constructor(store: Nullable<Store>, options?: CreateCookieJarOptions | boolean);
	private generateCookies;
	/**
	 * Get all cookies from the cookie jar.
	 *
	 * This method synchronously returns all cookies stored in the jar,
	 * including both regular and touch cookies.
	 *
	 * @returns {Cookies} An object containing arrays of all cookies,
	 * serialized representations, Netscape format strings, and set-cookie strings
	 * @see {@link getCookiesForRequest} - Get cookies for a specific request URL
	 */
	cookies(url?: string): Cookies;
	parseResponseCookies(cookies: Cookie[]): Cookies;
	static toNetscapeCookie(cookies: Cookie[] | SerializedCookie[]): string;
	static toCookieString(cookies: Cookie[] | SerializedCookie[]): string;
	toCookieString(): string;
	toNetscapeCookie(): string;
	toArray(): Cookie[];
	toSetCookies(): string[];
	toSerializedCookies(): SerializedCookie[];
	/**
	 * Get cookies for a request URL with proper browser-like matching.
	 * This method properly handles:
	 * - Domain matching (exact or parent domain)
	 * - Path matching (cookie path must be prefix of request path)
	 * - Secure flag (secure cookies only over HTTPS)
	 * - Expiry (expired cookies not returned)
	 *
	 * @param requestUrl - The full request URL including path (e.g., 'https://example.com/api/users')
	 * @returns Array of Cookie objects that should be sent with the request
	 */
	getCookiesForRequest(requestUrl: string | URL): Cookie[];
	/**
	 * Get the Cookie header value for a request URL with proper browser-like matching.
	 * Returns cookies in the format: "key1=value1; key2=value2"
	 *
	 * This is the browser-accurate way to build the Cookie header, properly filtering
	 * cookies by domain, path, secure flag, and expiry.
	 *
	 * @param requestUrl - The full request URL including path (e.g., 'https://example.com/api/users')
	 * @returns Cookie header string in "key=value; key=value" format
	 */
	getCookieHeader(requestUrl: string | URL): string;
	/**
	 * Debug method to show which cookies would be sent for a given URL.
	 * Useful for troubleshooting cookie matching issues.
	 *
	 * @param requestUrl - The full request URL including path
	 * @returns Object with matching cookies and the Cookie header that would be sent
	 */
	debugCookiesForRequest(requestUrl: string | URL): {
		url: string;
		matchingCookies: Array<{
			key: string;
			value: string;
			domain: string;
			path: string;
		}>;
		cookieHeader: string;
		allCookies: Array<{
			key: string;
			domain: string;
			path: string;
		}>;
	};
	setCookiesSync(setCookieArray: string[]): Cookies;
	setCookiesSync(setCookieArray: string[], url: string): Cookies;
	setCookiesSync(cookiesString: string): Cookies;
	setCookiesSync(cookiesString: string, url: string): Cookies;
	setCookiesSync(serializedCookies: SerializedCookie[]): Cookies;
	setCookiesSync(serializedCookies: SerializedCookie[], url: string): Cookies;
	setCookiesSync(cookieArray: Cookie[]): Cookies;
	setCookiesSync(cookieArray: Cookie[], url: string): Cookies;
	private splitSetCookiesString;
	private getUrlFromCookie;
	private parseNetscapeCookies;
	/**
	   * Converts Netscape cookie format to an array of Set-Cookie header strings
	   *
	   * @param netscapeCookieText - Netscape format cookie string
	   * @returns Array of Set-Cookie header strings
	   */
	static netscapeCookiesToSetCookieArray(netscapeCookieText: string): string[];
	/** Path to cookie file for persistence */
	private _cookieFile?;
	/** Get the cookie file path */
	get cookieFile(): string | undefined;
	/**
	 * Load cookies from a file (sync version).
	 * - .json files are loaded as serialized JSON cookies
	 * - .txt files are loaded as Netscape format cookies
	 *
	 * This method bypasses public suffix validation for persisted cookies only,
	 * keeping normal network cookie validation intact.
	 *
	 * @param filePath - Path to the cookie file
	 * @param defaultUrl - Default URL for cookies without domain (optional)
	 */
	loadFromFile(filePath: string, _defaultUrl?: string): void;
	/**
	 * Save cookies to a file.
	 * - .json files save cookies as serialized JSON
	 * - .txt files save cookies in Netscape format
	 *
	 * @param filePath - Path to save the cookies (defaults to the loaded file path)
	 */
	saveToFile(filePath?: string): void;
	/**
	 * Create a new RezoCookieJar from a cookie file.
	 * - .json files are loaded as serialized JSON cookies
	 * - .txt files are loaded as Netscape format cookies
	 *
	 * @param filePath - Path to the cookie file
	 * @param defaultUrl - Default URL for cookies without domain (optional)
	 * @returns A new RezoCookieJar with cookies loaded from the file
	 */
	static fromFile(filePath: string, defaultUrl?: string): RezoCookieJar;
}
declare class RezoFormData {
	private _fd;
	private _cachedContentType;
	private _cachedBuffer;
	private _boundary;
	constructor();
	/**
	 * Append a field to the form data
	 * @param name - Field name
	 * @param value - Field value (string, Blob, or Buffer)
	 * @param filename - Optional filename for file uploads
	 * @warning Buffer is only available in Node.js/Bun/Deno. Use Blob for browser/React Native.
	 */
	append(name: string, value: string | Blob | Buffer, filename?: string): void;
	/**
	 * Set a field in the form data (replaces existing)
	 * @param name - Field name
	 * @param value - Field value (string, Blob, or Buffer)
	 * @param filename - Optional filename for file uploads
	 * @warning Buffer is only available in Node.js/Bun/Deno. Use Blob for browser/React Native.
	 */
	set(name: string, value: string | Blob | Buffer, filename?: string): void;
	get(name: string): FormDataEntryValue | null;
	getAll(name: string): FormDataEntryValue[];
	has(name: string): boolean;
	delete(name: string): void;
	entries(): IterableIterator<[
		string,
		FormDataEntryValue
	]>;
	keys(): IterableIterator<string>;
	values(): IterableIterator<FormDataEntryValue>;
	forEach(callback: (value: FormDataEntryValue, key: string, parent: FormData) => void): void;
	[Symbol.iterator](): IterableIterator<[
		string,
		FormDataEntryValue
	]>;
	/**
	 * Get the underlying native FormData
	 */
	toNativeFormData(): FormData;
	/**
	 * Invalidate cached values when form data changes
	 */
	private _invalidateCache;
	/**
	 * Build and cache the Response for extracting headers and body
	 */
	private _buildResponse;
	/**
	 * Get boundary extracted from Content-Type header
	 * Must be called after getContentTypeAsync() to get accurate value
	 */
	getBoundary(): string;
	/**
	 * Get content type with boundary
	 * Returns cached value if available, otherwise returns a generated boundary
	 */
	getContentType(): string;
	/**
	 * Get content type asynchronously with proper boundary
	 */
	getContentTypeAsync(): Promise<string>;
	/**
	 * Get headers for HTTP request
	 * Use getHeadersAsync() for complete headers with boundary
	 */
	getHeaders(): Record<string, string>;
	/**
	 * Get headers asynchronously with proper Content-Type and boundary
	 */
	getHeadersAsync(): Promise<Record<string, string>>;
	/**
	 * Get length synchronously - returns cached value if available
	 * Use getLength() for guaranteed result
	 */
	getLengthSync(): number | undefined;
	/**
	 * Get length asynchronously (works in all environments)
	 */
	getLength(): Promise<number>;
	/**
	 * Get buffer synchronously - returns cached value if available
	 * Use toBuffer() for guaranteed result
	 * @warning Only works in Node.js/Bun/Deno. Returns null in browser/React Native.
	 */
	getBuffer(): Buffer | null;
	/**
	 * Convert to Buffer asynchronously
	 * @warning Only works in Node.js/Bun/Deno. Use toArrayBuffer() for browser/React Native.
	 */
	toBuffer(): Promise<Buffer>;
	/**
	 * Convert to ArrayBuffer asynchronously (works in all environments)
	 */
	toArrayBuffer(): Promise<ArrayBuffer>;
	/**
	 * Convert to Uint8Array asynchronously (works in all environments)
	 */
	toUint8Array(): Promise<Uint8Array>;
	/**
	 * Create RezoFormData from object.
	 * By default, nested objects/arrays are JSON-encoded as string values.
	 * Pass `nestedKeys: true` to flatten with bracket notation instead.
	 */
	static fromObject(obj: Record<string, unknown>, options?: {
		nestedKeys?: boolean;
	}): RezoFormData;
	/**
	 * Create a URL-encoded string from a plain object (application/x-www-form-urlencoded).
	 * Spaces are encoded as `+`, suitable for form POST bodies.
	 */
	static createUrlEncoded(data: Record<string, string | number | boolean>): string;
	/**
	 * Create RezoFormData from native FormData
	 */
	static fromNativeFormData(formData: FormData): RezoFormData;
	/**
	 * Convert to URL query string (only string values, binary data omitted)
	 */
	toUrlQueryString(): string;
	/**
	 * Convert to URLSearchParams (only string values, binary data omitted)
	 */
	toURLSearchParams(): URLSearchParams;
}
/**
 * Emitted when request is initiated
 * Contains basic request configuration without sensitive data
 */
export interface RequestStartEvent {
	/** Target URL */
	url: string;
	/** HTTP method */
	method: string;
	/** Request headers being sent */
	headers: RezoHeaders;
	/** Timestamp when request started (performance.now()) */
	timestamp: number;
	/** Request timeout in milliseconds */
	timeout?: number;
	/** Maximum redirects allowed */
	maxRedirects?: number;
	/** Retry configuration */
	retry?: {
		maxRetries?: number;
		delay?: number;
		backoff?: number;
	};
}
/**
 * Emitted when response headers are received (first byte)
 * Provides response metadata before body is processed
 */
export interface ResponseHeadersEvent {
	/** HTTP status code */
	status: number;
	/** HTTP status text */
	statusText: string;
	/** Response headers */
	headers: RezoHeaders;
	/** Content-Type header value */
	contentType?: string;
	/** Content-Length header value (bytes) */
	contentLength?: number;
	/** Cookies from Set-Cookie headers */
	cookies?: Cookie[];
	/** Timing information */
	timing: {
		/** Time to first byte (TTFB) in milliseconds */
		firstByte: number;
		/** Total time elapsed so far in milliseconds */
		total: number;
	};
}
/**
 * Emitted AFTER a redirect is followed
 * Provides complete redirect information
 */
export interface RedirectEvent {
	/** Source URL (where we're redirecting FROM) */
	sourceUrl: string;
	/** Source HTTP status code */
	sourceStatus: number;
	/** Source HTTP status text */
	sourceStatusText: string;
	/** Destination URL (where we're redirecting TO) */
	destinationUrl: string;
	/** Number of redirects followed so far */
	redirectCount: number;
	/** Maximum redirects allowed */
	maxRedirects: number;
	/** Response headers from redirect response */
	headers: RezoHeaders;
	/** Cookies from redirect response */
	cookies: Cookie[];
	/** HTTP method used for the redirect */
	method: string;
	/** Timestamp when redirect occurred */
	timestamp: number;
	/** Duration of this redirect in milliseconds */
	duration: number;
}
interface ProgressEvent$1 {
	/** Bytes transferred so far */
	loaded: number;
	/** Total bytes (from Content-Length or file size) */
	total: number;
	/** Progress percentage (0-100) */
	percentage: number;
	/** Current transfer speed in bytes/second */
	speed: number;
	/** Average transfer speed in bytes/second */
	averageSpeed: number;
	/** Estimated time remaining in milliseconds */
	estimatedTime: number;
	/** Timestamp of this progress update */
	timestamp: number;
}
/**
 * Emitted when StreamResponse completes
 * Body has already been emitted via 'data' events
 */
export interface StreamFinishEvent {
	/** HTTP status code */
	status: number;
	/** HTTP status text */
	statusText: string;
	/** Response headers */
	headers: RezoHeaders;
	/** Content-Type header value */
	contentType?: string;
	/** Content-Length (bytes received) */
	contentLength: number;
	/** Final URL after redirects */
	finalUrl: string;
	/** Cookies received */
	cookies: Cookies;
	/** All URLs traversed (includes redirects) */
	urls: string[];
	/** Timing breakdown */
	timing: {
		/** Total request time in milliseconds */
		total: number;
		/** DNS lookup time in milliseconds */
		dns?: number;
		/** TCP connection time in milliseconds */
		tcp?: number;
		/** TLS handshake time in milliseconds */
		tls?: number;
		/** Time to first byte in milliseconds */
		firstByte?: number;
		/** Content download time in milliseconds */
		download?: number;
	};
	/** Response configuration (execution metadata) */
	config: SanitizedRezoConfig;
}
/**
 * Emitted when DownloadResponse completes
 * Body has been saved to file
 */
export interface DownloadFinishEvent {
	/** HTTP status code */
	status: number;
	/** HTTP status text */
	statusText: string;
	/** Response headers */
	headers: RezoHeaders;
	/** Content-Type header value */
	contentType?: string;
	/** Content-Length (bytes downloaded) */
	contentLength: number;
	/** Final URL after redirects */
	finalUrl: string;
	/** Cookies received */
	cookies: Cookies;
	/** All URLs traversed (includes redirects) */
	urls: string[];
	/**
	 * File name (supports both basename and fullname)
	 * - For fileName: 'report.pdf' → returns 'report.pdf'
	 * - For saveTo: '/path/to/report.pdf' → returns '/path/to/report.pdf'
	 */
	fileName: string;
	/** File size in bytes */
	fileSize: number;
	/** Timing breakdown */
	timing: {
		/** Total request time in milliseconds */
		total: number;
		/** DNS lookup time in milliseconds */
		dns?: number;
		/** TCP connection time in milliseconds */
		tcp?: number;
		/** TLS handshake time in milliseconds */
		tls?: number;
		/** Time to first byte in milliseconds */
		firstByte?: number;
		/** Download duration in milliseconds */
		download: number;
	};
	/** Average download speed in bytes/second */
	averageSpeed: number;
	/** Response configuration (execution metadata) */
	config: SanitizedRezoConfig;
}
/**
 * Emitted when UploadResponse completes
 * Includes server's response body
 */
export interface UploadFinishEvent {
	/** Server's response to our upload */
	response: {
		/** HTTP status code */
		status: number;
		/** HTTP status text */
		statusText: string;
		/** Response headers */
		headers: RezoHeaders;
		/** Response body from server */
		data: any;
		/** Content-Type header value */
		contentType?: string;
		/** Response content length */
		contentLength?: number;
	};
	/** Final URL after redirects */
	finalUrl: string;
	/** Cookies received */
	cookies: Cookies;
	/** All URLs traversed (includes redirects) */
	urls: string[];
	/** Upload size in bytes */
	uploadSize: number;
	/** File name if uploading a file */
	fileName?: string;
	/** Timing breakdown */
	timing: {
		/** Total request time in milliseconds */
		total: number;
		/** DNS lookup time in milliseconds */
		dns?: number;
		/** TCP connection time in milliseconds */
		tcp?: number;
		/** TLS handshake time in milliseconds */
		tls?: number;
		/** Upload duration in milliseconds */
		upload: number;
		/** Time waiting for server response in milliseconds */
		waiting: number;
		/** Response download time in milliseconds */
		download?: number;
	};
	/** Average upload speed in bytes/second */
	averageUploadSpeed: number;
	/** Average download speed in bytes/second (for response) */
	averageDownloadSpeed?: number;
	/** Response configuration (execution metadata) */
	config: SanitizedRezoConfig;
}
/**
 * Sanitized RezoConfig for event emission
 * Excludes only request body/data, includes all metadata
 */
export type SanitizedRezoConfig = Omit<RezoConfig, "data"> & {
	/** Data field explicitly removed */
	data?: never;
};
/**
 * Standard RezoResponse for non-streaming requests
 * Contains response data, status, headers, cookies, and execution metadata
 */
export interface RezoResponse<T = any> {
	data: T;
	status: number;
	statusText: string;
	finalUrl: string;
	cookies: Cookies;
	headers: RezoHeaders;
	contentType: string | undefined;
	contentLength: number;
	urls: string[];
	config: RezoConfig;
}
/**
 * Platform-agnostic base interface for event-emitting responses
 * Can be implemented by both Node.js EventEmitter and browser-safe implementations
 */
export interface BaseEventEmitter {
	on(event: string | symbol, listener: (...args: any[]) => void): this;
	once(event: string | symbol, listener: (...args: any[]) => void): this;
	off(event: string | symbol, listener: (...args: any[]) => void): this;
	emit(event: string | symbol, ...args: any[]): boolean;
	removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
	removeAllListeners(event?: string | symbol): this;
	addListener(event: string | symbol, listener: (...args: any[]) => void): this;
}
/**
 * RezoStreamResponse - For responseType: 'stream'
 * Platform-agnostic interface for streaming responses
 * Emits 'data' events for response body chunks
 */
export interface RezoStreamResponse extends BaseEventEmitter {
	/** Pipe stream data to a writable destination (file stream, stdout, etc.) */
	pipe<T extends NodeJS.WritableStream>(destination: T, options?: {
		end?: boolean;
	}): T;
	/** Pipe stream data to a file path (creates directories automatically) */
	pipeTo(filePath: string): this;
	on(event: "data", listener: (chunk: Uint8Array | string) => void): this;
	on(event: "error", listener: (err: RezoError) => void): this;
	on(event: "finish", listener: (info: StreamFinishEvent) => void): this;
	on(event: "done", listener: (info: StreamFinishEvent) => void): this;
	on(event: "start", listener: (info: RequestStartEvent) => void): this;
	on(event: "initiated", listener: () => void): this;
	on(event: "headers", listener: (info: ResponseHeadersEvent) => void): this;
	on(event: "cookies", listener: (cookies: Cookie[]) => void): this;
	on(event: "status", listener: (status: number, statusText: string) => void): this;
	on(event: "redirect", listener: (info: RedirectEvent) => void): this;
	on(event: "progress", listener: (progress: ProgressEvent$1) => void): this;
	on(event: string | symbol, listener: (...args: any[]) => void): this;
	once(event: "data", listener: (chunk: Uint8Array | string) => void): this;
	once(event: "error", listener: (err: RezoError) => void): this;
	once(event: "finish", listener: (info: StreamFinishEvent) => void): this;
	once(event: "done", listener: (info: StreamFinishEvent) => void): this;
	once(event: "start", listener: (info: RequestStartEvent) => void): this;
	once(event: "initiated", listener: () => void): this;
	once(event: "headers", listener: (info: ResponseHeadersEvent) => void): this;
	once(event: "cookies", listener: (cookies: Cookie[]) => void): this;
	once(event: "status", listener: (status: number, statusText: string) => void): this;
	once(event: "redirect", listener: (info: RedirectEvent) => void): this;
	once(event: "progress", listener: (progress: ProgressEvent$1) => void): this;
	once(event: string | symbol, listener: (...args: any[]) => void): this;
	isFinished(): boolean;
	setEncoding?(encoding: string): this;
	getEncoding?(): string | undefined;
}
/**
 * RezoDownloadResponse - For fileName/saveTo options
 * Platform-agnostic interface for file downloads
 * Streams response body directly to file
 */
export interface RezoDownloadResponse extends BaseEventEmitter {
	fileName: string;
	url: string;
	status?: number;
	statusText?: string;
	on(event: "error", listener: (err: RezoError) => void): this;
	on(event: "finish", listener: (info: DownloadFinishEvent) => void): this;
	on(event: "done", listener: (info: DownloadFinishEvent) => void): this;
	on(event: "start", listener: (info: RequestStartEvent) => void): this;
	on(event: "initiated", listener: () => void): this;
	on(event: "headers", listener: (info: ResponseHeadersEvent) => void): this;
	on(event: "cookies", listener: (cookies: Cookie[]) => void): this;
	on(event: "status", listener: (status: number, statusText: string) => void): this;
	on(event: "redirect", listener: (info: RedirectEvent) => void): this;
	on(event: "progress", listener: (progress: ProgressEvent$1) => void): this;
	on(event: string | symbol, listener: (...args: any[]) => void): this;
	once(event: "error", listener: (err: RezoError) => void): this;
	once(event: "finish", listener: (info: DownloadFinishEvent) => void): this;
	once(event: "done", listener: (info: DownloadFinishEvent) => void): this;
	once(event: "start", listener: (info: RequestStartEvent) => void): this;
	once(event: "initiated", listener: () => void): this;
	once(event: "headers", listener: (info: ResponseHeadersEvent) => void): this;
	once(event: "cookies", listener: (cookies: Cookie[]) => void): this;
	once(event: "status", listener: (status: number, statusText: string) => void): this;
	once(event: "redirect", listener: (info: RedirectEvent) => void): this;
	once(event: "progress", listener: (progress: ProgressEvent$1) => void): this;
	once(event: string | symbol, listener: (...args: any[]) => void): this;
	isFinished(): boolean;
}
/**
 * RezoUploadResponse - For responseType: 'upload'
 * Platform-agnostic interface for file uploads
 * Tracks upload progress and includes server response body
 */
export interface RezoUploadResponse extends BaseEventEmitter {
	url: string;
	fileName?: string;
	status?: number;
	statusText?: string;
	on(event: "error", listener: (err: RezoError) => void): this;
	on(event: "finish", listener: (info: UploadFinishEvent) => void): this;
	on(event: "done", listener: (info: UploadFinishEvent) => void): this;
	on(event: "start", listener: (info: RequestStartEvent) => void): this;
	on(event: "initiated", listener: () => void): this;
	on(event: "headers", listener: (info: ResponseHeadersEvent) => void): this;
	on(event: "cookies", listener: (cookies: Cookie[]) => void): this;
	on(event: "status", listener: (status: number, statusText: string) => void): this;
	on(event: "redirect", listener: (info: RedirectEvent) => void): this;
	on(event: "progress", listener: (progress: ProgressEvent$1) => void): this;
	on(event: string | symbol, listener: (...args: any[]) => void): this;
	once(event: "error", listener: (err: RezoError) => void): this;
	once(event: "finish", listener: (info: UploadFinishEvent) => void): this;
	once(event: "done", listener: (info: UploadFinishEvent) => void): this;
	once(event: "start", listener: (info: RequestStartEvent) => void): this;
	once(event: "initiated", listener: () => void): this;
	once(event: "headers", listener: (info: ResponseHeadersEvent) => void): this;
	once(event: "cookies", listener: (cookies: Cookie[]) => void): this;
	once(event: "status", listener: (status: number, statusText: string) => void): this;
	once(event: "redirect", listener: (info: RedirectEvent) => void): this;
	once(event: "progress", listener: (progress: ProgressEvent$1) => void): this;
	once(event: string | symbol, listener: (...args: any[]) => void): this;
	isFinished(): boolean;
}
/**
 * Rezo ProxyManager Types
 * Type definitions for advanced proxy rotation and management
 *
 * @module proxy/types
 * @author Yuniq Solutions Team
 * @version 1.0.0
 */
/** Supported proxy protocols */
export type ProxyProtocol = "socks4" | "socks5" | "http" | "https";
/**
 * Proxy information structure
 * Represents a single proxy server with its connection details
 */
export interface ProxyInfo {
	/** Unique identifier for the proxy (auto-generated if not provided) */
	id?: string;
	/** The proxy protocol to use */
	protocol: ProxyProtocol;
	/** Proxy server hostname or IP address */
	host: string;
	/** Proxy server port number */
	port: number;
	/** Optional authentication credentials for the proxy */
	auth?: {
		/** Username for proxy authentication */
		username: string;
		/** Password for proxy authentication */
		password: string;
	};
	/** Optional label for identification/logging */
	label?: string;
	/** Optional metadata for custom tracking */
	metadata?: Record<string, unknown>;
}
/**
 * Proxy rotation strategies
 * - `random`: Select a random proxy from the pool for each request
 * - `sequential`: Use proxies in order, optionally rotating after N requests
 * - `per-proxy-limit`: Use each proxy for a maximum number of requests, then permanently remove
 */
export type RotationStrategy = "random" | "sequential" | "per-proxy-limit";
/**
 * Rotation configuration for different strategies
 */
export type RotationConfig = {
	/** Random selection from available proxies */
	rotation: "random";
} | {
	/** Sequential rotation through proxy list */
	rotation: "sequential";
	/** Number of requests before rotating to next proxy (default: 1) */
	requestsPerProxy?: number;
} | {
	/** Use each proxy for a limited number of total requests, then remove */
	rotation: "per-proxy-limit";
	/** Maximum requests per proxy before permanent removal */
	limit: number;
};
/**
 * Cooldown configuration for disabled proxies
 */
export interface ProxyCooldownConfig {
	/** Whether to enable automatic re-enabling after cooldown */
	enabled: boolean;
	/** Duration in milliseconds before re-enabling a disabled proxy */
	durationMs: number;
}
/**
 * Base proxy manager configuration (without rotation)
 * Complete configuration for proxy rotation, filtering, and failure handling
 */
export interface ProxyManagerBaseConfig {
	/**
	 * Array of proxies to manage
	 * Accepts ProxyInfo objects or proxy URL strings (parsed via parseProxyString)
	 * @example
	 * proxies: [
	 *   { protocol: 'http', host: '127.0.0.1', port: 8080 },
	 *   'socks5://user:pass@proxy.example.com:1080',
	 *   'http://proxy.example.com:3128'
	 * ]
	 */
	proxies: (ProxyInfo | string)[];
	/**
	 * Whitelist patterns for URLs that should use proxy
	 * - String: exact domain match (e.g., 'api.example.com') or subdomain match (e.g., 'example.com' matches '*.example.com')
	 * - RegExp: regex pattern to test against full URL
	 * If not set, all URLs use proxy
	 */
	whitelist?: (string | RegExp)[];
	/**
	 * Blacklist patterns for URLs that should NOT use proxy (go direct)
	 * - String: exact domain match or subdomain match
	 * - RegExp: regex pattern to test against full URL
	 * Blacklist is checked after whitelist
	 */
	blacklist?: (string | RegExp)[];
	/**
	 * Automatically disable proxies after consecutive failures
	 * @default false
	 */
	autoDisableDeadProxies?: boolean;
	/**
	 * Number of consecutive failures before disabling a proxy
	 * Only applies when autoDisableDeadProxies is true
	 * @default 3
	 */
	maxFailures?: number;
	/**
	 * Cooldown configuration for disabled proxies
	 * If not set or enabled: false, proxies are permanently removed when disabled
	 */
	cooldown?: ProxyCooldownConfig;
	/**
	 * Shorthand for cooldown duration in milliseconds
	 * Equivalent to: cooldown: { enabled: true, durationMs: cooldownPeriod }
	 */
	cooldownPeriod?: number;
	/**
	 * Whether to throw error when no proxy is available
	 * - true (default): Throw RezoError when no proxies available
	 * - false: Proceed with direct connection (no proxy)
	 * @default true
	 */
	failWithoutProxy?: boolean;
	/**
	 * Whether to retry the request with next proxy on failure
	 * @default false
	 */
	retryWithNextProxy?: boolean;
	/**
	 * Maximum retry attempts when retryWithNextProxy is enabled
	 * @default 3
	 */
	maxProxyRetries?: number;
	/**
	 * Enable debug logging for hook errors and internal warnings
	 * @default false
	 */
	debug?: boolean;
	/**
	 * Event hooks for proxy lifecycle events
	 * Alternative to setting hooks after construction
	 */
	hooks?: {
		beforeProxySelect?: ((context: BeforeProxySelectContext) => ProxyInfo | void)[];
		afterProxySelect?: ((context: AfterProxySelectContext) => void | Promise<void>)[];
		beforeProxyError?: ((context: BeforeProxyErrorContext) => void | Promise<void>)[];
		afterProxyError?: ((context: AfterProxyErrorContext) => void | Promise<void>)[];
		beforeProxyDisable?: ((context: BeforeProxyDisableContext) => boolean | void)[];
		afterProxyDisable?: ((context: AfterProxyDisableContext) => void | Promise<void>)[];
		afterProxyRotate?: ((context: AfterProxyRotateContext) => void | Promise<void>)[];
		afterProxyEnable?: ((context: AfterProxyEnableContext) => void | Promise<void>)[];
		afterProxySuccess?: ((context: AfterProxySuccessContext) => void | Promise<void>)[];
		onNoProxiesAvailable?: ((context: OnNoProxiesAvailableContext) => void | Promise<void>)[];
	};
}
/**
 * Full proxy manager configuration
 * Combines base config with rotation strategy
 */
export type ProxyManagerConfig = ProxyManagerBaseConfig & RotationConfig;
/**
 * Internal proxy state tracking
 * Used internally by ProxyManager to track usage and failures
 */
export interface ProxyState {
	/** The proxy info */
	proxy: ProxyInfo;
	/** Number of requests made through this proxy */
	requestCount: number;
	/** Number of consecutive failures */
	failureCount: number;
	/** Total number of successful requests */
	successCount: number;
	/** Total number of failed requests */
	totalFailures: number;
	/** Whether the proxy is currently active */
	isActive: boolean;
	/** Reason for being disabled (if applicable) */
	disabledReason?: "dead" | "limit-reached" | "manual";
	/** Timestamp when proxy was disabled */
	disabledAt?: number;
	/** Timestamp when proxy will be re-enabled (if cooldown enabled) */
	reenableAt?: number;
	/** Last successful request timestamp */
	lastSuccessAt?: number;
	/** Last failure timestamp */
	lastFailureAt?: number;
	/** Last error message */
	lastError?: string;
}
/**
 * Proxy manager status snapshot
 * Provides overview of all proxies in the manager
 */
export interface ProxyManagerStatus {
	/** Active proxies available for use */
	active: ProxyInfo[];
	/** Disabled proxies (dead or limit reached) */
	disabled: ProxyInfo[];
	/** Proxies in cooldown waiting to be re-enabled */
	cooldown: ProxyInfo[];
	/** Total number of proxies */
	total: number;
	/** Current rotation strategy */
	rotation: RotationStrategy;
	/** Total requests made through the manager */
	totalRequests: number;
	/** Total successful requests */
	totalSuccesses: number;
	/** Total failed requests */
	totalFailures: number;
}
/**
 * Result from proxy selection
 */
export interface ProxySelectionResult {
	/** Selected proxy (null if should go direct) */
	proxy: ProxyInfo | null;
	/** Reason for selection result */
	reason: "selected" | "whitelist-no-match" | "blacklist-match" | "no-proxies-available" | "disabled";
}
/**
 * Context for beforeProxySelect hook
 */
export interface BeforeProxySelectContext {
	/** Request URL */
	url: string;
	/** Available active proxies */
	proxies: ProxyInfo[];
	/** Whether this is a retry attempt */
	isRetry: boolean;
	/** Retry count (0 for initial request) */
	retryCount: number;
}
/**
 * Context for afterProxySelect hook
 */
export interface AfterProxySelectContext {
	/** Request URL */
	url: string;
	/** Selected proxy (null if going direct) */
	proxy: ProxyInfo | null;
	/** Selection reason */
	reason: ProxySelectionResult["reason"];
}
/**
 * Context for beforeProxyError hook
 */
export interface BeforeProxyErrorContext {
	/** The proxy that failed */
	proxy: ProxyInfo;
	/** The error that occurred */
	error: Error;
	/** Request URL */
	url: string;
	/** Current failure count for this proxy */
	failureCount: number;
	/** Whether proxy will be disabled after this error */
	willBeDisabled: boolean;
}
/**
 * Context for afterProxyError hook
 */
export interface AfterProxyErrorContext {
	/** The proxy that failed */
	proxy: ProxyInfo;
	/** The error that occurred */
	error: Error;
	/** Action taken after error */
	action: "retry-next-proxy" | "disabled" | "continue";
	/** Next proxy for retry (if action is 'retry-next-proxy') */
	nextProxy?: ProxyInfo;
}
/**
 * Context for beforeProxyDisable hook
 * Return false to prevent disabling
 */
export interface BeforeProxyDisableContext {
	/** The proxy about to be disabled */
	proxy: ProxyInfo;
	/** Reason for disabling */
	reason: "dead" | "limit-reached" | "manual";
	/** Current proxy state */
	state: ProxyState;
}
/**
 * Context for afterProxyDisable hook
 */
export interface AfterProxyDisableContext {
	/** The proxy that was disabled */
	proxy: ProxyInfo;
	/** Reason for disabling */
	reason: "dead" | "limit-reached" | "manual";
	/** Whether cooldown is enabled for re-enabling */
	hasCooldown: boolean;
	/** Timestamp when proxy will be re-enabled (if cooldown enabled) */
	reenableAt?: number;
}
/**
 * Context for afterProxyRotate hook
 */
export interface AfterProxyRotateContext {
	/** Previous proxy (null if first selection) */
	from: ProxyInfo | null;
	/** New proxy */
	to: ProxyInfo;
	/** Reason for rotation */
	reason: "scheduled" | "failure" | "limit-reached";
}
/**
 * Context for afterProxyEnable hook
 */
export interface AfterProxyEnableContext {
	/** The proxy that was enabled */
	proxy: ProxyInfo;
	/** Reason for enabling */
	reason: "cooldown-expired" | "manual";
}
/**
 * Context for afterProxySuccess hook
 * Triggered when a request succeeds through a proxy
 */
export interface AfterProxySuccessContext {
	/** The proxy that succeeded */
	proxy: ProxyInfo;
	/** Current proxy state after success */
	state: ProxyState;
}
/**
 * Context for onNoProxiesAvailable hook
 * Triggered when no proxies are available and an error would be thrown
 */
export interface OnNoProxiesAvailableContext {
	/** Request URL that needed a proxy */
	url: string;
	/** The error that will be thrown */
	error: Error;
	/** All proxies (including disabled ones) */
	allProxies: ProxyState[];
	/** Number of active proxies (should be 0) */
	activeCount: number;
	/** Number of disabled proxies */
	disabledCount: number;
	/** Number of proxies in cooldown */
	cooldownCount: number;
	/** Reasons why proxies are unavailable */
	disabledReasons: {
		/** Proxies disabled due to failures */
		dead: number;
		/** Proxies disabled due to request limit */
		limitReached: number;
		/** Proxies manually disabled */
		manual: number;
	};
	/** Timestamp when this event occurred */
	timestamp: number;
}
/**
 * Context provided to beforeRequest hook
 * Contains metadata about the current request state
 */
export interface BeforeRequestContext {
	/** Current retry count (0 for initial request, 1+ for retries) */
	retryCount: number;
	/** Whether this is a redirect follow-up request */
	isRedirect: boolean;
	/** Number of redirects followed so far */
	redirectCount: number;
	/** Timestamp when request processing started */
	startTime: number;
}
/**
 * Context provided to afterResponse hook
 * Includes retry capability for token refresh scenarios
 */
export interface AfterResponseContext {
	/** Current retry count */
	retryCount: number;
	/** Function to retry request with merged options */
	retryWithMergedOptions: (options: Partial<RezoRequestConfig>) => never;
}
/**
 * DNS resolution event data
 */
export interface DnsLookupEvent {
	/** Hostname being resolved */
	hostname: string;
	/** Resolved IP address */
	address: string;
	/** Address family (4 for IPv4, 6 for IPv6) */
	family: 4 | 6;
	/** DNS lookup duration in milliseconds */
	duration: number;
	/** Timestamp when lookup completed */
	timestamp: number;
}
/**
 * TLS handshake event data
 */
export interface TlsHandshakeEvent {
	/** TLS protocol version (TLSv1.2, TLSv1.3, etc.) */
	protocol: string;
	/** Cipher suite used */
	cipher: string;
	/** Whether certificate is authorized */
	authorized: boolean;
	/** Authorization error if any */
	authorizationError?: string;
	/** Server certificate info */
	certificate?: {
		subject: string;
		issuer: string;
		validFrom: string;
		validTo: string;
		fingerprint: string;
	};
	/** Handshake duration in milliseconds */
	duration: number;
	/** Timestamp when handshake completed */
	timestamp: number;
}
/**
 * Socket event data
 */
export interface SocketEvent {
	/** Event type */
	type: "connect" | "close" | "drain" | "error" | "timeout" | "end";
	/** Local address */
	localAddress?: string;
	/** Local port */
	localPort?: number;
	/** Remote address */
	remoteAddress?: string;
	/** Remote port */
	remotePort?: number;
	/** Bytes written */
	bytesWritten?: number;
	/** Bytes read */
	bytesRead?: number;
	/** Error if applicable */
	error?: Error;
	/** Timestamp */
	timestamp: number;
}
/**
 * Timeout event data
 */
export interface TimeoutEvent {
	/** Type of timeout */
	type: "connect" | "request" | "response" | "socket" | "lookup";
	/** Configured timeout value in milliseconds */
	timeout: number;
	/** Elapsed time before timeout in milliseconds */
	elapsed: number;
	/** URL being requested */
	url: string;
	/** Timestamp when timeout occurred */
	timestamp: number;
}
/**
 * Abort event data
 */
export interface AbortEvent {
	/** Reason for abort */
	reason: "user" | "timeout" | "signal" | "error";
	/** Abort message */
	message?: string;
	/** URL being requested */
	url: string;
	/** Elapsed time before abort in milliseconds */
	elapsed: number;
	/** Timestamp when abort occurred */
	timestamp: number;
}
/**
 * Headers received event data (before body)
 */
export interface HeadersReceivedEvent {
	/** HTTP status code */
	status: number;
	/** HTTP status text */
	statusText: string;
	/** Response headers */
	headers: RezoHeaders;
	/** Content-Type header */
	contentType?: string;
	/** Content-Length header */
	contentLength?: number;
	/** Time to first byte in milliseconds */
	ttfb: number;
	/** Timestamp */
	timestamp: number;
}
/**
 * Parse complete event data
 */
export interface ParseCompleteEvent<T = any> {
	/** Parsed data */
	data: T;
	/** Original raw data before parsing */
	rawData: string | Buffer;
	/** Content-Type that triggered parsing */
	contentType: string;
	/** Parse duration in milliseconds */
	parseDuration: number;
	/** Timestamp */
	timestamp: number;
}
/**
 * Cache event data
 */
export interface CacheEvent {
	/** HTTP status code */
	status: number;
	/** Response headers */
	headers: RezoHeaders;
	/** URL being cached */
	url: string;
	/** Cache key if applicable */
	cacheKey?: string;
	/** Whether response is cacheable by default */
	isCacheable: boolean;
	/** Cache-Control header parsed */
	cacheControl?: {
		maxAge?: number;
		sMaxAge?: number;
		noCache?: boolean;
		noStore?: boolean;
		mustRevalidate?: boolean;
		private?: boolean;
		public?: boolean;
	};
}
/**
 * Cookie event data
 */
export interface CookieEvent {
	/** Cookie being set/processed */
	cookie: Cookie;
	/** Source of cookie (response header, manual set, etc.) */
	source: "response" | "request" | "manual";
	/** URL context */
	url: string;
	/** Whether cookie is valid */
	isValid: boolean;
	/** Validation errors if any */
	validationErrors?: string[];
}
/**
 * Hook called during options initialization
 * Use to normalize or validate request options
 * Must be synchronous
 */
export type InitHook = (plainOptions: Partial<RezoRequestConfig>, options: RezoRequestConfig) => void;
/**
 * Hook called before request is sent
 * Use to modify config, add headers, sign requests
 * Can return early with a Response to bypass actual request
 */
export type BeforeRequestHook = (config: RezoConfig, context: BeforeRequestContext) => void | Response | Promise<void | Response>;
/**
 * Context provided to beforeRedirect hook
 * Contains full request and redirect details
 */
export interface BeforeRedirectContext {
	/** The URL being redirected to */
	redirectUrl: URL;
	/** The URL being redirected from */
	fromUrl: string;
	/** HTTP status code that triggered the redirect (301, 302, 303, 307, 308) */
	status: number;
	/** Response headers from the redirect response */
	headers: RezoHeaders;
	/** Whether the redirect stays on the same domain */
	sameDomain: boolean;
	/** HTTP method of the current request */
	method: string;
	/** The original request body */
	body?: any;
	/** The full request configuration */
	request: RezoRequestConfig;
	/** Number of redirects followed so far */
	redirectCount: number;
	/** Timestamp */
	timestamp: number;
}
/**
 * Hook called before following a redirect
 * Use to inspect/modify redirect behavior
 */
export type BeforeRedirectHook = (context: BeforeRedirectContext, config: RezoConfig, response: RezoResponse) => void | Promise<void>;
/**
 * Hook called before a retry attempt
 * Use for custom backoff logic, logging
 */
export type BeforeRetryHook = (config: RezoConfig, error: RezoError, retryCount: number) => void | Promise<void>;
/**
 * Hook called after response is received
 * Use to transform response, refresh tokens
 * Can trigger retry via context.retryWithMergedOptions
 * Return modified response or original
 */
export type AfterResponseHook<T = any> = (response: RezoResponse<T>, config: RezoConfig, context: AfterResponseContext) => RezoResponse<T> | Promise<RezoResponse<T>>;
/**
 * Hook called before error is thrown
 * Use to transform errors, add context
 * Can return custom Error subclasses
 */
export type BeforeErrorHook = (error: RezoError | Error) => RezoError | Error | Promise<RezoError | Error>;
/**
 * Hook called before caching a response
 * Return false to prevent caching
 * Can modify response headers to affect caching behavior
 */
export type BeforeCacheHook = (event: CacheEvent) => boolean | void;
/**
 * Hook called when response headers are received (before body)
 * Use to inspect headers, abort early, prepare for response
 */
export type AfterHeadersHook = (event: HeadersReceivedEvent, config: RezoConfig) => void | Promise<void>;
/**
 * Hook called after response body is parsed
 * Use to transform parsed data, validate response
 */
export type AfterParseHook<T = any> = (event: ParseCompleteEvent<T>, config: RezoConfig) => T | Promise<T>;
/**
 * Hook called before a cookie is set
 * Return false to reject the cookie
 * Can modify cookie properties
 */
export type BeforeCookieHook = (event: CookieEvent, config: RezoConfig) => boolean | void | Promise<boolean | void>;
/**
 * Hook called after cookies are processed
 * Use for cookie logging, analytics
 */
export type AfterCookieHook = (cookies: Cookie[], config: RezoConfig) => void | Promise<void>;
/**
 * Hook called on socket events
 * Use for connection monitoring, metrics
 */
export type OnSocketHook = (event: SocketEvent, socket: Socket | TLSSocket) => void;
/**
 * Hook called when DNS lookup completes
 * Use for DNS caching, logging, analytics
 */
export type OnDnsHook = (event: DnsLookupEvent, config: RezoConfig) => void;
/**
 * Hook called when TLS handshake completes
 * Use for certificate validation, security logging
 */
export type OnTlsHook = (event: TlsHandshakeEvent, config: RezoConfig) => void;
/**
 * Hook called when timeout occurs
 * Use for timeout logging, retry decisions
 */
export type OnTimeoutHook = (event: TimeoutEvent, config: RezoConfig) => void;
/**
 * Hook called when request is aborted
 * Use for cleanup, logging
 */
export type OnAbortHook = (event: AbortEvent, config: RezoConfig) => void;
/**
 * Rate limit wait event data - fired when waiting due to rate limiting
 */
export interface RateLimitWaitEvent {
	/** HTTP status code that triggered the wait (e.g., 429, 503) */
	status: number;
	/** Time to wait in milliseconds */
	waitTime: number;
	/** Current wait attempt number (1-indexed) */
	attempt: number;
	/** Maximum wait attempts configured */
	maxAttempts: number;
	/** Where the wait time was extracted from */
	source: "header" | "body" | "function" | "default";
	/** The header or body path used (if applicable) */
	sourcePath?: string;
	/** URL being requested */
	url: string;
	/** HTTP method of the request */
	method: string;
	/** Timestamp when the wait started */
	timestamp: number;
}
/**
 * Hook called when rate limit wait occurs
 * Informational only - cannot abort the wait
 * Use for logging, monitoring, alerting
 */
export type OnRateLimitWaitHook = (event: RateLimitWaitEvent, config: RezoConfig) => void | Promise<void>;
/**
 * Hook called before a proxy is selected
 * Can return a specific proxy to override selection
 */
export type BeforeProxySelectHook = (context: BeforeProxySelectContext) => ProxyInfo | void | Promise<ProxyInfo | void>;
/**
 * Hook called after a proxy is selected
 * Use for logging, analytics
 */
export type AfterProxySelectHook = (context: AfterProxySelectContext) => void | Promise<void>;
/**
 * Hook called before a proxy error is processed
 * Use for error inspection, custom handling
 */
export type BeforeProxyErrorHook = (context: BeforeProxyErrorContext) => void | Promise<void>;
/**
 * Hook called after a proxy error is processed
 * Use for error logging, fallback logic
 */
export type AfterProxyErrorHook = (context: AfterProxyErrorContext) => void | Promise<void>;
/**
 * Hook called before a proxy is disabled
 * Return false to prevent disabling
 */
export type BeforeProxyDisableHook = (context: BeforeProxyDisableContext) => boolean | void | Promise<boolean | void>;
/**
 * Hook called after a proxy is disabled
 * Use for notifications, logging
 */
export type AfterProxyDisableHook = (context: AfterProxyDisableContext) => void | Promise<void>;
/**
 * Hook called when proxy rotation occurs
 * Use for monitoring rotation patterns
 */
export type AfterProxyRotateHook = (context: AfterProxyRotateContext) => void | Promise<void>;
/**
 * Hook called when a proxy is re-enabled
 * Use for notifications, logging
 */
export type AfterProxyEnableHook = (context: AfterProxyEnableContext) => void | Promise<void>;
/**
 * Hook called when no proxies are available and an error is about to be thrown
 * Use for alerting, logging exhausted proxy pools, or triggering proxy refresh
 * This hook is called just before the error is thrown, allowing you to:
 * - Log the exhaustion event for monitoring
 * - Trigger external proxy pool refresh
 * - Send alerts to monitoring systems
 * - Record statistics about proxy pool health
 */
export type OnNoProxiesAvailableHook = (context: OnNoProxiesAvailableContext) => void | Promise<void>;
/**
 * Collection of all hook types
 * All hooks are arrays to allow multiple handlers
 */
export interface RezoHooks {
	init: InitHook[];
	beforeRequest: BeforeRequestHook[];
	beforeRedirect: BeforeRedirectHook[];
	beforeRetry: BeforeRetryHook[];
	afterResponse: AfterResponseHook[];
	beforeError: BeforeErrorHook[];
	beforeCache: BeforeCacheHook[];
	afterHeaders: AfterHeadersHook[];
	afterParse: AfterParseHook[];
	beforeCookie: BeforeCookieHook[];
	afterCookie: AfterCookieHook[];
	beforeProxySelect: BeforeProxySelectHook[];
	afterProxySelect: AfterProxySelectHook[];
	beforeProxyError: BeforeProxyErrorHook[];
	afterProxyError: AfterProxyErrorHook[];
	beforeProxyDisable: BeforeProxyDisableHook[];
	afterProxyDisable: AfterProxyDisableHook[];
	afterProxyRotate: AfterProxyRotateHook[];
	afterProxyEnable: AfterProxyEnableHook[];
	onNoProxiesAvailable: OnNoProxiesAvailableHook[];
	onSocket: OnSocketHook[];
	onDns: OnDnsHook[];
	onTls: OnTlsHook[];
	onTimeout: OnTimeoutHook[];
	onAbort: OnAbortHook[];
	onRateLimitWait: OnRateLimitWaitHook[];
}
export interface DNSCacheOptions {
	enable?: boolean;
	ttl?: number;
	maxEntries?: number;
}
declare class DNSCache {
	private cache;
	private enabled;
	constructor(options?: DNSCacheOptions);
	private makeKey;
	lookup(hostname: string, family?: 4 | 6): Promise<{
		address: string;
		family: 4 | 6;
	} | undefined>;
	lookupAll(hostname: string, family?: 4 | 6): Promise<Array<{
		address: string;
		family: 4 | 6;
	}>>;
	private resolveDNS;
	private resolveAllDNS;
	invalidate(hostname: string): void;
	clear(): void;
	get size(): number;
	get isEnabled(): boolean;
	setEnabled(enabled: boolean): void;
}
export interface ResponseCacheConfig {
	enable?: boolean;
	cacheDir?: string;
	networkCheck?: boolean;
	ttl?: number;
	maxEntries?: number;
	methods?: string[];
	respectHeaders?: boolean;
}
export type ResponseCacheOption = boolean | ResponseCacheConfig;
export interface CachedResponse {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	data: unknown;
	url: string;
	timestamp: number;
	ttl: number;
	etag?: string;
	lastModified?: string;
}
declare class ResponseCache {
	private memoryCache;
	private config;
	private persistenceEnabled;
	private initialized;
	constructor(options?: ResponseCacheOption);
	private initializePersistence;
	private initializePersistenceAsync;
	private getCacheFilePath;
	private persistToDisk;
	private loadFromDiskAsync;
	private generateKey;
	private parseCacheControl;
	isCacheable(method: string, status: number, headers?: Record<string, string>): boolean;
	get(method: string, url: string, headers?: Record<string, string>): CachedResponse | undefined;
	private loadSingleFromDisk;
	set(method: string, url: string, response: RezoResponse, requestHeaders?: Record<string, string>): void;
	private normalizeHeaders;
	getConditionalHeaders(method: string, url: string, requestHeaders?: Record<string, string>): Record<string, string> | undefined;
	updateRevalidated(method: string, url: string, newHeaders: Record<string, string>, requestHeaders?: Record<string, string>): CachedResponse | undefined;
	invalidate(url: string, method?: string): void;
	clear(): void;
	get size(): number;
	get isEnabled(): boolean;
	get isPersistent(): boolean;
	getConfig(): ResponseCacheConfig;
}
type BeforeProxySelectHook$1 = (context: BeforeProxySelectContext) => ProxyInfo | void;
type AfterProxySelectHook$1 = (context: AfterProxySelectContext) => void | Promise<void>;
type BeforeProxyErrorHook$1 = (context: BeforeProxyErrorContext) => void | Promise<void>;
type AfterProxyErrorHook$1 = (context: AfterProxyErrorContext) => void | Promise<void>;
type BeforeProxyDisableHook$1 = (context: BeforeProxyDisableContext) => boolean | void;
type AfterProxyDisableHook$1 = (context: AfterProxyDisableContext) => void | Promise<void>;
type AfterProxyRotateHook$1 = (context: AfterProxyRotateContext) => void | Promise<void>;
type AfterProxyEnableHook$1 = (context: AfterProxyEnableContext) => void | Promise<void>;
export type AfterProxySuccessHook = (context: AfterProxySuccessContext) => void | Promise<void>;
type OnNoProxiesAvailableHook$1 = (context: OnNoProxiesAvailableContext) => void | Promise<void>;
/**
 * Proxy hooks collection for ProxyManager events
 */
export interface ProxyHooks {
	beforeProxySelect: BeforeProxySelectHook$1[];
	afterProxySelect: AfterProxySelectHook$1[];
	beforeProxyError: BeforeProxyErrorHook$1[];
	afterProxyError: AfterProxyErrorHook$1[];
	beforeProxyDisable: BeforeProxyDisableHook$1[];
	afterProxyDisable: AfterProxyDisableHook$1[];
	afterProxyRotate: AfterProxyRotateHook$1[];
	afterProxyEnable: AfterProxyEnableHook$1[];
	/** Hook triggered when a request succeeds through a proxy */
	afterProxySuccess: AfterProxySuccessHook[];
	/** Hook triggered when no proxies are available */
	onNoProxiesAvailable: OnNoProxiesAvailableHook$1[];
}
declare class ProxyManager {
	/** Internal configuration (use getter for external access) */
	private _config;
	/** Read-only access to the proxy manager configuration */
	get config(): Readonly<ProxyManagerConfig>;
	/** Internal proxy states map (proxyId -> state) */
	private states;
	/** Current proxy id for sequential rotation (identity-based, not index-based) */
	private currentSequentialId;
	/** Request counter for current proxy (sequential rotation) */
	private currentProxyRequests;
	/** Last selected proxy (for rotation tracking) */
	private lastSelectedProxy;
	/** Cooldown timers map (proxyId -> timerId) */
	private cooldownTimers;
	/** Last time processExpiredCooldowns ran (debounce) */
	private lastCooldownCheck;
	/** Pending resolvers for waitForProxy() callers */
	private pendingWaiters;
	/** Pending rejecters paired with pendingWaiters */
	private pendingRejecters;
	/** Whether to log hook errors and internal warnings */
	private debug;
	/** Total requests through manager */
	private _totalRequests;
	/** Total successful requests */
	private _totalSuccesses;
	/** Total failed requests */
	private _totalFailures;
	/** Proxy hooks */
	hooks: ProxyHooks;
	/**
	 * Create a new ProxyManager instance
	 * @param config - Proxy manager configuration
	 */
	constructor(config: ProxyManagerConfig);
	/**
	 * Create initial state for a proxy
	 */
	private createInitialState;
	/**
	 * Check if a URL should use proxy based on whitelist/blacklist
	 * @param url - The request URL to check
	 * @returns true if URL should use proxy, false if should go direct
	 */
	shouldProxy(url: string): boolean;
	/**
	 * Match a URL against a pattern
	 */
	private matchPattern;
	/**
	 * Get active proxies (not disabled)
	 */
	getActive(): ProxyInfo[];
	/**
	 * Internal: get active proxies with guaranteed ids
	 */
	private getActiveInternal;
	/**
	 * Get disabled proxies
	 */
	getDisabled(): ProxyInfo[];
	/**
	 * Get proxies in cooldown
	 */
	getCooldown(): ProxyInfo[];
	/**
	 * Get all proxy states regardless of status
	 * Returns the full internal state for every proxy in the pool
	 */
	getAll(): ProxyState[];
	/**
	 * Process expired cooldowns and re-enable proxies
	 */
	private processExpiredCooldowns;
	/**
	 * Get next proxy based on rotation strategy (convenience alias for select().proxy)
	 * @param url - The request URL (for whitelist/blacklist checking)
	 * @returns Selected proxy or null if should go direct
	 */
	next(url: string): ProxyInfo | null;
	/**
	 * Select a proxy with detailed reason
	 * Core selection method — fires all hooks, applies rotation, updates state
	 * @param url - The request URL
	 * @returns Selection result with proxy and reason
	 */
	select(url: string): ProxySelectionResult;
	/**
	 * Select proxy based on rotation strategy
	 * All proxies in activeProxies have guaranteed ids (assigned on construction/add)
	 */
	private selectProxy;
	/**
	 * Report a successful request through a proxy
	 * @param proxy - The proxy that succeeded
	 */
	reportSuccess(proxy: ProxyInfo): void;
	/**
	 * Report a failed request through a proxy
	 * @param proxy - The proxy that failed
	 * @param error - The error that occurred
	 * @param url - Optional URL for hook context
	 */
	reportFailure(proxy: ProxyInfo, error: Error, url?: string): void;
	/**
	 * Alias for reportFailure - report an error for a proxy
	 * @param proxy - The proxy that had an error
	 * @param error - The error that occurred
	 * @param url - Optional URL for hook context
	 */
	reportError(proxy: ProxyInfo, error: Error, url?: string): void;
	/**
	 * Disable a proxy from the pool
	 * @param proxy - The proxy to disable
	 * @param reason - Reason for disabling
	 */
	disableProxy(proxy: ProxyInfo, reason?: "dead" | "limit-reached" | "manual"): void;
	/**
	 * Enable a previously disabled proxy
	 * @param proxy - The proxy to enable
	 * @param reason - Reason for enabling
	 */
	enableProxy(proxy: ProxyInfo, reason?: "cooldown-expired" | "manual"): void;
	/**
	 * Add proxies to the pool
	 * @param proxies - Proxies to add
	 */
	add(proxies: string | ProxyInfo | (string | ProxyInfo)[]): void;
	/**
	 * Remove proxies from the pool
	 * @param proxies - Proxies to remove
	 */
	remove(proxies: ProxyInfo | ProxyInfo[]): void;
	/**
	 * Remove a proxy from the pool by its id
	 * @param id - The proxy id to remove
	 */
	removeById(id: string): void;
	/**
	 * Reset all proxies - re-enable all and reset counters
	 */
	reset(): void;
	/**
	 * Remove all proxies and reset counters
	 * Unlike reset() which re-enables existing proxies, this empties the pool entirely.
	 * Unlike destroy() which tears down the instance, the manager remains usable after clear().
	 */
	clear(): void;
	/**
	 * Get current status of all proxies
	 */
	getStatus(): ProxyManagerStatus;
	/**
	 * Total number of proxies in the pool (active + disabled + cooldown)
	 */
	get size(): number;
	/** Total requests routed through the manager */
	get totalRequests(): number;
	/** Total successful requests */
	get totalSuccesses(): number;
	/** Total failed requests */
	get totalFailures(): number;
	/**
	 * Get state for a specific proxy
	 * @param proxy - The proxy to get state for
	 */
	getProxyState(proxy: ProxyInfo): ProxyState | undefined;
	/**
	 * Check if a proxy exists in the pool (any state)
	 * @param proxy - The proxy to check
	 */
	has(proxy: ProxyInfo): boolean;
	/**
	 * Check if any proxies are available (active and ready to use)
	 */
	hasAvailableProxies(): boolean;
	/**
	 * Check if any proxies are currently in cooldown and will become available
	 * Useful for standalone pool usage to know if waiting is worthwhile
	 *
	 * @returns true if at least one proxy is in cooldown (will re-enable automatically)
	 *
	 * @example
	 * ```typescript
	 * if (!pool.hasAvailableProxies() && pool.isCoolingDown()) {
	 *     const proxy = await pool.waitForProxy();
	 * }
	 * ```
	 */
	isCoolingDown(): boolean;
	/**
	 * Get the number of milliseconds until the next proxy exits cooldown
	 * Returns 0 if a proxy is already available, -1 if no proxies are in cooldown
	 *
	 * @returns Milliseconds until next proxy becomes available
	 *
	 * @example
	 * ```typescript
	 * const ms = pool.nextCooldownMs();
	 * if (ms > 0) console.log(`Next proxy available in ${ms}ms`);
	 * if (ms === -1) console.log('No proxies recovering — pool is dead');
	 * ```
	 */
	nextCooldownMs(): number;
	/**
	 * Wait for the next proxy to become available
	 * Resolves immediately if a proxy is already active.
	 * If proxies are in cooldown, resolves when the first one re-enables.
	 * Rejects if no proxies are in cooldown (pool is permanently exhausted).
	 *
	 * @returns Promise that resolves with the first available proxy
	 * @throws {Error} If no proxies are in cooldown and none are active
	 *
	 * @example
	 * ```typescript
	 * // Standalone pool usage
	 * const proxy = pool.next(url);
	 * if (!proxy && pool.isCoolingDown()) {
	 *     const recovered = await pool.waitForProxy();
	 *     // use recovered proxy
	 * }
	 * ```
	 */
	waitForProxy(): Promise<ProxyInfo>;
	/**
	 * Destroy the manager and cleanup timers
	 */
	destroy(): void;
	/**
	 * Create a RezoError for ProxyManager context (no request config available)
	 */
	private createError;
	/**
	 * Run hooks array with safe error handling.
	 * Sync hooks execute inline; async hooks fire-and-forget with rejection caught.
	 */
	private runHooks;
	private runBeforeProxySelectHooks;
	/**
	 * Notify that no proxies are available and trigger hooks
	 * This method is called when proxy selection fails due to pool exhaustion
	 *
	 * @param url - The request URL that needed a proxy
	 * @param error - The error that will be thrown
	 * @returns The context object with detailed information about the proxy pool state
	 *
	 * @example
	 * ```typescript
	 * manager.hooks.onNoProxiesAvailable.push((context) => {
	 *     console.error(`No proxies available for ${context.url}`);
	 *     console.log(`Dead: ${context.disabledReasons.dead}, Limit: ${context.disabledReasons.limitReached}`);
	 *     // Trigger external alert or proxy refresh
	 *     alertSystem.notify('Proxy pool exhausted', context);
	 * });
	 *
	 * // Called internally or by adapters when no proxies are available
	 * const context = manager.notifyNoProxiesAvailable('https://api.example.com', new Error('No proxies'));
	 * ```
	 */
	notifyNoProxiesAvailable(url: string, error: Error): OnNoProxiesAvailableContext;
}
/**
 * Queue configuration options
 */
export interface QueueConfig {
	/** Name of the queue - useful for debugging and logging */
	name?: string;
	/** Maximum concurrent tasks (default: Infinity) */
	concurrency?: number;
	/** Auto-start processing when tasks are added (default: true) */
	autoStart?: boolean;
	/** Timeout per task in milliseconds (default: none) */
	timeout?: number;
	/** Throw on timeout vs silently fail (default: true) */
	throwOnTimeout?: boolean;
	/** Interval between task starts in ms for rate limiting */
	interval?: number;
	/** Max tasks to start per interval (default: Infinity) */
	intervalCap?: number;
	/** Carry over unused interval capacity to next interval */
	carryoverConcurrencyCount?: boolean;
	/**
	 * Reject the task promise when an error occurs (default: false)
	 * When false, errors are swallowed and task.resolve(undefined) is called.
	 * This prevents unhandled promise rejections but makes error handling harder.
	 * When true, task.reject(error) is called, allowing proper try/catch handling.
	 */
	rejectOnError?: boolean;
}
/**
 * HTTP-specific queue configuration
 */
export interface HttpQueueConfig extends QueueConfig {
	/** Per-domain concurrency limits */
	domainConcurrency?: number | Record<string, number>;
	/** Global requests per second limit */
	requestsPerSecond?: number;
	/** Respect Retry-After headers automatically */
	respectRetryAfter?: boolean;
	/** Respect X-RateLimit-* headers automatically */
	respectRateLimitHeaders?: boolean;
	/** Retry failed tasks automatically */
	autoRetry?: boolean;
	/**
	 * Alias for autoRetry - automatically retry on rate limit (429) responses
	 * @alias autoRetry
	 */
	retryOnRateLimit?: boolean;
	/** Max retry attempts for auto-retry */
	maxRetries?: number;
	/** Delay between retries (supports backoff function) */
	retryDelay?: number | ((attempt: number) => number);
	/** Status codes that trigger retry */
	retryStatusCodes?: number[];
}
/**
 * Task options when adding to queue
 */
export interface TaskOptions {
	/** Task priority (higher runs first, default: 0) */
	priority?: number;
	/** Task-specific timeout (overrides queue default) */
	timeout?: number;
	/** Unique ID for tracking/cancellation */
	id?: string;
	/** Signal for external cancellation */
	signal?: AbortSignal;
}
/**
 * HTTP-specific task options
 */
export interface HttpTaskOptions extends TaskOptions {
	/** Domain for per-domain limiting (auto-extracted if not provided) */
	domain?: string;
	/** HTTP method for method-based priority */
	method?: string;
	/** Retry this specific task on failure */
	retry?: boolean | number;
	/** Custom retry delay for this task */
	retryDelay?: number;
}
/**
 * Current queue state
 */
export interface QueueState {
	/** Number of tasks currently running */
	pending: number;
	/** Number of tasks waiting in queue */
	size: number;
	/** Total tasks (pending + size) */
	total: number;
	/** Is queue paused */
	isPaused: boolean;
	/** Is queue idle (no tasks) */
	isIdle: boolean;
}
/**
 * Queue statistics
 */
export interface QueueStats {
	/** Total tasks added since creation */
	added: number;
	/** Total tasks processed (started) */
	processed: number;
	/** Total successful completions */
	completed: number;
	/** Total failures */
	failed: number;
	/** Total timeouts */
	timedOut: number;
	/** Total cancellations */
	cancelled: number;
	/** Average task duration (ms) */
	averageDuration: number;
	/** Tasks per second (rolling average) */
	throughput: number;
}
/**
 * HTTP-specific statistics
 */
export interface HttpQueueStats extends QueueStats {
	/** Stats per domain */
	byDomain: Record<string, {
		pending: number;
		completed: number;
		failed: number;
		rateLimited: number;
	}>;
	/** Total retries performed */
	retries: number;
	/** Rate limit events */
	rateLimitHits: number;
}
/**
 * Domain-specific state
 */
export interface DomainState {
	/** Number of tasks currently running for domain */
	pending: number;
	/** Number of tasks waiting for domain */
	size: number;
	/** Is domain paused */
	isPaused: boolean;
	/** Rate limit until timestamp (if rate limited) */
	rateLimitedUntil?: number;
}
/**
 * Queue event types
 */
export interface QueueEvents {
	/** Task added to queue */
	add: {
		id: string;
		priority: number;
	};
	/** Task started executing */
	start: {
		id: string;
	};
	/** Task completed successfully */
	completed: {
		id: string;
		result: any;
		duration: number;
	};
	/** Task failed with error */
	error: {
		id: string;
		error: Error;
	};
	/** Task timed out */
	timeout: {
		id: string;
	};
	/** Task cancelled */
	cancelled: {
		id: string;
	};
	/** Queue became active (was idle, now processing) */
	active: undefined;
	/** Queue became idle (all tasks done) */
	idle: undefined;
	/** Queue was paused */
	paused: undefined;
	/** Queue was resumed */
	resumed: undefined;
	/** Next task about to run */
	next: undefined;
	/** Queue was emptied (no pending tasks) */
	empty: undefined;
}
/**
 * HTTP-specific events
 */
export interface HttpQueueEvents extends QueueEvents {
	/** Rate limit hit for a domain */
	rateLimited: {
		domain: string;
		retryAfter: number;
	};
	/** Domain queue became available */
	domainAvailable: {
		domain: string;
	};
	/** Task being retried */
	retry: {
		id: string;
		attempt: number;
		error: Error;
	};
}
/**
 * Event handler type
 */
export type EventHandler<T> = (data: T) => void;
/**
 * Task function type
 */
export type TaskFunction<T> = () => Promise<T>;
declare class RezoQueue<T = any> {
	private queue;
	private pendingCount;
	private isPausedFlag;
	private intervalId?;
	private intervalCount;
	readonly name: string;
	private _intervalStart;
	private eventHandlers;
	private statsData;
	private totalDuration;
	private throughputWindow;
	private readonly throughputWindowSize;
	private idlePromise?;
	private emptyPromise?;
	/** Tracks if queue has ever had work added - ensures onIdle waits for first task */
	private hasEverBeenActive;
	readonly config: Required<QueueConfig>;
	/**
	 * Create a new RezoQueue
	 * @param config - Queue configuration options
	 */
	constructor(config?: QueueConfig);
	/**
	 * Get current queue state
	 */
	get state(): QueueState;
	/**
	 * Get queue statistics
	 */
	get stats(): QueueStats;
	/**
	 * Get/set concurrency limit
	 */
	get concurrency(): number;
	set concurrency(value: number);
	/**
	 * Number of pending (running) tasks
	 */
	get pending(): number;
	/**
	 * Number of tasks waiting in queue
	 */
	get size(): number;
	/**
	 * Check if queue is paused
	 */
	get isPaused(): boolean;
	/**
	 * Add a task to the queue
	 * @param fn - Async function to execute
	 * @param options - Task options
	 * @returns Promise resolving to task result
	 */
	add<R = T>(fn: TaskFunction<R>, options?: TaskOptions): Promise<R>;
	/**
	 * Add multiple tasks to the queue
	 * @param fns - Array of async functions
	 * @param options - Task options (applied to all)
	 * @returns Promise resolving to array of results
	 */
	addAll<R = T>(fns: TaskFunction<R>[], options?: TaskOptions): Promise<R[]>;
	/**
	 * Pause queue processing (running tasks continue)
	 */
	pause(): void;
	/**
	 * Resume queue processing
	 */
	start(): void;
	/**
	 * Clear all pending tasks from queue
	 */
	clear(): void;
	/**
	 * Cancel a specific task by ID
	 * @param id - Task ID to cancel
	 * @returns true if task was found and cancelled
	 */
	cancel(id: string): boolean;
	/**
	 * Cancel all tasks matching a predicate
	 * @param predicate - Function to test each task
	 * @returns Number of tasks cancelled
	 */
	cancelBy(predicate: (task: {
		id: string;
		priority: number;
	}) => boolean): number;
	/**
	 * Wait for queue to become idle (no running or pending tasks)
	 *
	 * Unlike a simple "isIdle" check, this properly waits for work to be added
	 * and completed if called before any tasks are queued (matches p-queue behavior).
	 */
	onIdle(): Promise<void>;
	/**
	 * Wait for queue to be empty (no pending tasks, but may have running)
	 */
	onEmpty(): Promise<void>;
	/**
	 * Wait for queue size to be less than limit
	 * @param limit - Size threshold
	 * @param timeoutMs - Optional timeout in milliseconds (default: 0 = no timeout)
	 *                    If timeout occurs, promise resolves (not rejects) to prevent blocking
	 */
	onSizeLessThan(limit: number, timeoutMs?: number): Promise<void>;
	/** Maximum recommended handlers per event before warning */
	private static readonly MAX_HANDLERS_WARNING;
	/**
	 * Register an event handler
	 * @param event - Event name
	 * @param handler - Handler function
	 */
	on<E extends keyof QueueEvents>(event: E, handler: EventHandler<QueueEvents[E]>): void;
	/**
	 * Remove an event handler
	 * @param event - Event name
	 * @param handler - Handler function to remove
	 */
	off<E extends keyof QueueEvents>(event: E, handler: EventHandler<QueueEvents[E]>): void;
	/**
	 * Destroy the queue and cleanup resources
	 */
	destroy(): void;
	/**
	 * Insert task into queue maintaining priority order (highest first)
	 * Fast path: priority 0 (default) appends directly — O(1) instead of O(n) scan
	 */
	private insertByPriority;
	/**
	 * Try to run next task if capacity available.
	 *
	 * Like p-queue's #tryToStartAnother(), this method handles idle/empty
	 * checks INSIDE itself — only after confirming there's nothing left to
	 * dequeue. This prevents the false-idle race where idle fires while
	 * tasks are still in the queue waiting to be shifted.
	 */
	private tryRunNext;
	/**
	 * Clear the interval timer (called when queue empties).
	 * The interval will be re-created when new tasks are added.
	 */
	private clearIntervalTimer;
	/**
	 * Execute a task
	 */
	private runTask;
	/**
	 * Record task duration for statistics
	 */
	private recordDuration;
	/**
	 * Start interval-based rate limiting
	 */
	private startInterval;
	/**
	 * Emit an event
	 */
	protected emit<E extends keyof QueueEvents>(event: E, data: QueueEvents[E]): void;
	/**
	 * Check if queue became empty
	 */
	private checkEmpty;
	/**
	 * Check if queue became idle
	 */
	private checkIdle;
}
declare class HttpQueue extends RezoQueue<any> {
	private domainQueues;
	private domainPending;
	private domainPaused;
	private domainRateLimited;
	private domainConcurrencyLimits;
	private httpStatsData;
	private httpEventHandlers;
	readonly httpConfig: Required<HttpQueueConfig>;
	/**
	 * Create a new HttpQueue
	 * @param config - HTTP queue configuration
	 */
	constructor(config?: HttpQueueConfig);
	/**
	 * Resume queue processing (overrides base to also process HTTP tasks)
	 */
	start(): void;
	/**
	 * Get HTTP-specific statistics
	 */
	get httpStats(): HttpQueueStats;
	/**
	 * Add an HTTP task to the queue
	 * @param fn - Async function to execute
	 * @param options - HTTP task options
	 * @returns Promise resolving to task result
	 */
	addHttp<R = any>(fn: TaskFunction<R>, options?: HttpTaskOptions): Promise<R>;
	/**
	 * Pause requests to specific domain
	 * @param domain - Domain to pause
	 */
	pauseDomain(domain: string): void;
	/**
	 * Resume requests to specific domain
	 * @param domain - Domain to resume
	 */
	resumeDomain(domain: string): void;
	/**
	 * Set per-domain concurrency limit
	 * @param domain - Domain to configure
	 * @param limit - Concurrency limit
	 */
	setDomainConcurrency(domain: string, limit: number): void;
	/**
	 * Get domain-specific state
	 * @param domain - Domain to query
	 */
	getDomainState(domain: string): DomainState;
	/**
	 * Handle rate limit response
	 * @param domain - Domain that was rate limited
	 * @param retryAfter - Seconds until retry is allowed
	 */
	handleRateLimit(domain: string, retryAfter: number): void;
	/**
	 * Cancel an HTTP task by ID
	 * @param id - Task ID to cancel
	 * @returns true if task was found and cancelled
	 */
	cancelHttp(id: string): boolean;
	/**
	 * Register an event handler (supports both base and HTTP-specific events)
	 * @param event - Event name
	 * @param handler - Handler function
	 */
	on<E extends keyof HttpQueueEvents>(event: E, handler: EventHandler<HttpQueueEvents[E]>): void;
	/**
	 * Remove an event handler (supports both base and HTTP-specific events)
	 * @param event - Event name
	 * @param handler - Handler function to remove
	 */
	off<E extends keyof HttpQueueEvents>(event: E, handler: EventHandler<HttpQueueEvents[E]>): void;
	/**
	 * Register an HTTP event handler
	 * @param event - Event name
	 * @param handler - Handler function
	 * @deprecated Use on() instead
	 */
	onHttp<E extends keyof HttpQueueEvents>(event: E, handler: EventHandler<HttpQueueEvents[E]>): void;
	/**
	 * Remove an HTTP event handler
	 * @param event - Event name
	 * @param handler - Handler function to remove
	 * @deprecated Use off() instead
	 */
	offHttp<E extends keyof HttpQueueEvents>(event: E, handler: EventHandler<HttpQueueEvents[E]>): void;
	/**
	 * Clear all HTTP tasks
	 */
	clearHttp(): void;
	/**
	 * Destroy the queue and cleanup resources
	 */
	destroy(): void;
	/**
	 * Insert HTTP task maintaining priority order
	 */
	private insertHttpTask;
	/**
	 * Get domain concurrency limit
	 */
	private getDomainLimit;
	/**
	 * Check if domain can accept more tasks
	 */
	private canRunDomain;
	/**
	 * Try to run next HTTP task
	 */
	private tryRunHttpNext;
	/**
	 * Execute an HTTP task
	 */
	private runHttpTask;
	/**
	 * Calculate retry delay for task
	 */
	private getRetryDelay;
	/**
	 * Ensure domain stats exist
	 */
	private ensureDomainStats;
	/**
	 * Emit an HTTP event
	 */
	private emitHttp;
}
/**
 * Browser profile types for RezoStealth
 *
 * Defines the shape of a complete browser fingerprint profile including
 * TLS parameters, HTTP/2 settings, header ordering, and client hints.
 *
 * @module stealth/profiles/types
 */
export interface TlsFingerprint {
	/** TLS cipher suites in exact browser order, OpenSSL names, colon-separated */
	ciphers: string;
	/** Signature algorithms in exact browser order, colon-separated */
	sigalgs: string;
	/** ECDH curves / supported groups in exact browser order */
	ecdhCurve: string;
	/** Minimum TLS version */
	minVersion: "TLSv1.2" | "TLSv1.3";
	/** Maximum TLS version */
	maxVersion: "TLSv1.2" | "TLSv1.3";
	/** ALPN protocols in browser order */
	alpnProtocols: string[];
	/** TLS session timeout in seconds */
	sessionTimeout: number;
}
export interface Http2Settings {
	/** SETTINGS_HEADER_TABLE_SIZE (0x01) */
	headerTableSize: number;
	/** SETTINGS_ENABLE_PUSH (0x02) */
	enablePush: boolean;
	/** SETTINGS_MAX_CONCURRENT_STREAMS (0x03) — 0 = not sent (use server default) */
	maxConcurrentStreams: number;
	/** SETTINGS_INITIAL_WINDOW_SIZE (0x04) */
	initialWindowSize: number;
	/** SETTINGS_MAX_FRAME_SIZE (0x05) */
	maxFrameSize: number;
	/** SETTINGS_MAX_HEADER_LIST_SIZE (0x06) — 0 = not sent */
	maxHeaderListSize: number;
	/** WINDOW_UPDATE on connection level sent after SETTINGS */
	connectionWindowSize: number;
}
export interface ClientHints {
	/** sec-ch-ua header value (brand list). null for non-Chromium browsers. */
	secChUa: string | null;
	/** sec-ch-ua-mobile — '?0' or '?1'. null for non-Chromium. */
	secChUaMobile: string | null;
	/** sec-ch-ua-platform — e.g., '"Windows"'. null for non-Chromium. */
	secChUaPlatform: string | null;
	/** sec-ch-ua-full-version-list (optional, only on request) */
	secChUaFullVersionList?: string;
	/** sec-ch-ua-arch */
	secChUaArch?: string;
	/** sec-ch-ua-bitness */
	secChUaBitness?: string;
	/** sec-ch-ua-model (mobile only) */
	secChUaModel?: string;
	/** sec-ch-ua-platform-version */
	secChUaPlatformVersion?: string;
}
export interface NavigatorProperties {
	/** navigator.platform value */
	platform: string;
	/** Number of logical processors */
	hardwareConcurrency: number;
	/** Device memory in GB */
	deviceMemory: number;
	/** Max touch points (0 for desktop, 5+ for mobile) */
	maxTouchPoints: number;
}
export interface BrowserProfile {
	/** Unique profile identifier (e.g., 'chrome-131', 'firefox-133') */
	id: string;
	/** Browser family */
	family: "chrome" | "firefox" | "safari" | "edge" | "opera" | "brave";
	/** Browser engine */
	engine: "blink" | "gecko" | "webkit";
	/** Full version string */
	version: string;
	/** Major version number */
	majorVersion: number;
	/** Device type */
	device: "desktop" | "mobile";
	/** TLS fingerprint parameters */
	tls: TlsFingerprint;
	/** HTTP/2 SETTINGS frame values */
	h2Settings: Http2Settings;
	/**
	 * HTTP/2 pseudo-header order as shorthand.
	 * m = :method, a = :authority, s = :scheme, p = :path
	 * Chrome: 'masp', Firefox: 'mpas', Safari: 'mspa'
	 */
	pseudoHeaderOrder: string;
	/** Regular header names in exact browser send order (lowercase) */
	headerOrder: string[];
	/** User-Agent strings per platform */
	userAgents: {
		windows: string;
		macos: string;
		linux: string;
		android?: string;
		ios?: string;
	};
	/** Default Accept header for navigation requests */
	accept: string;
	/** Default Accept-Encoding header */
	acceptEncoding: string;
	/** Default Accept-Language header */
	acceptLanguage: string;
	/** Client hints (Chromium-based only; all null for Firefox/Safari) */
	clientHints: ClientHints;
	/** Navigator properties */
	navigator: NavigatorProperties;
}
/**
 * Union type of all built-in browser profile IDs.
 * Provides full autocomplete in IDEs.
 */
export type BrowserProfileName = "chrome-120" | "chrome-124" | "chrome-128" | "chrome-131" | "chrome-131-android" | "firefox-115" | "firefox-121" | "firefox-128" | "firefox-133" | "safari-16.6" | "safari-17.4" | "safari-18.2" | "safari-17-ios" | "safari-18-ios" | "edge-120" | "edge-131" | "opera-115" | "brave-1.73";
/**
 * Configuration options for RezoStealth.
 *
 * Can override specific parts of a profile while keeping the rest intact.
 */
export interface RezoStealthOptions {
	/** Profile to use — name string or full BrowserProfile object */
	profile?: BrowserProfileName | BrowserProfile;
	/** Pick a random profile from this browser family (ignored if `profile` is set) */
	family?: BrowserProfile["family"];
	/** Rotate identity on every request — fresh profile each time, no caching */
	rotate?: boolean;
	/** Override specific headers (user-set headers always take priority) */
	headers?: Record<string, string>;
	/** Override header order */
	headerOrder?: string[];
	/** Override TLS parameters */
	tls?: Partial<TlsFingerprint>;
	/** Override HTTP/2 SETTINGS */
	h2Settings?: Partial<Http2Settings>;
	/** Override Accept-Language */
	language?: string;
	/** Override platform for User-Agent selection ('windows' | 'macos' | 'linux' | 'android' | 'ios') */
	platform?: "windows" | "macos" | "linux" | "android" | "ios";
}
/**
 * Fully resolved stealth profile ready for use by adapters.
 *
 * Created once by the resolver and cached — adapters read values directly.
 */
export interface ResolvedStealthProfile {
	/** The underlying browser profile */
	profile: BrowserProfile;
	/** Profile ID */
	profileId: string;
	/** Resolved TLS fingerprint (profile + overrides) */
	tls: TlsFingerprint;
	/** Resolved HTTP/2 SETTINGS (profile + overrides) */
	h2Settings: Http2Settings;
	/** Resolved header order */
	headerOrder: string[];
	/** HTTP/2 pseudo-header order as full strings */
	pseudoHeaderOrder: string[];
	/** Default headers to apply (User-Agent, Accept, etc.) — lowercase keys */
	defaultHeaders: Record<string, string>;
	/** Navigator properties for JS environment emulation */
	navigator: BrowserProfile["navigator"];
}
declare class RezoStealth {
	private readonly _input;
	private _resolved;
	/** True when constructed with no args — profile will be detected from request headers */
	private readonly _autoDetect;
	/** True when rotate mode is enabled — fresh identity per resolve() call */
	private readonly _rotate;
	/**
	 * Create a RezoStealth instance.
	 *
	 * @param input Profile name, BrowserProfile object, or RezoStealthOptions. Omit for auto-detect.
	 *
	 * @example
	 * new RezoStealth()                                    // auto-detect from UA header
	 * new RezoStealth('chrome-131')                        // specific profile
	 * new RezoStealth({ family: 'brave' })                 // random Brave profile
	 * new RezoStealth({ family: 'chrome', platform: 'windows' })  // random Chrome, Windows UA
	 * new RezoStealth({ rotate: true })                    // fresh random identity per request
	 * new RezoStealth({ rotate: true, family: 'firefox' }) // rotate within Firefox family
	 */
	constructor(input?: BrowserProfileName | BrowserProfile | RezoStealthOptions);
	/** Whether this instance uses auto-detection from request headers */
	get isAutoDetect(): boolean;
	/** Whether this instance rotates identity per request */
	get isRotate(): boolean;
	/**
	 * Resolve the stealth profile.
	 *
	 * When `rotate: true`, returns a fresh identity every call.
	 * Otherwise, caches after the first call.
	 *
	 * @param userAgent Optional user-agent string for auto-detect mode.
	 */
	resolve(userAgent?: string): ResolvedStealthProfile;
	/** The resolved profile ID */
	get profileName(): string;
	/** The resolved browser profile */
	get profile(): BrowserProfile;
	/**
	 * Create a new RezoStealth with merged overrides.
	 * The original instance is not modified.
	 */
	withOverrides(overrides: Partial<RezoStealthOptions>): RezoStealth;
	/** Create stealth with a specific profile by name */
	static from(name: BrowserProfileName): RezoStealth;
	/** Create stealth with a random Chrome profile */
	static chrome(): RezoStealth;
	/** Create stealth with a random Firefox profile */
	static firefox(): RezoStealth;
	/** Create stealth with a random Safari profile */
	static safari(): RezoStealth;
	/** Create stealth with a random Edge profile */
	static edge(): RezoStealth;
	/** Create stealth with a random profile from any browser family */
	static random(): RezoStealth;
	/**
	 * Auto-detect a browser profile from a User-Agent string.
	 *
	 * Parses the UA and finds the closest matching browser profile.
	 * Falls back to random Chrome if no match found.
	 *
	 * @param userAgent User-Agent string to match
	 */
	static fromUserAgent(userAgent: string): RezoStealth;
}
export interface RezoReactNativeFileDownloadHeadersEvent {
	status: number;
	statusText?: string;
	headers?: Record<string, string>;
	finalUrl?: string;
	contentType?: string;
	contentLength?: number;
}
export interface RezoReactNativeFileDownloadProgressEvent {
	loaded: number;
	total?: number;
	speed?: number;
	averageSpeed?: number;
	estimatedTime?: number;
}
export interface RezoReactNativeFileDownloadRequest {
	url: string;
	destination: string;
	method: string;
	headers: Record<string, string>;
	body?: unknown;
	timeout?: number | null;
	signal?: AbortSignal | null;
	onHeaders?: (event: RezoReactNativeFileDownloadHeadersEvent) => void | Promise<void>;
	onProgress?: (event: RezoReactNativeFileDownloadProgressEvent) => void | Promise<void>;
}
export interface RezoReactNativeFileDownloadResult {
	status: number;
	statusText?: string;
	headers?: Record<string, string>;
	finalUrl?: string;
	contentType?: string;
	contentLength?: number;
	filePath: string;
	fileSize?: number;
}
export interface RezoReactNativeFileUploadSource {
	uri: string;
	name?: string;
	type?: string;
	fieldName?: string;
	size?: number;
}
export interface RezoReactNativeFileUploadProgressEvent {
	loaded: number;
	total?: number;
	speed?: number;
	averageSpeed?: number;
	estimatedTime?: number;
}
export interface RezoReactNativeFileUploadRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	file: RezoReactNativeFileUploadSource;
	fields?: Record<string, string>;
	binaryStreamOnly?: boolean;
	timeout?: number | null;
	signal?: AbortSignal | null;
	onHeaders?: (event: RezoReactNativeFileDownloadHeadersEvent) => void | Promise<void>;
	onProgress?: (event: RezoReactNativeFileUploadProgressEvent) => void | Promise<void>;
}
export interface RezoReactNativeFileUploadResult {
	status: number;
	statusText?: string;
	headers?: Record<string, string>;
	finalUrl?: string;
	contentType?: string;
	contentLength?: number;
	body?: unknown;
	uploadSize?: number;
	fileName?: string;
}
export interface RezoReactNativeStreamHeadersEvent {
	status: number;
	statusText?: string;
	headers?: Record<string, string>;
	finalUrl?: string;
	contentType?: string;
	contentLength?: number;
}
export interface RezoReactNativeStreamProgressEvent {
	loaded: number;
	total?: number;
	speed?: number;
	averageSpeed?: number;
	estimatedTime?: number;
}
export interface RezoReactNativeStreamRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: unknown;
	timeout?: number | null;
	signal?: AbortSignal | null;
	onHeaders?: (event: RezoReactNativeStreamHeadersEvent) => void | Promise<void>;
	onChunk?: (chunk: Uint8Array | string) => void | Promise<void>;
	onProgress?: (event: RezoReactNativeStreamProgressEvent) => void | Promise<void>;
}
export interface RezoReactNativeStreamResult {
	status: number;
	statusText?: string;
	headers?: Record<string, string>;
	finalUrl?: string;
	contentType?: string;
	contentLength?: number;
}
export interface RezoReactNativeUploadConfig extends RezoReactNativeFileUploadSource {
	enabled?: boolean;
	fields?: Record<string, string>;
	binaryStreamOnly?: boolean;
}
export interface RezoReactNativeFileSystemAdapterCapabilities {
	fileDownload?: boolean;
	downloadProgress?: boolean;
	uploadFromFile?: boolean;
	uploadProgress?: boolean;
	backgroundTasks?: boolean;
}
export interface RezoReactNativeFileSystemAdapter {
	name: string;
	capabilities?: RezoReactNativeFileSystemAdapterCapabilities;
	downloadFile?: (request: RezoReactNativeFileDownloadRequest) => Promise<RezoReactNativeFileDownloadResult>;
	uploadFile?: (request: RezoReactNativeFileUploadRequest) => Promise<RezoReactNativeFileUploadResult>;
}
export interface RezoReactNativeStreamTransport {
	name: string;
	stream(request: RezoReactNativeStreamRequest): Promise<RezoReactNativeStreamResult>;
}
export interface RezoReactNativeNetworkState {
	type?: string;
	isConnected: boolean | null;
	isInternetReachable: boolean | null;
	isExpensive?: boolean;
	details?: Record<string, any>;
}
export interface RezoReactNativeNetworkInfoProvider {
	fetch(): Promise<RezoReactNativeNetworkState>;
	subscribe?(listener: (state: RezoReactNativeNetworkState) => void): (() => void) | Promise<() => void>;
}
export interface RezoReactNativeBackgroundTaskDefinition {
	name: string;
	minimumInterval?: number;
	metadata?: Record<string, any>;
}
export interface RezoReactNativeBackgroundTaskConfig {
	enabled?: boolean;
	name: string;
	minimumInterval?: number;
	metadata?: Record<string, any>;
	keepRegistered?: boolean;
}
export interface RezoReactNativeBackgroundTaskProvider {
	registerTask(task: RezoReactNativeBackgroundTaskDefinition): Promise<void>;
	unregisterTask(name: string): Promise<void>;
	isTaskRegistered?(name: string): Promise<boolean>;
}
export interface RezoReactNativeOptions {
	fileSystemAdapter?: RezoReactNativeFileSystemAdapter;
	streamTransport?: RezoReactNativeStreamTransport;
	networkInfoProvider?: RezoReactNativeNetworkInfoProvider;
	backgroundTaskProvider?: RezoReactNativeBackgroundTaskProvider;
	backgroundTask?: RezoReactNativeBackgroundTaskConfig | null;
	upload?: RezoReactNativeUploadConfig | null;
}
export type queueOptions = QueueConfig;
export interface CacheConfig {
	/** Response cache configuration */
	response?: boolean | ResponseCacheConfig;
	/** DNS cache configuration */
	dns?: boolean | DNSCacheOptions;
}
export type CacheOption = boolean | CacheConfig;
export interface RezoDefaultOptions {
	baseURL?: string;
	/** Optional React Native integrations such as file-system or network-state providers */
	reactNative?: RezoReactNativeOptions;
	/** Hooks for request/response lifecycle */
	hooks?: Partial<RezoHooks>;
	/**
	 * Whether to disable automatic cookie handling.
	 * When false (default), cookies are automatically managed via the jar.
	 * Set to true to disable automatic cookie management.
	 * @default false
	 */
	disableJar?: boolean;
	/**
	 * Custom cookie jar for managing cookies.
	 * The recommended way to manage cookies - pass the jar when creating the instance.
	 * @example
	 * ```typescript
	 * const client = new Rezo({ jar: myJar });
	 * // or
	 * const client = rezo.create({ jar: myJar });
	 * ```
	 */
	jar?: RezoHttpRequest["jar"];
	/** Set default cookies to send with the requests in various formats */
	cookies?: RezoHttpRequest["cookies"];
	/**
	 * Path to cookie file for persistence.
	 * - .json files save cookies as serialized JSON
	 * - .txt files save cookies in Netscape format
	 * Cookies are loaded on construction and saved automatically after each request.
	 */
	cookieFile?: string;
	/**
	 * Queue for request management - supports multiple formats:
	 * - RezoHttpQueue instance (takes priority)
	 * - RezoQueue instance
	 * - HttpQueueConfig object (creates RezoHttpQueue internally)
	 * - QueueConfig object (creates RezoQueue internally)
	 *
	 * @example
	 * ```typescript
	 * // Pass RezoHttpQueue instance
	 * const queue = new RezoHttpQueue({ concurrency: 5, domainConcurrency: 2 });
	 * const client = rezo.create({ queue });
	 *
	 * // Or pass config to create internally
	 * const client = rezo.create({ queue: { concurrency: 5 } });
	 * ```
	 */
	queue?: RezoQueue<any> | HttpQueue | QueueConfig | HttpQueueConfig;
	/**
	 * @deprecated Use `queue` instead
	 * Legacy queue options format
	 */
	queueOptions?: {
		enable: boolean;
		options?: queueOptions;
	};
	/** Request headers as various supported formats */
	headers?: RezoHttpRequest["headers"];
	/** Expected response data type */
	responseType?: ResponseType$1;
	/** Character encoding for the response */
	responseEncoding?: string;
	/** Basic authentication credentials */
	auth?: RezoHttpRequest["auth"];
	/** Request timeout in milliseconds */
	timeout?: number;
	/** @deprecated Use `timeout` instead */
	requestTimeout?: number;
	/** Whether to reject requests with invalid SSL certificates */
	rejectUnauthorized?: boolean;
	/** Retry configuration for failed requests */
	retry?: RezoHttpRequest["retry"];
	/** Whether to use a secure context for HTTPS requests */
	useSecureContext?: boolean;
	/** Custom secure context for TLS connections */
	secureContext?: RezoHttpRequest["secureContext"];
	/** Whether to automatically follow HTTP redirects */
	followRedirects?: boolean;
	/** Maximum number of redirects to follow */
	maxRedirects?: number;
	/** Whether to automatically decompress response data */
	decompress?: boolean;
	/** Whether to keep the connection alive for reuse */
	keepAlive?: boolean;
	/** Whether to detect and prevent redirect cycles */
	enableRedirectCycleDetection?: boolean;
	/** Whether to send cookies and authorization headers with cross-origin requests */
	withCredentials?: boolean;
	/** Proxy configuration (URL string or detailed options) */
	proxy?: RezoHttpRequest["proxy"];
	/** Maximum allowed size of the request body in bytes */
	maxBodyLength?: number;
	/** Maximum transfer rate (single number or [upload, download] tuple) */
	maxRate?: RezoHttpRequest["maxRate"];
	/**
   * Callback invoked when a redirect response is received.
   * Controls redirect behavior including whether to follow, modify URL, or change HTTP method.
   *
   * @param options - Redirect response details
   * @param options.url - Redirect target URL
   * @param options.status - HTTP status code
   * @param options.headers - Response headers
   * @param options.sameDomain - Whether redirect is to same domain
   * @returns Boolean to follow/reject redirect, or object for granular control
   *
   * @example
   * ```typescript
   * beforeRedirect: ({ status, url }) => {
   *   if (status === 301 || status === 302) {
   *     return true; // Follow permanent/temporary redirects
   *   } else if (status === 307 || status === 308) {
   *     return { redirect: true, url: url.toString() }; // Preserve method for 307/308
   *   } else if (status === 303) {
   *     return { redirect: true, url: url.toString(), method: 'GET' }; // Force GET for 303
   *   }
   *   return false; // Reject other redirects
   * }
   * ```
   */
	beforeRedirect?: RezoHttpRequest["beforeRedirect"];
	/** Alias for beforeRedirect */
	onRedirect?: RezoHttpRequest["onRedirect"];
	/** Array of functions to transform request data */
	transformRequest?: RezoHttpRequest["transformRequest"];
	/** Array of functions to transform response data */
	transformResponse?: RezoHttpRequest["transformResponse"];
	/** Browser simulation configuration for user agent spoofing */
	browser?: RezoHttpRequest["browser"];
	/** Enable debug logging for the request */
	debug?: RezoHttpRequest["debug"];
	/** Enable verbose logging with detailed information */
	verbose?: RezoHttpRequest["verbose"];
	/** Enable URL tracking to log redirect chain and retry attempts */
	trackUrl?: RezoHttpRequest["trackUrl"];
	/** HTTP agent for HTTP requests */
	httpAgent?: RezoHttpRequest["httpAgent"];
	/** HTTPS agent for HTTPS requests */
	httpsAgent?: RezoHttpRequest["httpsAgent"];
	/** Transitional options for backward compatibility */
	transitional?: RezoHttpRequest["transitional"];
	/** Character encoding for request body and response data */
	encoding?: BufferEncoding;
	/**
	 * Cache configuration for response and DNS caching
	 * - `true`: Enable default in-memory cache (fast, sensible defaults)
	 * - `{ response: {...}, dns: {...} }`: Fine-grained control
	 *
	 * Response cache defaults: 30 min TTL, 500 entries, GET/HEAD only
	 * DNS cache defaults: 1 min TTL, 1000 entries
	 */
	cache?: CacheOption;
	/**
	 * Proxy manager for advanced proxy rotation and pool management
	 * - Provide a `ProxyManager` instance for full control
	 * - Or provide `ProxyManagerConfig` to auto-create internally
	 *
	 * Note: ProxyManager overrides `proxy` option when set.
	 * Use `useProxyManager: false` per-request to bypass.
	 *
	 * @example
	 * ```typescript
	 * // With config (auto-creates ProxyManager)
	 * const client = new Rezo({
	 *   proxyManager: {
	 *     rotation: 'random',
	 *     proxies: [
	 *       { protocol: 'socks5', host: '127.0.0.1', port: 1080 },
	 *       { protocol: 'http', host: 'proxy.example.com', port: 8080 }
	 *     ],
	 *     whitelist: ['api.example.com'],
	 *     autoDisableDeadProxies: true
	 *   }
	 * });
	 *
	 * // With ProxyManager instance
	 * const pm = new ProxyManager({ rotation: 'sequential', proxies: [...] });
	 * const client = new Rezo({ proxyManager: pm });
	 * ```
	 */
	proxyManager?: ProxyManager | ProxyManagerConfig;
	/**
	 * Determines whether a given HTTP status code should be treated as successful.
	 * When a status code fails validation, the request throws an error.
	 *
	 * @default (status) => status >= 200 && status < 300
	 */
	validateStatus?: ((status: number) => boolean) | null;
	/**
	 * Custom function to serialize URL query parameters.
	 * Replaces the default serialization logic.
	 */
	paramsSerializer?: (params: Record<string, any>) => string;
	/**
	 * Custom DNS lookup function for hostname resolution.
	 * Replaces the default `dns.lookup` used by Node.js.
	 */
	dnsLookup?: RezoHttpRequest["dnsLookup"];
	/** Browser fingerprint stealth configuration (instance-level only) */
	stealth?: RezoStealth;
}
/**
 * Normalized retry configuration with all options resolved
 */
export interface NormalizedRetryConfig {
	/** Maximum number of retry attempts */
	maxRetries: number;
	/** Base delay between retries in milliseconds */
	retryDelay: number;
	/** Maximum delay cap in milliseconds */
	maxDelay: number;
	/** Backoff multiplier or function */
	backoff: number | "exponential" | "linear" | ((attempt: number, baseDelay: number) => number);
	/** HTTP status codes that trigger retry */
	statusCodes: number[];
	/** Whether to retry on timeout errors */
	retryOnTimeout: boolean;
	/** Whether to retry on network errors */
	retryOnNetworkError: boolean;
	/** HTTP methods that are safe to retry */
	methods: string[];
	/** Custom condition function */
	condition?: (error: any, attempt: number) => boolean | Promise<boolean>;
	/** Called before each retry */
	onRetry?: (error: any, attempt: number, delay: number) => boolean | void | Promise<boolean | void>;
	/** Called when all retries are exhausted */
	onRetryExhausted?: (error: any, totalAttempts: number) => void | Promise<void>;
}
/**
 * Configuration object that encapsulates comprehensive request execution metadata and response processing information.
 * This interface serves as the central configuration hub for HTTP requests, containing both input parameters
 * and execution tracking data throughout the request lifecycle.
 *
 * @interface RezoConfig
 * @since 1.0.0
 * @example
 * ```typescript
 * const config: RezoConfig = {
 *   originalRequest: requestConfig,
 *   finalUrl: 'https://api.example.com/data',
 *   adapterUsed: 'fetch',
 *   timing: { startTime: Date.now(), endTime: Date.now() + 1000, total: 1000 },
 *   network: { protocol: 'https' },
 *   transfer: { requestSize: 256, responseSize: 1024, headerSize: 128, bodySize: 896 },
 *   retryAttempts: 0,
 *   errors: [],
 *   security: {},
 *   metadata: {}
 * };
 * ```
 */
export interface RezoConfig {
	/** @description The target URL for the HTTP request */
	url: string;
	/** @description HTTP method (GET, POST, PUT, DELETE, etc.) */
	method: RezoRequestConfig["method"];
	/** @description HTTP headers to be sent with the request */
	headers: RezoHeaders;
	/** @description Request payload data (null when not set) */
	data?: RezoRequestConfig["body"] | null;
	/** @description URL query parameters */
	params?: RezoRequestConfig["params"];
	/** @description Request timeout in milliseconds (null when not set) */
	timeout?: number | null;
	/** @description Expected response data type */
	responseType?: "json" | "text" | "blob" | "arrayBuffer" | "stream" | "download" | "upload" | "buffer" | "binary";
	/** @description Basic authentication credentials (null when not set) */
	auth?: RezoRequestConfig["auth"] | null;
	/** @description Proxy configuration (null when not set) */
	proxy?: RezoRequestConfig["proxy"] | null;
	/** @description Maximum number of redirects to follow */
	maxRedirects: number;
	/** @description Base URL for relative requests */
	baseURL?: string;
	/** @description Enable HTTP/2 protocol */
	http2: boolean;
	/** @description Enable cURL command generation */
	curl: boolean;
	/** @description Enable detection of redirect cycles */
	enableRedirectCycleDetection?: boolean;
	/** @description Reject unauthorized SSL certificates */
	rejectUnauthorized?: boolean;
	/** @description Normalized retry configuration (null if retries disabled) */
	retry?: NormalizedRetryConfig | null;
	/** @description Compression settings */
	compression?: {
		/** @description Enable compression */
		enabled?: boolean;
		/** @description Compression threshold in bytes */
		threshold?: number;
		/** @description Supported compression algorithms */
		algorithms?: string[];
	};
	/**
	 * @description Disable cookie jar for session management.
	 * When false (default), cookies are automatically managed.
	 * Set to true to disable automatic cookie handling.
	 * @default false
	 */
	disableJar?: boolean;
	/** @description Send cookies with cross-origin requests. Default: false */
	withCredentials?: boolean;
	/** @description Feature flags for adapter capabilities */
	features?: {
		/** @description HTTP/2 support */
		http2?: boolean;
		/** @description Compression support */
		compression?: boolean;
		/** @description Cookie support */
		cookies?: boolean;
		/** @description Redirect support */
		redirects?: boolean;
		/** @description Proxy support */
		proxy?: boolean;
		/** @description Timeout support */
		timeout?: boolean;
		/** @description Retry support */
		retry?: boolean;
		/** @description Cache support */
		cache?: boolean;
		/** @description Metrics support */
		metrics?: boolean;
		/** @description Event support */
		events?: boolean;
		/** @description Validation support */
		validation?: boolean;
		/** @description Browser support */
		browser?: boolean;
		/** @description SSL support */
		ssl?: boolean;
	};
	/** @description Use insecure HTTP parser */
	insecureHTTPParser: boolean;
	/** @description Custom adapter implementation */
	adapter?: any;
	isSecure?: boolean;
	/**
	 * @description Rate limiting for network transfer speed (bandwidth throttling)
	 *
	 * Controls the maximum transfer speed in bytes per second.
	 *
	 * - `number`: Applies same limit to both download and upload (e.g., 1024000 = ~1MB/s)
	 * - `[download, upload]`: Different limits for each direction (e.g., [5242880, 1048576] = 5MB/s down, 1MB/s up)
	 * - `0` or `null`: No rate limiting (unlimited speed)
	 *
	 * Common values:
	 * - 1048576 = 1 MB/s
	 * - 5242880 = 5 MB/s
	 * - 10485760 = 10 MB/s
	 *
	 * Note: Actual transfer speed may vary based on network conditions and adapter support.
	 * This feature is adapter-dependent (HTTP adapter supports it, other adapters may vary).
	 */
	maxRate: number | [
		number,
		number
	];
	/** @description Cancellation token for request abortion (null when not set) */
	cancelToken?: any | null;
	/** @description AbortSignal for request cancellation (null when not set) */
	signal?: AbortSignal | null;
	/** @description Function to set the AbortSignal */
	setSignal: () => void;
	/** @description HTTP agent for connection pooling (null when not set) */
	httpAgent?: RezoRequestConfig["httpAgent"] | null;
	/** @description HTTPS agent for secure connection pooling (null when not set) */
	httpsAgent?: RezoRequestConfig["httpsAgent"] | null;
	/** @description Unix socket path (null when not set) */
	socketPath?: string | null;
	/** @description File path to save the response (null when not set) */
	fileName?: string | null;
	/**
	 * Array of cookies to be sent with the request.
	 * These cookies are configured before the request is made and will be included in the request headers.
	 */
	requestCookies: Cookie[];
	/**
	 * Cookies received from the server in the response.
	 * These cookies are parsed from the 'Set-Cookie' response headers and can be used for subsequent requests
	 * or session management. Contains multiple formats: array, serialized, netscape, string, setCookiesString.
	 */
	responseCookies: Cookies;
	/**
	 * Path to cookie file for persistence (null when not configured).
	 * - .json files save cookies as serialized JSON
	 * - .txt files save cookies in Netscape format
	 */
	cookieFile?: string | null;
	/**
	 * Request lifecycle hooks for intercepting and modifying request/response behavior.
	 * null when no hooks are registered, otherwise contains only hooks with registered functions.
	 * Empty arrays are not included - only hooks with actual handlers appear.
	 *
	 * Available hooks:
	 * - init: During options initialization
	 * - beforeRequest: Before request is sent
	 * - beforeRedirect: Before following redirects
	 * - beforeRetry: Before retry attempts
	 * - afterResponse: After response is received
	 * - beforeError: Before error is thrown
	 * - beforeCache: Before caching response
	 * - afterHeaders: When headers are received
	 * - afterParse: After body is parsed
	 * - beforeCookie/afterCookie: Cookie lifecycle
	 * - onSocket/onDns/onTls/onTimeout/onAbort: Low-level events
	 */
	hooks: Partial<RezoHooks> | null;
	/** @description Snapshot of the original request configuration */
	originalRequest: RezoRequestConfig;
	/** @description Original request body, preserved for POST body retention during redirects */
	originalBody?: RezoRequestConfig["body"];
	/** @description Final resolved URL after redirects and processing */
	finalUrl: string;
	/** @description HTTP adapter used for the request */
	adapterUsed: "http" | "https" | "http2" | "fetch" | "xhr" | "curl" | "react-native";
	/** @description Metadata about the adapter used */
	adapterMetadata?: {
		/** @description Adapter version */
		version?: string;
		/** @description Supported features */
		features?: string[];
		/** @description Adapter capabilities */
		capabilities?: Record<string, any>;
	};
	/** @description Complete redirect chain history */
	redirectHistory: {
		/** @description Cookies set in this redirect */
		cookies: Cookie[];
		/** @description Redirect URL */
		url: string;
		/** @description HTTP status code */
		statusCode: number;
		/** @description HTTP status text */
		statusText: string;
		/** @description Response headers */
		headers: RezoHeaders;
		/** @description Redirect timestamp */
		duration: number;
		/** @description Request configuration at this step */
		request: RezoRequestConfig;
		/** @description HTTP method used */
		method: string;
	}[];
	/** @description Number of redirects followed */
	redirectCount: number;
	/** @description Whether maximum redirects limit was reached */
	maxRedirectsReached: boolean;
	/**
	 * @description Cookie jar instance for session management
	 * Full RezoCookieJar class with all methods available:
	 * - cookies(): Get all cookies in the jar
	 * - setCookiesSync(cookies, url): Set cookies from Set-Cookie headers
	 * - getCookiesSync(url): Get cookies for a URL
	 * - removeAllCookiesSync(): Clear all cookies
	 */
	jar: RezoCookieJar;
	/** @description Comprehensive timing information (matches PerformanceResourceTiming API) */
	timing: {
		/** @description Request start timestamp (performance.now() value when request began) */
		startTime: number;
		/** @description Timestamp when DNS lookup started */
		domainLookupStart: number;
		/** @description Timestamp when DNS lookup ended */
		domainLookupEnd: number;
		/** @description Timestamp when connection started */
		connectStart: number;
		/** @description Timestamp when TLS handshake started (0 for HTTP) */
		secureConnectionStart: number;
		/** @description Timestamp when connection completed */
		connectEnd: number;
		/** @description Timestamp when request was sent */
		requestStart: number;
		/** @description Timestamp when first byte of response received */
		responseStart: number;
		/** @description Timestamp when response completed */
		responseEnd: number;
	};
	/** @description Network connection information */
	network: {
		/** @description Local IP address */
		localAddress?: string;
		/** @description Local port number */
		localPort?: number;
		/** @description Remote IP address */
		remoteAddress?: string;
		/** @description Remote port number */
		remotePort?: number;
		/** @description Protocol used (http/https) */
		protocol: string;
		/** @description HTTP version (1.1, 2.0, etc.) */
		httpVersion?: string;
		/** @description IP family preference (4 for IPv4, 6 for IPv6) */
		family?: 4 | 6;
		/** @description Custom DNS lookup function */
		lookup?: any;
	};
	/** @description Data transfer statistics */
	transfer: {
		/** @description Total request size in bytes (headers + body) */
		requestSize: number;
		/** @description Request headers size in bytes */
		requestHeaderSize?: number;
		/** @description Request body size in bytes */
		requestBodySize?: number;
		/** @description Total response size in bytes (headers + body) */
		responseSize: number;
		/** @description Response headers size in bytes */
		headerSize: number;
		/** @description Response body size in bytes */
		bodySize: number;
		/** @description Compression ratio if applicable */
		compressionRatio?: number;
	};
	/** @description Number of retry attempts made */
	retryAttempts: number;
	/** @description Error history during request execution */
	errors: Array<{
		/** @description Retry attempt number */
		attempt: number;
		/** @description Error message */
		error: RezoError;
		/** @description Request duration before error */
		duration: number;
	}>;
	/** @description Security and validation information */
	security: {
		/** @description TLS version used */
		tlsVersion?: string;
		/** @description Cipher suite used */
		cipher?: string;
		/** @description Certificate information */
		certificateInfo?: Record<string, any>;
		/** @description Validation results */
		validationResults?: Record<string, boolean>;
	};
	/** @description Debug mode flag */
	debug?: boolean;
	/** @description URL tracking mode flag - logs redirect chain and retries */
	trackUrl?: boolean;
	/** @description Request tracking identifier */
	requestId: string;
	/** @description Session identifier */
	sessionId?: string;
	/** @description Distributed tracing identifier */
	traceId?: string;
	/** @description Request timestamp */
	timestamp: number;
	/** @description Additional tracking data */
	trackingData?: Record<string, unknown>;
	/**
	 * Callback invoked when a redirect response is received.
	 * Controls redirect behavior including whether to follow, modify URL, or change HTTP method.
	 *
	 * @param options - Redirect response details
	 * @param options.url - Redirect target URL
	 * @param options.status - HTTP status code
	 * @param options.headers - Response headers
	 * @param options.sameDomain - Whether redirect is to same domain
	 * @returns Boolean to follow/reject redirect, or object for granular control
	 *
	 * @example
	 * ```typescript
	 * beforeRedirect: ({ status, url }) => {
	 *   if (status === 301 || status === 302) {
	 *     return true; // Follow permanent/temporary redirects
	 *   } else if (status === 307 || status === 308) {
	 *     return { redirect: true, url: url.toString() }; // Preserve method for 307/308
	 *   } else if (status === 303) {
	 *     return { redirect: true, url: url.toString(), method: 'GET' }; // Force GET for 303
	 *   }
	 *   return false; // Reject other redirects
	 * }
	 * ```
	 */
	beforeRedirect?: RezoRequestConfig["beforeRedirect"];
	/** Alias for beforeRedirect */
	onRedirect?: RezoRequestConfig["beforeRedirect"];
	/** Character encoding for request body and response data */
	encoding?: BufferEncoding;
	/**
	 * Determines whether a given HTTP status code should be treated as successful.
	 * Used by adapters to decide if a response is an error.
	 * @default (status) => status >= 200 && status < 300
	 */
	validateStatus?: ((status: number) => boolean) | null;
	/**
	 * Custom DNS lookup function for hostname resolution.
	 */
	dnsLookup?: (hostname: string, options: any, callback: (err: Error | null, address: string, family: number) => void) => void;
	/**
	 * Whether to use cookies for the request
	 */
	useCookies: boolean;
}
declare enum RezoErrorCode {
	CONNECTION_REFUSED = "ECONNREFUSED",
	CONNECTION_RESET = "ECONNRESET",
	CONNECTION_ABORTED = "ECONNABORTED",
	CONNECTION_TIMEOUT = "ETIMEDOUT",
	SOCKET_TIMEOUT = "ESOCKETTIMEDOUT",
	DNS_LOOKUP_FAILED = "ENOTFOUND",
	DNS_TEMPORARY_FAILURE = "EAI_AGAIN",
	HOST_UNREACHABLE = "EHOSTUNREACH",
	NETWORK_UNREACHABLE = "ENETUNREACH",
	BROKEN_PIPE = "EPIPE",
	HTTP_ERROR = "REZ_HTTP_ERROR",
	REDIRECT_DENIED = "REZ_REDIRECT_DENIED",
	MAX_REDIRECTS = "REZ_MAX_REDIRECTS_EXCEEDED",
	REDIRECT_CYCLE = "REZ_REDIRECT_CYCLE_DETECTED",
	MISSING_REDIRECT_LOCATION = "REZ_MISSING_REDIRECT_LOCATION",
	DECOMPRESSION_ERROR = "REZ_DECOMPRESSION_ERROR",
	HEADERS_ALREADY_SENT = "ERR_HTTP_HEADERS_SENT",
	REQUEST_TIMEOUT = "UND_ERR_REQUEST_TIMEOUT",
	HEADERS_TIMEOUT = "UND_ERR_HEADERS_TIMEOUT",
	CONNECT_TIMEOUT = "UND_ERR_CONNECT_TIMEOUT",
	ABORTED = "ABORT_ERR",
	ABORTED_UNDICI = "UND_ERR_ABORTED",
	ABORTED_ERR = "ERR_ABORTED",
	DOWNLOAD_FAILED = "REZ_DOWNLOAD_FAILED",
	UPLOAD_FAILED = "REZ_UPLOAD_FAILED",
	STREAM_ERROR = "REZ_STREAM_ERROR",
	STREAM_DESTROYED = "ERR_STREAM_DESTROYED",
	STREAM_PREMATURE_CLOSE = "ERR_STREAM_PREMATURE_CLOSE",
	BODY_TOO_LARGE = "REZ_BODY_TOO_LARGE",
	RESPONSE_TOO_LARGE = "REZ_RESPONSE_TOO_LARGE",
	INVALID_JSON = "REZ_INVALID_JSON",
	INVALID_URL = "ERR_INVALID_URL",
	INVALID_PROTOCOL = "ERR_INVALID_PROTOCOL",
	INVALID_ARGUMENT = "ERR_INVALID_ARG_TYPE",
	FILE_PERMISSION = "REZ_FILE_PERMISSION_ERROR",
	PROXY_CONNECTION_FAILED = "REZ_PROXY_CONNECTION_FAILED",
	PROXY_AUTH_FAILED = "REZ_PROXY_AUTHENTICATION_FAILED",
	PROXY_TARGET_UNREACHABLE = "REZ_PROXY_TARGET_UNREACHABLE",
	PROXY_TIMEOUT = "REZ_PROXY_TIMEOUT",
	PROXY_ERROR = "REZ_PROXY_ERROR",
	PROXY_INVALID_PROTOCOL = "REZ_PROXY_INVALID_PROTOCOL",
	PROXY_INVALID_CONFIG = "REZ_PROXY_INVALID_HOSTPORT",
	SOCKS_CONNECTION_FAILED = "REZ_SOCKS_CONNECTION_FAILED",
	SOCKS_AUTH_FAILED = "REZ_SOCKS_AUTHENTICATION_FAILED",
	SOCKS_TARGET_UNREACHABLE = "REZ_SOCKS_TARGET_CONNECTION_FAILED",
	SOCKS_PROTOCOL_ERROR = "REZ_SOCKS_PROTOCOL_ERROR",
	SOCKS_UNSUPPORTED_VERSION = "REZ_SOCKS_UNSUPPORTED_VERSION",
	TLS_HANDSHAKE_TIMEOUT = "ERR_TLS_HANDSHAKE_TIMEOUT",
	TLS_PROTOCOL_ERROR = "EPROTO",
	TLS_PROTOCOL_VERSION = "ERR_TLS_INVALID_PROTOCOL_VERSION",
	TLS_RENEGOTIATION_DISABLED = "ERR_TLS_RENEGOTIATION_DISABLED",
	TLS_CERT_SIGNATURE_UNSUPPORTED = "ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED",
	CERTIFICATE_HOSTNAME_MISMATCH = "ERR_TLS_CERT_ALTNAME_INVALID",
	CERTIFICATE_EXPIRED = "CERT_HAS_EXPIRED",
	CERTIFICATE_SELF_SIGNED = "SELF_SIGNED_CERT_IN_CHAIN",
	CERTIFICATE_SELF_SIGNED_NO_CHAIN = "DEPTH_ZERO_SELF_SIGNED_CERT",
	CERTIFICATE_VERIFY_FAILED = "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	UNDICI_SOCKET_ERROR = "UND_ERR_SOCKET",
	UNDICI_INVALID_INFO = "UND_ERR_INFO",
	NO_PROXY_AVAILABLE = "REZ_NO_PROXY_AVAILABLE",
	RATE_LIMITED = "REZ_RATE_LIMITED",
	UNKNOWN_ERROR = "REZ_UNKNOWN_ERROR"
}
/**
 * Union of all known Rezo error code strings.
 *
 * Provides full IDE autocomplete on `e.code` while still accepting
 * unknown OS/runtime error codes via `(string & {})`.
 *
 * @example
 * ```typescript
 * catch (e) {
 *   if (e instanceof RezoError) {
 *     if (e.code === 'ECONNREFUSED') { ... }  // autocompletes
 *     if (e.code === RezoErrorCode.CONNECTION_REFUSED) { ... }  // also works
 *   }
 * }
 * ```
 */
export type RezoErrorCodeString = `${RezoErrorCode}` | (string & {});
declare class RezoError<T = any> extends Error {
	readonly code?: RezoErrorCodeString;
	readonly errno?: number;
	readonly config: RezoConfig;
	readonly request?: RezoHttpRequest;
	readonly response?: RezoResponse<T>;
	readonly isRezoError: boolean;
	readonly cause?: Error;
	readonly syscall?: string;
	readonly hostname?: string;
	readonly port?: number;
	readonly address?: string;
	readonly status?: number;
	readonly statusText?: string;
	readonly isTimeout: boolean;
	readonly isAborted: boolean;
	readonly isNetworkError: boolean;
	readonly isHttpError: boolean;
	readonly isProxyError: boolean;
	readonly isSocksError: boolean;
	readonly isTlsError: boolean;
	readonly isRetryable: boolean;
	readonly suggestion: string;
	constructor(message: string, config: RezoConfig, code?: RezoErrorCodeString, request?: RezoHttpRequest, response?: RezoResponse<T>);
	static isRezoError(error: unknown): error is RezoError;
	static fromError<T = any>(error: Error, config: RezoConfig, request?: RezoHttpRequest, response?: RezoResponse<T>): RezoError<T>;
	static createNetworkError<T = any>(message: string, code: RezoErrorCodeString, config: RezoConfig, request?: RezoHttpRequest): RezoError<T>;
	static createHttpError<T = any>(statusCode: number, config: RezoConfig, request?: RezoHttpRequest, response?: RezoResponse<T>): RezoError<T>;
	static createTimeoutError<T = any>(message: string, config: RezoConfig, request?: RezoHttpRequest): RezoError<T>;
	static createAbortError<T = any>(message: string, config: RezoConfig, request?: RezoHttpRequest): RezoError<T>;
	static createParsingError<T = any>(message: string, config: RezoConfig, request?: RezoHttpRequest): RezoError<T>;
	static createEnvironmentError<T = any>(message: string, config: RezoConfig): RezoError<T>;
	static createDecompressionError<T = any>(message: string, config: RezoConfig, request?: RezoHttpRequest, response?: RezoResponse<T>): RezoError<T>;
	static createDownloadError<T = any>(message: string, config: RezoConfig, request?: RezoHttpRequest, response?: RezoResponse<T>): RezoError<T>;
	static createUploadError<T = any>(message: string, config: RezoConfig, request?: RezoHttpRequest, response?: RezoResponse<T>): RezoError<T>;
	static createStreamError<T = any>(message: string, config: RezoConfig, request?: RezoHttpRequest, response?: RezoResponse<T>): RezoError<T>;
	static createRedirectError<T = any>(message: string, config: RezoConfig, request?: RezoHttpRequest, response?: RezoResponse<T>): RezoError<T>;
	static createProxyError<T = any>(code: RezoErrorCodeString, config: RezoConfig, request?: RezoHttpRequest): RezoError<T>;
	static createSocksError<T = any>(code: RezoErrorCodeString, config: RezoConfig, request?: RezoHttpRequest): RezoError<T>;
	static createTlsError<T = any>(code: RezoErrorCodeString, config: RezoConfig, request?: RezoHttpRequest): RezoError<T>;
	static createRateLimitError<T = any>(config: RezoConfig, request?: RezoHttpRequest, response?: RezoResponse<T>): RezoError<T>;
	/**
	 * Convert error to JSON - only includes defined values
	 */
	toJSON(): Record<string, unknown>;
	toString(): string;
	getFullDetails(): string;
}
type ProxyProtocol$1 = "http" | "https" | "socks4" | "socks5";
/**
 * Configuration options for proxy connections
 */
export type ProxyOptions = {
	/** The proxy protocol to use */
	protocol: ProxyProtocol$1;
	/** Proxy server hostname or IP address */
	host: string;
	/** Proxy server port number */
	port: number;
	/** Optional authentication credentials for the proxy */
	auth?: {
		/** Username for proxy authentication */
		username: string;
		/** Password for proxy authentication */
		password: string;
	};
	/** Connection timeout in milliseconds */
	timeout?: number;
	/** Whether to keep the connection alive */
	keepAlive?: boolean;
	/** Keep-alive timeout in milliseconds */
	keepAliveMsecs?: number;
	/** Maximum number of sockets to allow per host */
	maxSockets?: number;
	/** Maximum number of free sockets to keep open per host */
	maxFreeSockets?: number;
	/** Whether to reject unauthorized SSL certificates */
	rejectUnauthorized?: boolean;
};
/**
 * Maximum upload rate in bytes per second
 */
export type MaxUploadRate = number;
/**
 * Maximum download rate in bytes per second
 */
export type MaxDownloadRate = number;
/**
 * Custom string type for Rezo-specific string values
 */
export type RezoString = string;
/**
 * Standard HTTP methods supported by Rezo
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS" | "TRACE" | "CONNECT";
type ResponseType$1 = "json" | "text" | "blob" | "arrayBuffer" | "buffer" | "auto";
/**
 * MIME content types for request/response bodies
 */
export type ContentType = "application/json" | "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain" | "text/html" | "application/xml" | "application/octet-stream" | RezoString;
/**
 * RezoRequestConfig - Clean interface for internal request processing
 *
 * @template D - Type of the request body data
 */
export interface RezoRequestConfig<D = any> {
	/** The target URL for the request */
	url: string | URL;
	/** Optional React Native integrations for this request */
	reactNative?: RezoReactNativeOptions;
	/**
	 * The absolute request url
	 */
	fullUrl: string;
	/** Request method to use for the request */
	method: HttpMethod;
	/** Request headers as various supported formats */
	headers?: [
		string,
		string
	][] | Record<string, string> | Headers | RezoHttpHeaders | RezoHeaders | OutgoingHttpHeaders;
	/** URL query parameters to append to the request */
	params?: Record<string | number, any>;
	/**
	 * Queue to use for request execution
	 */
	queue?: RezoQueue | null;
	/**
	 * Controls how the response body is parsed and returned in `response.data`.
	 *
	 * **Available Types:**
	 * - `'json'` - Parse as JSON object/array. Best for REST APIs.
	 * - `'text'` - Return as string. Best for HTML, XML, plain text.
	 * - `'blob'` - Return as Blob (browser). Best for binary in browsers.
	 * - `'arrayBuffer'` - Return as ArrayBuffer. Best for binary processing.
	 * - `'buffer'` - Return as Buffer (Node.js). Best for binary in Node.
	 * - `'auto'` - Auto-detect from Content-Type header (default).
	 *
	 * **For streaming, use dedicated methods instead:**
	 * - `rezo.stream(url)` - Real-time streaming data
	 * - `rezo.download(url, saveTo)` - Download with progress
	 * - `rezo.upload(url, data)` - Upload with progress
	 *
	 * @default 'auto'
	 * @example
	 * // Get JSON
	 * const { data } = await rezo.get('/api/users', { responseType: 'json' });
	 *
	 * // Get HTML as text
	 * const { data: html } = await rezo.get('/page', { responseType: 'text' });
	 *
	 * // Get image as buffer
	 * const { data: img } = await rezo.get('/image.png', { responseType: 'buffer' });
	 */
	responseType?: ResponseType$1;
	/** Character encoding for the response */
	responseEncoding?: string;
	/** Base URL for the request (used with relative URLs) */
	baseURL?: string;
	/** Raw request body data */
	body?: D;
	/** JSON object to be serialized as request body */
	json?: Record<string, any>;
	/** Form data to be URL-encoded */
	form?: Record<string, any>;
	/** Form data for multipart/form-data requests */
	formData?: Record<string, any> | RezoFormData;
	/** Multipart data (alias for formData) */
	multipart?: Record<string, any> | RezoFormData;
	/** Whether to detect and prevent redirect cycles */
	enableRedirectCycleDetection?: boolean;
	/** MIME type for the request content */
	contentType?: ContentType | string;
	/** Skip setting Content-Type header automatically */
	withoutContentType?: boolean;
	/** Basic authentication credentials */
	auth?: {
		/** Username for authentication */
		username: string;
		/** Password for authentication */
		password: string;
	};
	/** Request timeout in milliseconds */
	timeout?: number;
	/** Whether to reject requests with invalid SSL certificates */
	rejectUnauthorized?: boolean;
	/**
	 * Retry configuration for failed requests.
	 *
	 * Supports multiple configuration styles:
	 * - Simple: `retry: 3` (retry up to 3 times)
	 * - Boolean: `retry: true` (use default retry settings)
	 * - Object: `retry: { limit: 3, delay: 1000, backoff: 2 }`
	 *
	 * @example
	 * ```typescript
	 * // Simple retry count
	 * await rezo.get(url, { retry: 3 });
	 *
	 * // Full configuration
	 * await rezo.get(url, {
	 *   retry: {
	 *     limit: 5,
	 *     delay: 1000,
	 *     backoff: 2,
	 *     retryOn: [408, 429, 500, 502, 503, 504],
	 *     retryOnTimeout: true,
	 *     retryOnNetworkError: true,
	 *     methods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']
	 *   }
	 * });
	 * ```
	 */
	retry?: boolean | number | {
		/**
		 * Maximum number of retry attempts
		 * @alias limit
		 */
		maxRetries?: number;
		/**
		 * Maximum number of retry attempts (alias for maxRetries)
		 * @alias maxRetries
		 */
		limit?: number;
		/**
		 * Base delay between retries in milliseconds
		 * @alias delay
		 * @default 1000
		 */
		retryDelay?: number;
		/**
		 * Base delay between retries in milliseconds (alias for retryDelay)
		 * @alias retryDelay
		 * @default 1000
		 */
		delay?: number;
		/**
		 * Whether to increment delay on each retry (deprecated, use backoff instead)
		 * @deprecated Use `backoff` instead for exponential backoff
		 */
		incrementDelay?: boolean;
		/**
		 * Backoff multiplier for exponential delay increase.
		 * - Number: multiply delay by this value on each retry (e.g., 2 = 1s, 2s, 4s, 8s...)
		 * - 'exponential': same as 2
		 * - 'linear': add base delay each time (1s, 2s, 3s, 4s...)
		 * - Function: custom backoff (attempt: number) => delay in ms
		 *
		 * @example
		 * ```typescript
		 * // Exponential: 1s, 2s, 4s, 8s...
		 * backoff: 2
		 *
		 * // More aggressive: 1s, 3s, 9s, 27s...
		 * backoff: 3
		 *
		 * // Linear: 1s, 2s, 3s, 4s...
		 * backoff: 'linear'
		 *
		 * // Custom function
		 * backoff: (attempt) => Math.min(attempt * 1000, 30000)
		 * ```
		 *
		 * @default 1 (no backoff, constant delay)
		 */
		backoff?: number | "exponential" | "linear" | ((attempt: number, baseDelay: number) => number);
		/**
		 * Maximum delay between retries in milliseconds.
		 * Caps the delay even when using exponential backoff.
		 *
		 * @default 30000 (30 seconds)
		 */
		maxDelay?: number;
		/**
		 * HTTP status codes that should trigger a retry attempt
		 * @alias retryOn
		 * @default [408, 425, 429, 500, 502, 503, 504, 520]
		 */
		statusCodes?: number[];
		/**
		 * HTTP status codes that should trigger a retry attempt (alias for statusCodes)
		 * @alias statusCodes
		 * @default [408, 425, 429, 500, 502, 503, 504, 520]
		 */
		retryOn?: number[];
		/**
		 * Retry on timeout errors (ETIMEDOUT, ECONNABORTED)
		 * @default true
		 */
		retryOnTimeout?: boolean;
		/**
		 * Retry on network errors (ECONNREFUSED, ECONNRESET, ENOTFOUND, etc.)
		 * @default true
		 */
		retryOnNetworkError?: boolean;
		/**
		 * HTTP methods that are safe to retry.
		 * Non-idempotent methods like POST are excluded by default to prevent duplicate submissions.
		 *
		 * @default ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']
		 */
		methods?: HttpMethod[];
		/**
		 * Custom condition to determine if retry should occur.
		 * Return true to retry, false to stop retrying.
		 * Called after checking status codes and error types.
		 */
		condition?: (error: RezoError, attempt: number) => boolean | Promise<boolean>;
		/**
		 * Called before each retry attempt. Can be used for logging or modifying retry behavior.
		 * Return false to cancel the retry.
		 */
		onRetry?: (error: RezoError, attempt: number, delay: number) => boolean | void | Promise<boolean | void>;
		/**
		 * Called when all retry attempts are exhausted.
		 */
		onRetryExhausted?: (error: RezoError, totalAttempts: number) => void | Promise<void>;
	};
	/**
	 * Rate limit wait configuration - wait and retry when receiving rate limit responses.
	 *
	 * This feature runs BEFORE the retry system. When a rate-limiting status code is received,
	 * the client will wait for the specified time and automatically retry the request.
	 *
	 * **Basic Usage:**
	 * - `waitOnStatus: true` - Enable waiting on 429 status (default behavior)
	 * - `waitOnStatus: [429, 503]` - Enable waiting on specific status codes
	 *
	 * **Wait Time Sources:**
	 * - `'retry-after'` - Use standard Retry-After header (default)
	 * - `{ header: 'X-RateLimit-Reset' }` - Use custom header
	 * - `{ body: 'retry_after' }` - Extract from JSON response body
	 * - Custom function for complex logic
	 *
	 * @example
	 * ```typescript
	 * // Wait on 429 using Retry-After header
	 * await rezo.get(url, { waitOnStatus: true });
	 *
	 * // Wait on 429 using custom header
	 * await rezo.get(url, {
	 *   waitOnStatus: true,
	 *   waitTimeSource: { header: 'X-RateLimit-Reset' }
	 * });
	 *
	 * // Wait on 429 extracting time from JSON body
	 * await rezo.get(url, {
	 *   waitOnStatus: true,
	 *   waitTimeSource: { body: 'data.retry_after' }
	 * });
	 *
	 * // Custom function for complex APIs
	 * await rezo.get(url, {
	 *   waitOnStatus: [429, 503],
	 *   waitTimeSource: (response) => {
	 *     const reset = response.headers.get('x-ratelimit-reset');
	 *     return reset ? parseInt(reset) - Math.floor(Date.now() / 1000) : null;
	 *   }
	 * });
	 * ```
	 */
	waitOnStatus?: boolean | number[];
	/**
	 * Where to extract the wait time from when rate-limited.
	 *
	 * - `'retry-after'` - Standard Retry-After header (default)
	 * - `{ header: string }` - Custom header name (e.g., 'X-RateLimit-Reset')
	 * - `{ body: string }` - JSON path in response body (e.g., 'data.retry_after', 'wait_seconds')
	 * - Function - Custom logic receiving the response, return seconds to wait or null
	 *
	 * @default 'retry-after'
	 */
	waitTimeSource?: "retry-after" | {
		header: string;
	} | {
		body: string;
	} | ((response: {
		status: number;
		headers: RezoHeaders;
		data?: any;
	}) => number | null);
	/**
	 * Maximum time to wait for rate limit in milliseconds.
	 * If the extracted wait time exceeds this, the request will fail instead of waiting.
	 * Set to 0 for unlimited wait time.
	 *
	 * @default 60000 (60 seconds)
	 */
	maxWaitTime?: number;
	/**
	 * Default wait time in milliseconds if the wait time source returns nothing.
	 * Used as fallback when Retry-After header or body path is not present.
	 *
	 * @default 1000 (1 second)
	 */
	defaultWaitTime?: number;
	/**
	 * Maximum number of wait attempts before giving up.
	 * After this many waits, the request will proceed to retry logic or fail.
	 *
	 * @default 3
	 */
	maxWaitAttempts?: number;
	/** Whether to use a secure context for HTTPS requests */
	useSecureContext?: boolean;
	/** Custom secure context for TLS connections */
	secureContext?: SecureContext;
	/** Whether to automatically follow HTTP redirects */
	followRedirects?: boolean;
	/** Maximum number of redirects to follow */
	maxRedirects?: number;
	/** Whether to automatically decompress response data */
	decompress?: boolean;
	/**
	 * Whether to keep TCP connections alive for reuse across multiple requests.
	 *
	 * When enabled, the underlying TCP connection is kept open after a request completes,
	 * allowing subsequent requests to the same host to reuse the connection. This reduces
	 * latency by avoiding the overhead of establishing new connections (TCP handshake,
	 * TLS negotiation for HTTPS).
	 *
	 * **Behavior:**
	 * - `false` (default) - Connection closes after each request. Process exits immediately.
	 * - `true` - Connection stays open for reuse. Idle connections close after `keepAliveMsecs`.
	 *
	 * **When to use `keepAlive: true`:**
	 * - Making multiple requests to the same host in sequence
	 * - Long-running applications (servers, bots, scrapers)
	 * - Performance-critical applications where connection overhead matters
	 *
	 * **When to use `keepAlive: false` (default):**
	 * - Single requests or scripts that should exit immediately
	 * - CLI tools that make one-off requests
	 * - When you need predictable process termination
	 *
	 * @example
	 * ```typescript
	 * // Default: process exits immediately after request
	 * const { data } = await rezo.get('https://api.example.com/data');
	 *
	 * // Keep connection alive for 1 minute (default) for subsequent requests
	 * const client = new Rezo({ keepAlive: true });
	 * await client.get('https://api.example.com/users');
	 * await client.get('https://api.example.com/posts'); // Reuses connection
	 *
	 * // Custom keep-alive timeout (30 seconds)
	 * const client = new Rezo({ keepAlive: true, keepAliveMsecs: 30000 });
	 * ```
	 *
	 * @default false
	 */
	keepAlive?: boolean;
	/**
	 * How long to keep idle connections alive in milliseconds.
	 *
	 * Only applies when `keepAlive: true`. After this duration of inactivity,
	 * the connection is closed automatically. This prevents resource leaks
	 * from connections that are no longer needed.
	 *
	 * **Note:** Even with keep-alive enabled, the Node.js process can still exit
	 * cleanly when there's no other work to do, thanks to socket unreferencing.
	 *
	 * @example
	 * ```typescript
	 * // Keep connections alive for 30 seconds
	 * const client = new Rezo({
	 *   keepAlive: true,
	 *   keepAliveMsecs: 30000
	 * });
	 *
	 * // Keep connections alive for 2 minutes
	 * const client = new Rezo({
	 *   keepAlive: true,
	 *   keepAliveMsecs: 120000
	 * });
	 * ```
	 *
	 * @default 60000 (1 minute)
	 */
	keepAliveMsecs?: number;
	withoutBodyOnRedirect?: boolean;
	autoSetReferer?: boolean;
	autoSetOrigin?: boolean;
	treat302As303?: boolean;
	startNewRequest?: boolean;
	/**
	 * DNS cache configuration for faster repeated requests.
	 *
	 * When enabled, DNS lookups are cached to avoid repeated DNS queries
	 * for the same hostname, significantly improving performance for
	 * applications making many requests to the same servers.
	 *
	 * **Options:**
	 * - `true` - Enable with default settings (1 min TTL, 1000 entries max)
	 * - `false` - Disable DNS caching (default)
	 * - `object` - Custom configuration with ttl and maxEntries
	 *
	 * @example
	 * // Enable with defaults
	 * { dnsCache: true }
	 *
	 * // Custom TTL (5 minutes) and max entries
	 * { dnsCache: { ttl: 300000, maxEntries: 500 } }
	 *
	 * @default false
	 */
	dnsCache?: boolean | {
		/** Time-to-live for cached entries in milliseconds */
		ttl?: number;
		/** Maximum number of entries to cache */
		maxEntries?: number;
	};
	/**
	 * Response cache configuration for caching HTTP responses.
	 *
	 * When enabled, successful GET/HEAD responses are cached to avoid
	 * repeated network requests. Supports memory-only or file persistence.
	 * Honors Cache-Control headers by default.
	 *
	 * **Options:**
	 * - `true` - Enable memory cache with defaults (5 min TTL, 500 entries)
	 * - `false` - Disable response caching (default)
	 * - `object` - Custom configuration
	 *
	 * **Cache-Control Support:**
	 * - Respects `max-age`, `s-maxage`, `no-store`, `no-cache`
	 * - Sends `If-None-Match` / `If-Modified-Since` for revalidation
	 * - Returns cached response on 304 Not Modified
	 *
	 * @example
	 * // Enable memory-only cache
	 * { cache: true }
	 *
	 * // With file persistence
	 * { cache: { cacheDir: './cache', ttl: 300000 } }
	 *
	 * // Custom settings
	 * { cache: {
	 *   ttl: 600000,           // 10 minutes
	 *   maxEntries: 1000,
	 *   methods: ['GET'],      // Only cache GET
	 *   respectHeaders: true   // Honor Cache-Control
	 * }}
	 *
	 * @default false
	 */
	cache?: boolean | {
		/** Directory for persistent cache storage (enables file persistence) */
		cacheDir?: string;
		/** Time-to-live for cached entries in milliseconds */
		ttl?: number;
		/** Maximum number of entries to cache */
		maxEntries?: number;
		/** HTTP methods to cache */
		methods?: string[];
		/** Whether to respect Cache-Control headers */
		respectHeaders?: boolean;
	};
	/**
	 * Callback invoked when a redirect response is received.
	 * Controls redirect behavior including whether to follow, modify URL, or change HTTP method.
	 *
	 * @param options - Redirect response details
	 * @param options.url - Redirect target URL
	 * @param options.status - HTTP status code
	 * @param options.headers - Response headers
	 * @param options.sameDomain - Whether redirect is to same domain
	 * @returns Boolean to follow/reject redirect, or object for granular control
	 *
	 * @example
	 * ```typescript
	 * beforeRedirect: ({ status, url }) => {
	 *   if (status === 301 || status === 302) {
	 *     return true; // Follow permanent/temporary redirects
	 *   } else if (status === 307 || status === 308) {
	 *     return { redirect: true, url: url.toString() }; // Preserve method for 307/308
	 *   } else if (status === 303) {
	 *     return { redirect: true, url: url.toString(), method: 'GET' }; // Force GET for 303
	 *   }
	 *   return false; // Reject other redirects
	 * }
	 * ```
	 */
	beforeRedirect?: (options: OnRedirectOptions) => OnRedirectResponse;
	/**
	 * Alias for beforeRedirect - callback invoked when a redirect response is received.
	 * @see beforeRedirect
	 */
	onRedirect?: (options: OnRedirectOptions) => OnRedirectResponse;
	/** Whether to send cookies and authorization headers with cross-origin requests */
	withCredentials?: boolean;
	/** Proxy configuration (URL string or detailed options) */
	proxy?: string | ProxyOptions;
	/**
	 * Whether to use ProxyManager for this request
	 * Set to false to bypass ProxyManager even when one is configured
	 * @default true (uses ProxyManager if configured)
	 */
	useProxyManager?: boolean;
	/** Whether to enable automatic cookie handling */
	useCookies?: boolean;
	/**
	 * Custom cookie jar for managing cookies in this request.
	 * Note: Passing jar per-request is supported but not recommended.
	 * For better cookie management, pass the jar when creating the instance:
	 * @example
	 * ```typescript
	 * const client = new Rezo({ jar: myJar });
	 * // or
	 * const client = rezo.create({ jar: myJar });
	 * ```
	 * If you need custom cookies for a single request, use the `cookies` option instead.
	 */
	jar?: RezoCookieJar;
	/** Cookies to send with the request in various formats */
	cookies?: Cookies["array"] | Cookies["netscape"] | Cookies["serialized"] | Cookies["setCookiesString"];
	/** Callback for upload progress events */
	onUploadProgress?: (progressEvent: any) => void;
	/** Callback for download progress events */
	onDownloadProgress?: (progressEvent: any) => void;
	/** Maximum allowed size of the request body in bytes */
	maxBodyLength?: number;
	/** Maximum transfer rate (single number or [upload, download] tuple) */
	maxRate?: number | [
		MaxUploadRate,
		MaxDownloadRate
	];
	/** Array of functions to transform request data */
	transformRequest?: Array<(data: any, headers: RezoHeaders) => any>;
	/** Array of functions to transform response data */
	transformResponse?: Array<(data: any) => any>;
	/** AbortSignal to cancel the request */
	signal?: AbortSignal;
	/** File path to save the response to (for downloads) */
	saveTo?: string;
	/** Custom filename for downloaded files */
	fileName?: string;
	/** Browser simulation configuration for user agent spoofing */
	browser?: {
		/** Browser name to simulate */
		name: "chrome" | "firefox" | "safari" | "edge" | "opera" | "ie" | "chromium";
		/** Browser version string */
		version: string;
		/** Device platform type */
		platform: "desktop" | "mobile" | "tablet";
		/** Operating system details */
		os: {
			/** Operating system name */
			name: "windows" | "macos" | "linux" | "ios" | "android" | "chromeos";
			/** OS version string */
			version: string;
			/** CPU architecture */
			architecture: "x86" | "x64" | "arm" | "arm64";
		};
		/** Browser language preference */
		language?: string;
	};
	/** Enable debug logging for the request */
	debug?: boolean;
	/** Enable verbose logging with detailed information */
	verbose?: boolean;
	/**
	 * Enable URL tracking to log the complete redirect chain with status codes.
	 * When enabled, logs: initial URL -> redirect URL (status code) -> final URL
	 * Also logs retry attempts with their status codes.
	 */
	trackUrl?: boolean;
	/** Name of the cookie containing XSRF token */
	xsrfCookieName?: string;
	/** Name of the header to send XSRF token in */
	xsrfHeaderName?: string;
	/** Custom HTTP agent for HTTP requests */
	httpAgent?: HttpAgent;
	/** Custom HTTPS agent for HTTPS requests */
	httpsAgent?: HttpsAgent;
	/** Transitional options for backward compatibility */
	transitional?: {
		/** Silently ignore JSON parsing errors */
		silentJSONParsing?: boolean;
		/** Force JSON parsing even for non-JSON responses */
		forcedJSONParsing?: boolean;
		/** Provide clearer timeout error messages */
		clarifyTimeoutError?: boolean;
	};
	/** Character encoding for request body and response data */
	encoding?: BufferEncoding;
	/**
	 * Determines whether a given HTTP status code should be treated as a successful response.
	 * When a status code fails validation, the request will throw an error.
	 *
	 * @param status - The HTTP response status code
	 * @returns true if the status code should be considered successful
	 *
	 * @default (status) => status >= 200 && status < 300
	 *
	 * @example
	 * ```typescript
	 * // Accept all 2xx and 3xx as success
	 * validateStatus: (status) => status >= 200 && status < 400
	 *
	 * // Never throw on any status code
	 * validateStatus: () => true
	 *
	 * // Only accept 200
	 * validateStatus: (status) => status === 200
	 * ```
	 */
	validateStatus?: ((status: number) => boolean) | null;
	/**
	 * Custom function to serialize URL query parameters.
	 * When provided, this replaces the default serialization logic.
	 *
	 * @param params - The params object to serialize
	 * @returns The serialized query string (without leading '?')
	 *
	 * @example
	 * ```typescript
	 * // Custom array serialization
	 * paramsSerializer: (params) => qs.stringify(params, { arrayFormat: 'brackets' })
	 *
	 * // Simple key=value pairs
	 * paramsSerializer: (params) =>
	 *   Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&')
	 * ```
	 */
	paramsSerializer?: (params: Record<string, any>) => string;
	/**
	 * Custom DNS lookup function for hostname resolution.
	 * Replaces the default `dns.lookup` used by Node.js for this request.
	 *
	 * @example
	 * ```typescript
	 * import { lookup } from 'node:dns/promises';
	 * dnsLookup: (hostname, options, callback) => {
	 *   // Custom DNS resolution logic
	 *   lookup(hostname).then(result => callback(null, result.address, result.family));
	 * }
	 * ```
	 */
	dnsLookup?: (hostname: string, options: any, callback: (err: Error | null, address: string, family: number) => void) => void;
	/**
	 * Request lifecycle hooks for intercepting and modifying request/response behavior.
	 * Optional hooks that will be merged with default hooks during request processing.
	 */
	hooks?: Partial<RezoHooks>;
}
export interface OnRedirectOptions {
	url: URL;
	status: number;
	headers: RezoHeaders;
	sameDomain: boolean;
	method: string;
	/** The current request body (RezoFormData, string, object, etc.) - allows user to inspect/modify */
	body?: any;
}
export type OnRedirectResponse = boolean | ToRedirectOptions | undefined;
export type ToRedirectOptions = {
	redirect: false;
	message?: string;
} | {
	redirect: true;
	url: string;
	method?: "POST" | "GET" | "PUT" | "DELETE" | "PATCH" | "OPTIONS";
	body?: any;
	withoutBody?: boolean;
	setHeaders?: RezoHeaders | OutgoingHttpHeaders;
	setHeadersOnRedirects?: RezoHeaders | OutgoingHttpHeaders;
};
/**
 * RezoHttpRequest - Request configuration type for all methods
 *
 * This type excludes internal properties and is specifically designed for public API usage.
 * Use this type when creating reusable request configurations for the all method.
 *
 * @public - Use with all methods
 * @internal - Do not use internally within the library
 */
export type RezoHttpRequest = Omit<RezoRequestConfig, "body" | "url" | "method" | "form" | "json" | "formData" | "multipart" | "fullUrl" | "responseType" | "fileName" | "saveTo" | "baseURL">;
/**
 * Method-aware request types for better TypeScript inference
 * These types remove data/body fields from methods that don't typically use them
 */
/**
 * RezoHttpGetRequest - Request options for GET requests (no request body)
 * @public - Use with GET method
 */
export type RezoHttpGetRequest = Omit<RezoHttpRequest, "data" | "body" | "fileName" | "saveTo">;
/**
 * RezoHttpPostRequest - Request options for POST requests (includes request body)
 * @public - Use with POST method
 */
export type RezoHttpPostRequest = RezoHttpRequest;
/**
 * RezoHttpPutRequest - Request options for PUT requests (includes request body)
 * @public - Use with PUT method
 */
export type RezoHttpPutRequest = RezoHttpRequest;
/**
 * RezoHttpPatchRequest - Request options for PATCH requests (includes request body)
 * @public - Use with PATCH method
 */
export type RezoHttpPatchRequest = RezoHttpRequest;
/**
 * RezoHttpDeleteRequest - Request options for DELETE requests (no request body)
 * @public - Use with DELETE method
 */
export type RezoHttpDeleteRequest = Omit<RezoHttpRequest, "data" | "body">;
/**
 * RezoHttpHeadRequest - Request options for HEAD requests (no request body)
 * @public - Use with HEAD method
 */
export type RezoHttpHeadRequest = Omit<RezoHttpRequest, "data" | "body">;
/**
 * RezoHttpOptionsRequest - Request options for OPTIONS requests (no request body)
 * @public - Use with OPTIONS method
 */
export type RezoHttpOptionsRequest = Omit<RezoHttpRequest, "data" | "body">;
/**
 * RezoRequestOptions - Request configuration type for the .request() method
 *
 * This type excludes internal properties and is specifically designed for public API usage.
 * Use this type when creating reusable request configurations for the .request() method.
 *
 * @public - For external use with .request() method only
 * @internal - Do not use internally within the library
 */
export type RezoRequestOptions = Omit<RezoRequestConfig, "fullUrl">;
/**
 * Helper types for GET method with specific response types
 * These ensure responseType is properly typed without conflicts
 */
export interface httpAdapterOverloads {
	request<T = any>(options: RezoRequestOptions): Promise<RezoResponse<T>>;
	request<T = any>(options: RezoRequestOptions & {
		responseType: "auto";
	}): Promise<RezoResponse<T>>;
	request<T = any>(options: RezoRequestOptions & {
		responseType: "json";
	}): Promise<RezoResponse<T>>;
	request(options: {
		responseType: "stream";
	} & RezoRequestOptions): Promise<RezoStreamResponse>;
	request(options: RezoRequestOptions & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	request(options: RezoRequestOptions & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	request(options: RezoRequestOptions & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	request(options: RezoRequestOptions & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	request(options: RezoRequestOptions & {
		responseType: "download";
	}): Promise<RezoDownloadResponse>;
	request(options: RezoRequestOptions & {
		fileName: string;
	}): Promise<RezoDownloadResponse>;
	request(options: RezoRequestOptions & {
		saveTo: string;
	}): Promise<RezoDownloadResponse>;
	request(options: RezoRequestOptions & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	get<T = any>(url: string | URL): Promise<RezoResponse<T>>;
	get<T = any>(url: string | URL, options?: RezoHttpGetRequest): Promise<RezoResponse<T>>;
	get<T = any>(url: string | URL, options: RezoHttpGetRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	get(url: string | URL, options: RezoHttpGetRequest & {
		responseType: "stream";
	}): Promise<RezoStreamResponse>;
	get(url: string | URL, options: RezoHttpGetRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	get(url: string | URL, options: RezoHttpGetRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	get(url: string | URL, options: RezoHttpGetRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	get(url: string | URL, options: RezoHttpGetRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	get(url: string | URL, options: RezoHttpGetRequest & {
		responseType: "download";
	}): Promise<RezoDownloadResponse>;
	get(url: string | URL, options: RezoHttpGetRequest & {
		fileName: string;
	}): Promise<RezoDownloadResponse>;
	get(url: string | URL, options: RezoHttpGetRequest & {
		saveTo: string;
	}): Promise<RezoDownloadResponse>;
	head(url: string | URL): Promise<RezoResponse<null>>;
	head(url: string | URL, options: RezoHttpHeadRequest): Promise<RezoResponse<null>>;
	options<T = any>(url: string | URL): Promise<RezoResponse<T>>;
	options<T = any>(url: string | URL, options: RezoHttpOptionsRequest): Promise<RezoResponse<T>>;
	trace<T = any>(url: string | URL): Promise<RezoResponse<T>>;
	trace<T = any>(url: string | URL, options: RezoHttpRequest): Promise<RezoResponse<T>>;
	delete<T = any>(url: string | URL, options?: RezoHttpDeleteRequest): Promise<RezoResponse<T>>;
	delete<T = any>(url: string | URL, options: RezoHttpDeleteRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	delete(url: string | URL, options: RezoHttpDeleteRequest & {
		responseType: "stream";
	}): Promise<RezoStreamResponse>;
	delete(url: string | URL, options: RezoHttpDeleteRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	delete(url: string | URL, options: RezoHttpDeleteRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	delete(url: string | URL, options: RezoHttpDeleteRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	delete(url: string | URL, options: RezoHttpDeleteRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	delete(url: string | URL, options: RezoHttpDeleteRequest & {
		responseType: "download";
	}): Promise<RezoDownloadResponse>;
	delete(url: string | URL, options: RezoHttpDeleteRequest & {
		fileName: string;
	}): Promise<RezoDownloadResponse>;
	delete(url: string | URL, options: RezoHttpDeleteRequest & {
		saveTo: string;
	}): Promise<RezoDownloadResponse>;
}
/**
 * Extended URLSearchParams that supports nested objects and arrays
 * for application/x-www-form-urlencoded encoding
 */
export type Primitive = string | number | boolean | null | undefined | Date;
export type NestedValue = Primitive | NestedObject | NestedArray;
export type NestedObject = {
	[key: string]: NestedValue;
};
export type NestedArray = NestedValue[];
export type NestedMode = "json" | "brackets" | "dots";
export interface RezoURLSearchParamsOptions {
	nestedKeys?: NestedMode;
}
declare class RezoURLSearchParams extends URLSearchParams {
	private nestedMode;
	constructor(init?: string | URLSearchParams | NestedObject | string[][] | RezoURLSearchParams, options?: RezoURLSearchParamsOptions);
	constructor(init?: string | URLSearchParams | NestedObject | string[][] | RezoURLSearchParams);
	/**
	 * Append a nested object to the search params
	 */
	appendObject(obj: NestedObject, prefix?: string): void;
	/**
	 * Build the nested key based on the current mode
	 */
	private buildNestedKey;
	/**
	 * Set a value (replacing existing values with the same key)
	 */
	setObject(obj: NestedObject, prefix?: string): void;
	/**
	 * Append a value with proper handling for different types
	 */
	private appendValue;
	/**
	 * Append an array with proper indexing
	 */
	private appendArray;
	/**
	 * Convert to a plain flat object (keys remain as-is)
	 */
	toFlatObject(): Record<string, string>;
	/**
	 * Convert to a nested object, parsing bracket/dot notation keys
	 * and JSON-encoded values back into their original structure
	 */
	toObject(): Record<string, any>;
	/**
	 * Override toString to use unencoded brackets for nested keys.
	 * Native URLSearchParams encodes [ ] as %5B %5D, but standard
	 * form encoding (PHP, Rails, Express/qs) expects literal brackets.
	 */
	toString(): string;
	/**
	 * Create from a flat object with bracket notation keys
	 */
	static fromFlat(flat: Record<string, string>): RezoURLSearchParams;
}
export interface httpAdapterPostOverloads {
	post<T = any>(url: string | URL, data?: any): Promise<RezoResponse<T>>;
	post<T = any>(url: string | URL, data: any, options?: RezoHttpPostRequest): Promise<RezoResponse<T>>;
	post<T = any>(url: string | URL, data: any, options: RezoHttpPostRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	post(url: string | URL, data: any, options: RezoHttpPostRequest & {
		responseType: "stream";
	}): Promise<RezoStreamResponse>;
	post(url: string | URL, data: any, options: RezoHttpPostRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	post(url: string | URL, data: any, options: RezoHttpPostRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	post(url: string | URL, data: any, options: RezoHttpPostRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	post(url: string | URL, data: any, options: RezoHttpPostRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	post(url: string | URL, data: any, options: RezoHttpPostRequest & {
		responseType: "download";
	}): Promise<RezoDownloadResponse>;
	post(url: string | URL, data: any, options: RezoHttpPostRequest & {
		fileName: string;
	}): Promise<RezoDownloadResponse>;
	post(url: string | URL, data: any, options: RezoHttpPostRequest & {
		saveTo: string;
	}): Promise<RezoDownloadResponse>;
	post(url: string | URL, data: any, options: RezoHttpPostRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	postJson<T = any>(url: string | URL): Promise<RezoResponse<T>>;
	postJson<T = any>(url: string | URL, data: Record<any, any> | Array<any>): Promise<RezoResponse<T>>;
	postJson<T = any>(url: string | URL, jsonString: string): Promise<RezoResponse<T>>;
	postJson<T = any>(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPostRequest): Promise<RezoResponse<T>>;
	postJson<T = any>(url: string | URL, jsonString: string, options: RezoHttpPostRequest): Promise<RezoResponse<T>>;
	postJson<T = any>(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest): Promise<RezoResponse<T>>;
	postJson<T = any>(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPostRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	postJson<T = any>(url: string | URL, jsonString: string, options: RezoHttpPostRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	postJson<T = any>(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	postJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPostRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	postJson(url: string | URL, jsonString: string, options: RezoHttpPostRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	postJson(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	postJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPostRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	postJson(url: string | URL, jsonString: string, options: RezoHttpPostRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	postJson(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	postJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPostRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	postJson(url: string | URL, jsonString: string, options: RezoHttpPostRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	postJson(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	postJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPostRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	postJson(url: string | URL, jsonString: string, options: RezoHttpPostRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	postJson(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	postJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPostRequest & {
		responseType: "stream";
	}): Promise<RezoStreamResponse>;
	postJson(url: string | URL, jsonString: string, options: RezoHttpPostRequest & {
		responseType: "stream";
	}): Promise<RezoStreamResponse>;
	postJson(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest & {
		responseType: "stream";
	}): Promise<RezoStreamResponse>;
	postForm<T = any>(url: string | URL): Promise<RezoResponse<T>>;
	postForm<T = any>(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>): Promise<RezoResponse<T>>;
	postForm<T = any>(url: string | URL, string: string): Promise<RezoResponse<T>>;
	postForm<T = any>(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPostRequest): Promise<RezoResponse<T>>;
	postForm<T = any>(url: string | URL, string: string, options: RezoHttpPostRequest): Promise<RezoResponse<T>>;
	postForm<T = any>(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest): Promise<RezoResponse<T>>;
	postForm<T = any>(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPostRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	postForm<T = any>(url: string | URL, string: string, options: RezoHttpPostRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	postForm<T = any>(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	postForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPostRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	postForm(url: string | URL, string: string, options: RezoHttpPostRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	postForm(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	postForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPostRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	postForm(url: string | URL, string: string, options: RezoHttpPostRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	postForm(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	postForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPostRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	postForm(url: string | URL, string: string, options: RezoHttpPostRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	postForm(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	postForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPostRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	postForm(url: string | URL, string: string, options: RezoHttpPostRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	postForm(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	postForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPostRequest & {
		responseType: "stream";
	}): Promise<RezoStreamResponse>;
	postForm(url: string | URL, string: string, options: RezoHttpPostRequest & {
		responseType: "stream";
	}): Promise<RezoStreamResponse>;
	postForm(url: string | URL, nullData: null | undefined, options: RezoHttpPostRequest & {
		responseType: "stream";
	}): Promise<RezoStreamResponse>;
	postMultipart<T = any>(url: string | URL, formData: RezoFormData): Promise<RezoResponse<T>>;
	postMultipart<T = any>(url: string | URL, formData: FormData): Promise<RezoResponse<T>>;
	postMultipart<T = any>(url: string | URL, dataObject: Record<string, any>): Promise<RezoResponse<T>>;
	postMultipart<T = any>(url: string | URL, formData: RezoFormData, options: RezoHttpPostRequest): Promise<RezoResponse<T>>;
	postMultipart<T = any>(url: string | URL, formData: FormData, options: RezoHttpPostRequest): Promise<RezoResponse<T>>;
	postMultipart<T = any>(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPostRequest): Promise<RezoResponse<T>>;
	postMultipart<T = any>(url: string | URL, formData: RezoFormData, options: RezoHttpPostRequest & {
		responseType: "auto";
	}): Promise<RezoResponse<T>>;
	postMultipart<T = any>(url: string | URL, formData: FormData, options: RezoHttpPostRequest & {
		responseType: "auto";
	}): Promise<RezoResponse<T>>;
	postMultipart<T = any>(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPostRequest & {
		responseType: "auto";
	}): Promise<RezoResponse<T>>;
	postMultipart<T = any>(url: string | URL, formData: RezoFormData, options: RezoHttpPostRequest & {
		responseType: "json";
	}): Promise<RezoResponse<T>>;
	postMultipart<T = any>(url: string | URL, formData: FormData, options: RezoHttpPostRequest & {
		responseType: "json";
	}): Promise<RezoResponse<T>>;
	postMultipart<T = any>(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPostRequest & {
		responseType: "json";
	}): Promise<RezoResponse<T>>;
	postMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPostRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	postMultipart(url: string | URL, formData: FormData, options: RezoHttpPostRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	postMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPostRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	postMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPostRequest & {
		responseType: "stream";
	}): Promise<RezoStreamResponse>;
	postMultipart(url: string | URL, formData: FormData, options: RezoHttpPostRequest & {
		responseType: "stream";
	}): Promise<RezoStreamResponse>;
	postMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPostRequest & {
		responseType: "stream";
	}): Promise<RezoStreamResponse>;
	postMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPostRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	postMultipart(url: string | URL, formData: FormData, options: RezoHttpPostRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	postMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPostRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	postMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPostRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	postMultipart(url: string | URL, formData: FormData, options: RezoHttpPostRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	postMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPostRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	postMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPostRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	postMultipart(url: string | URL, formData: FormData, options: RezoHttpPostRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	postMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPostRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
}
export interface httpAdapterPatchOverloads {
	patch<T = any>(url: string | URL, data?: any): Promise<RezoResponse<T>>;
	patch<T = any>(url: string | URL, data: any, options?: RezoHttpPatchRequest): Promise<RezoResponse<T>>;
	patch<T = any>(url: string | URL, data: any, options: RezoHttpPatchRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	patch(url: string | URL, data: any, options: RezoHttpPatchRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	patch(url: string | URL, data: any, options: RezoHttpPatchRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	patch(url: string | URL, data: any, options: RezoHttpPatchRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	patch(url: string | URL, data: any, options: RezoHttpPatchRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	patch(url: string | URL, data: any, options: RezoHttpPatchRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	patch(url: string | URL, data: any, options: RezoHttpPatchRequest & {
		responseType: "download";
	}): RezoDownloadResponse;
	patch(url: string | URL, data: any, options: RezoHttpPatchRequest & {
		fileName: string;
	}): RezoDownloadResponse;
	patch(url: string | URL, data: any, options: RezoHttpPatchRequest & {
		saveTo: string;
	}): RezoDownloadResponse;
	patch(url: string | URL, data: any, options: RezoHttpPatchRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	patchJson<T = any>(url: string | URL): Promise<RezoResponse<T>>;
	patchJson<T = any>(url: string | URL, data: Record<any, any> | Array<any>): Promise<RezoResponse<T>>;
	patchJson<T = any>(url: string | URL, jsonString: string): Promise<RezoResponse<T>>;
	patchJson<T = any>(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPatchRequest): Promise<RezoResponse<T>>;
	patchJson<T = any>(url: string | URL, jsonString: string, options: RezoHttpPatchRequest): Promise<RezoResponse<T>>;
	patchJson<T = any>(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest): Promise<RezoResponse<T>>;
	patchJson<T = any>(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPatchRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	patchJson<T = any>(url: string | URL, jsonString: string, options: RezoHttpPatchRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	patchJson<T = any>(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	patchJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPatchRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	patchJson(url: string | URL, jsonString: string, options: RezoHttpPatchRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	patchJson(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	patchJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPatchRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	patchJson(url: string | URL, jsonString: string, options: RezoHttpPatchRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	patchJson(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	patchJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPatchRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	patchJson(url: string | URL, jsonString: string, options: RezoHttpPatchRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	patchJson(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	patchJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPatchRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	patchJson(url: string | URL, jsonString: string, options: RezoHttpPatchRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	patchJson(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	patchJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPatchRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	patchJson(url: string | URL, jsonString: string, options: RezoHttpPatchRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	patchJson(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	patchJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPatchRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	patchJson(url: string | URL, jsonString: string, options: RezoHttpPatchRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	patchJson(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	patchForm<T = any>(url: string | URL): Promise<RezoResponse<T>>;
	patchForm<T = any>(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>): Promise<RezoResponse<T>>;
	patchForm<T = any>(url: string | URL, string: string): Promise<RezoResponse<T>>;
	patchForm<T = any>(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPatchRequest): Promise<RezoResponse<T>>;
	patchForm<T = any>(url: string | URL, string: string, options: RezoHttpPatchRequest): Promise<RezoResponse<T>>;
	patchForm<T = any>(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest): Promise<RezoResponse<T>>;
	patchForm<T = any>(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	patchForm<T = any>(url: string | URL, string: string, options: RezoHttpPatchRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	patchForm<T = any>(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	patchForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	patchForm(url: string | URL, string: string, options: RezoHttpPatchRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	patchForm(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	patchForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	patchForm(url: string | URL, string: string, options: RezoHttpPatchRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	patchForm(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	patchForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	patchForm(url: string | URL, string: string, options: RezoHttpPatchRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	patchForm(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	patchForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	patchForm(url: string | URL, string: string, options: RezoHttpPatchRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	patchForm(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	patchForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	patchForm(url: string | URL, string: string, options: RezoHttpPatchRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	patchForm(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	patchForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	patchForm(url: string | URL, string: string, options: RezoHttpPatchRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	patchForm(url: string | URL, nullData: null | undefined, options: RezoHttpPatchRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	patchMultipart<T = any>(url: string | URL, formData: RezoFormData): Promise<RezoResponse<T>>;
	patchMultipart<T = any>(url: string | URL, formData: FormData): Promise<RezoResponse<T>>;
	patchMultipart<T = any>(url: string | URL, dataObject: Record<string, any>): Promise<RezoResponse<T>>;
	patchMultipart<T = any>(url: string | URL, formData: RezoFormData, options: RezoHttpPatchRequest): Promise<RezoResponse<T>>;
	patchMultipart<T = any>(url: string | URL, formData: FormData, options: RezoHttpPatchRequest): Promise<RezoResponse<T>>;
	patchMultipart<T = any>(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPatchRequest): Promise<RezoResponse<T>>;
	patchMultipart<T = any>(url: string | URL, formData: RezoFormData, options: RezoHttpPatchRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	patchMultipart<T = any>(url: string | URL, formData: FormData, options: RezoHttpPatchRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	patchMultipart<T = any>(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	patchMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPatchRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	patchMultipart(url: string | URL, formData: FormData, options: RezoHttpPatchRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	patchMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	patchMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPatchRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	patchMultipart(url: string | URL, formData: FormData, options: RezoHttpPatchRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	patchMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	patchMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPatchRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	patchMultipart(url: string | URL, formData: FormData, options: RezoHttpPatchRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	patchMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	patchMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPatchRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	patchMultipart(url: string | URL, formData: FormData, options: RezoHttpPatchRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	patchMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	patchMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPatchRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	patchMultipart(url: string | URL, formData: FormData, options: RezoHttpPatchRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	patchMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	patchMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPatchRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	patchMultipart(url: string | URL, formData: FormData, options: RezoHttpPatchRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	patchMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPatchRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
}
export interface httpAdapterPutOverloads {
	put<T = any>(url: string | URL, data?: any): Promise<RezoResponse<T>>;
	put<T = any>(url: string | URL, data: any, options?: RezoHttpPutRequest): Promise<RezoResponse<T>>;
	put<T = any>(url: string | URL, data: any, options: RezoHttpPutRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	put(url: string | URL, data: any, options: RezoHttpPutRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	put(url: string | URL, data: any, options: RezoHttpPutRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	put(url: string | URL, data: any, options: RezoHttpPutRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	put(url: string | URL, data: any, options: RezoHttpPutRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	put(url: string | URL, data: any, options: RezoHttpPutRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	put(url: string | URL, data: any, options: RezoHttpPutRequest & {
		responseType: "download";
	}): RezoDownloadResponse;
	put(url: string | URL, data: any, options: RezoHttpPutRequest & {
		fileName: string;
	}): RezoDownloadResponse;
	put(url: string | URL, data: any, options: RezoHttpPutRequest & {
		saveTo: string;
	}): RezoDownloadResponse;
	put(url: string | URL, data: any, options: RezoHttpPutRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	putJson<T = any>(url: string | URL): Promise<RezoResponse<T>>;
	putJson<T = any>(url: string | URL, data: Record<any, any> | Array<any>): Promise<RezoResponse<T>>;
	putJson<T = any>(url: string | URL, jsonString: string): Promise<RezoResponse<T>>;
	putJson<T = any>(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPutRequest): Promise<RezoResponse<T>>;
	putJson<T = any>(url: string | URL, jsonString: string, options: RezoHttpPutRequest): Promise<RezoResponse<T>>;
	putJson<T = any>(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest): Promise<RezoResponse<T>>;
	putJson<T = any>(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPutRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	putJson<T = any>(url: string | URL, jsonString: string, options: RezoHttpPutRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	putJson<T = any>(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	putJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPutRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	putJson(url: string | URL, jsonString: string, options: RezoHttpPutRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	putJson(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	putJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPutRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	putJson(url: string | URL, jsonString: string, options: RezoHttpPutRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	putJson(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	putJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPutRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	putJson(url: string | URL, jsonString: string, options: RezoHttpPutRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	putJson(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	putJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPutRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	putJson(url: string | URL, jsonString: string, options: RezoHttpPutRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	putJson(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	putJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPutRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	putJson(url: string | URL, jsonString: string, options: RezoHttpPutRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	putJson(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	putJson(url: string | URL, data: Record<any, any> | Array<any>, options: RezoHttpPutRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	putJson(url: string | URL, jsonString: string, options: RezoHttpPutRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	putJson(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	putForm<T = any>(url: string | URL): Promise<RezoResponse<T>>;
	putForm<T = any>(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>): Promise<RezoResponse<T>>;
	putForm<T = any>(url: string | URL, string: string): Promise<RezoResponse<T>>;
	putForm<T = any>(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPutRequest): Promise<RezoResponse<T>>;
	putForm<T = any>(url: string | URL, string: string, options: RezoHttpPutRequest): Promise<RezoResponse<T>>;
	putForm<T = any>(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest): Promise<RezoResponse<T>>;
	putForm<T = any>(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	putForm<T = any>(url: string | URL, string: string, options: RezoHttpPutRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	putForm<T = any>(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	putForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	putForm(url: string | URL, string: string, options: RezoHttpPutRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	putForm(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	putForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	putForm(url: string | URL, string: string, options: RezoHttpPutRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	putForm(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	putForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	putForm(url: string | URL, string: string, options: RezoHttpPutRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	putForm(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	putForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	putForm(url: string | URL, string: string, options: RezoHttpPutRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	putForm(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	putForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	putForm(url: string | URL, string: string, options: RezoHttpPutRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	putForm(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	putForm(url: string | URL, data: URLSearchParams | RezoURLSearchParams | Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	putForm(url: string | URL, string: string, options: RezoHttpPutRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	putForm(url: string | URL, nullData: null | undefined, options: RezoHttpPutRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	putMultipart<T = any>(url: string | URL, formData: RezoFormData): Promise<RezoResponse<T>>;
	putMultipart<T = any>(url: string | URL, formData: FormData): Promise<RezoResponse<T>>;
	putMultipart<T = any>(url: string | URL, dataObject: Record<string, any>): Promise<RezoResponse<T>>;
	putMultipart<T = any>(url: string | URL, formData: RezoFormData, options: RezoHttpPutRequest): Promise<RezoResponse<T>>;
	putMultipart<T = any>(url: string | URL, formData: FormData, options: RezoHttpPutRequest): Promise<RezoResponse<T>>;
	putMultipart<T = any>(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPutRequest): Promise<RezoResponse<T>>;
	putMultipart<T = any>(url: string | URL, formData: RezoFormData, options: RezoHttpPutRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	putMultipart<T = any>(url: string | URL, formData: FormData, options: RezoHttpPutRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	putMultipart<T = any>(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "auto" | "json";
	}): Promise<RezoResponse<T>>;
	putMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPutRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	putMultipart(url: string | URL, formData: FormData, options: RezoHttpPutRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	putMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "text";
	}): Promise<RezoResponse<string>>;
	putMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPutRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	putMultipart(url: string | URL, formData: FormData, options: RezoHttpPutRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	putMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "stream";
	}): RezoStreamResponse;
	putMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPutRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	putMultipart(url: string | URL, formData: FormData, options: RezoHttpPutRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	putMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "arrayBuffer";
	}): Promise<RezoResponse<ArrayBuffer>>;
	putMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPutRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	putMultipart(url: string | URL, formData: FormData, options: RezoHttpPutRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	putMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "buffer";
	}): Promise<RezoResponse<Buffer>>;
	putMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPutRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	putMultipart(url: string | URL, formData: FormData, options: RezoHttpPutRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	putMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "blob";
	}): Promise<RezoResponse<Blob$1>>;
	putMultipart(url: string | URL, formData: RezoFormData, options: RezoHttpPutRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	putMultipart(url: string | URL, formData: FormData, options: RezoHttpPutRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
	putMultipart(url: string | URL, dataObject: Record<string, any>, options: RezoHttpPutRequest & {
		responseType: "upload";
	}): Promise<RezoUploadResponse>;
}
export interface InterceptorOptions {
	/** Only run when this predicate returns true */
	runWhen?: (config: any) => boolean;
}
declare class RequestInterceptorManager {
	private entries;
	private hooks;
	constructor(hooks: RezoHooks);
	/**
	 * Register a request interceptor.
	 *
	 * @param fulfilled - Transform or inspect the config before the request is sent.
	 *                    Must return the config (or a promise resolving to it).
	 * @param rejected - Handle errors from previous interceptors in the chain.
	 * @param options - Additional options (runWhen predicate)
	 * @returns Interceptor ID (use with `eject()` to remove)
	 */
	use(fulfilled?: ((config: RezoConfig) => RezoConfig | Promise<RezoConfig>) | null, rejected?: ((error: any) => any) | null, options?: InterceptorOptions): number;
	/**
	 * Remove an interceptor by its ID.
	 */
	eject(id: number): void;
	/**
	 * Remove all interceptors registered through this manager.
	 */
	clear(): void;
	/**
	 * Iterate over all active interceptors.
	 */
	forEach(fn: (entry: {
		fulfilled: Function | null;
		rejected: Function | null;
	}) => void): void;
	/** Number of active interceptors */
	get size(): number;
}
declare class ResponseInterceptorManager {
	private entries;
	private hooks;
	constructor(hooks: RezoHooks);
	/**
	 * Register a response interceptor.
	 *
	 * @param fulfilled - Transform or inspect the response after it's received.
	 *                    Must return the response (or a promise resolving to it).
	 * @param rejected - Handle request errors (network failures, non-2xx statuses, etc.)
	 * @param options - Additional options (runWhen predicate)
	 * @returns Interceptor ID (use with `eject()` to remove)
	 */
	use(fulfilled?: ((response: RezoResponse) => RezoResponse | Promise<RezoResponse>) | null, rejected?: ((error: any) => any) | null, options?: InterceptorOptions): number;
	/**
	 * Remove an interceptor by its ID.
	 */
	eject(id: number): void;
	/**
	 * Remove all interceptors registered through this manager.
	 */
	clear(): void;
	/**
	 * Iterate over all active interceptors.
	 */
	forEach(fn: (entry: {
		fulfilled: Function | null;
		rejected: Function | null;
	}) => void): void;
	/** Number of active interceptors */
	get size(): number;
}
declare class RezoUri extends URL {
	/**
	 * Get query parameters as a plain object.
	 * Duplicate keys are collapsed to the last value.
	 */
	get params(): Record<string, string>;
	/**
	 * Set query parameters from a plain object.
	 * Replaces all existing search params.
	 */
	set params(value: Record<string, string>);
	/**
	 * Get auth as `{ username, password }`.
	 * Values are already decoded.
	 */
	get auth(): {
		username: string;
		password: string;
	};
	/**
	 * Set auth from `{ username, password }`.
	 * Values are automatically percent-encoded.
	 */
	set auth(value: {
		username: string;
		password: string;
	});
	/**
	 * All URL parts as a plain object.
	 */
	toObject(): {
		href: string;
		origin: string;
		protocol: string;
		username: string;
		password: string;
		host: string;
		hostname: string;
		port: string;
		pathname: string;
		search: string;
		hash: string;
		params: Record<string, string>;
	};
	/**
	 * Deep clone this URI.
	 */
	clone(): RezoUri;
	/**
	 * JSON serialization returns the full href string.
	 */
	toJSON(): string;
	/**
	 * Create a RezoUri from a native URL or string.
	 */
	static from(url: string | URL): RezoUri;
}
/**
 * Options for `rezo.buildUri()`.
 * Every property of the URL API is settable, plus convenience helpers
 * like `params`, `auth`, `baseURL`, and `paramsSerializer`.
 */
export interface BuildUriOptions {
	href?: string;
	origin?: string;
	protocol?: string;
	username?: string;
	password?: string;
	host?: string;
	hostname?: string;
	port?: number | string;
	pathname?: string;
	search?: string;
	hash?: string;
	/** Full or relative URL string (alias for href when used with baseURL) */
	url?: string | URL;
	/** Base URL to resolve relative paths against */
	baseURL?: string;
	/** Query parameters object — merged into search, properly encoded */
	params?: Record<string, any>;
	/** Custom params serializer */
	paramsSerializer?: (params: any) => string | Record<string, string>;
	/** Basic auth — encoded into username:password */
	auth?: {
		username: string;
		password: string;
	};
}
/**
 * Adapter function type - all adapters must implement this signature
 */
export type AdapterFunction<T = any> = (options: RezoRequestConfig, defaultOptions: RezoDefaultOptions, jar: RezoCookieJar) => Promise<RezoResponse<T> | RezoStreamResponse | RezoDownloadResponse | RezoUploadResponse>;
declare class Rezo {
	protected queue: RezoQueue | HttpQueue | null;
	protected isQueueEnabled: boolean;
	defaults: RezoDefaultOptions;
	hooks: RezoHooks;
	private cookieJar;
	/** Session ID persists across all requests from this instance */
	readonly sessionId: string;
	/** Response cache for caching HTTP responses */
	readonly responseCache?: ResponseCache;
	/** DNS cache for caching DNS lookups */
	readonly dnsCache?: DNSCache;
	/** The adapter function used for HTTP requests */
	private readonly adapter;
	/** Proxy manager for advanced proxy rotation and pool management */
	private readonly _proxyManager;
	/**
	 * Interceptor managers for request and response lifecycle.
	 *
	 * Register interceptors using `use()`, remove with `eject()`, or clear all with `clear()`.
	 *
	 * - `interceptors.request.use(onFulfilled, onRejected)` — modify config before sending
	 * - `interceptors.response.use(onFulfilled, onRejected)` — transform responses or handle errors
	 */
	interceptors: {
		request: RequestInterceptorManager;
		response: ResponseInterceptorManager;
	};
	constructor(config?: RezoDefaultOptions, adapter?: AdapterFunction);
	/**
	 * Get the ProxyManager instance (if configured)
	 * @returns ProxyManager instance or null
	 */
	get proxyManager(): ProxyManager | null;
	/**
	 * Clear all caches (response and DNS)
	 */
	clearCache(): void;
	/**
	 * Invalidate cached response for a specific URL
	 */
	invalidateCache(url: string, method?: string): void;
	/**
	 * Get cache statistics
	 */
	getCacheStats(): {
		response?: {
			size: number;
			enabled: boolean;
			persistent: boolean;
		};
		dns?: {
			size: number;
			enabled: boolean;
		};
	};
	get: httpAdapterOverloads["get"];
	head: httpAdapterOverloads["head"];
	options: httpAdapterOverloads["options"];
	trace: httpAdapterOverloads["trace"];
	delete: httpAdapterOverloads["delete"];
	request: httpAdapterOverloads["request"];
	post: httpAdapterPostOverloads["post"];
	postJson: httpAdapterPostOverloads["postJson"];
	postForm: httpAdapterPostOverloads["postForm"];
	postMultipart: httpAdapterPostOverloads["postMultipart"];
	put: httpAdapterPutOverloads["put"];
	putJson: httpAdapterPutOverloads["putJson"];
	putForm: httpAdapterPutOverloads["putForm"];
	putMultipart: httpAdapterPutOverloads["putMultipart"];
	patch: httpAdapterPatchOverloads["patch"];
	patchJson: httpAdapterPatchOverloads["patchJson"];
	patchForm: httpAdapterPatchOverloads["patchForm"];
	patchMultipart: httpAdapterPatchOverloads["patchMultipart"];
	private executeRequest;
	private buildFullUrl;
	/**
	 * Build a full, safe URL from parts or a request config.
	 *
	 * Accepts either a string/URL, or an options object with individual URL components.
	 * All values are properly encoded. Components from `this.defaults` (baseURL, paramsSerializer)
	 * are used as fallbacks.
	 *
	 * @example
	 * ```ts
	 * // From request config (baseURL + path + params)
	 * rezo.buildUri({ url: '/users', params: { page: 2 } })
	 *
	 * // From individual parts
	 * rezo.buildUri({
	 *   protocol: 'https',
	 *   hostname: 'api.example.com',
	 *   port: 8443,
	 *   pathname: '/v1/users',
	 *   params: { role: 'admin' },
	 *   hash: 'section-2',
	 *   auth: { username: 'user', password: 'pass' }
	 * })
	 * // → "https://user:pass@api.example.com:8443/v1/users?role=admin#section-2"
	 *
	 * // Just encode a string safely
	 * rezo.buildUri('https://example.com/path with spaces?q=a&b')
	 * ```
	 */
	buildUri(config: string | URL | BuildUriOptions): RezoUri;
	private _isvalidJson;
	/**
	 * Deep-merge two request configs. Headers and params are merged (not replaced).
	 * Properties from config2 take precedence over config1.
	 */
	static mergeConfig(config1: RezoDefaultOptions, config2: Partial<RezoDefaultOptions>): RezoDefaultOptions;
	/**
	 * Create a child instance inheriting this instance's defaults, merged with new options.
	 * Unlike `create()` which starts fresh, `extend()` chains defaults.
	 *
	 * @example
	 * ```ts
	 * const api = rezo.extend({ baseURL: 'https://api.example.com' });
	 * const authed = api.extend({ headers: { Authorization: 'Bearer ...' } });
	 * ```
	 */
	extend(config: RezoDefaultOptions): Rezo;
	/**
	 * Async iterator for paginated APIs.
	 *
	 * Auto-detects pagination via Link headers, or use custom logic
	 * via `pagination.getNextUrl` / `pagination.transform`.
	 *
	 * @example
	 * ```ts
	 * // Auto-detect via Link header
	 * for await (const page of rezo.paginate('/users')) {
	 *   console.log(page.data);
	 * }
	 *
	 * // Cursor-based
	 * for await (const page of rezo.paginate('/items', {
	 *   pagination: {
	 *     getNextUrl: (resp) => resp.data.next_cursor
	 *       ? `/items?cursor=${resp.data.next_cursor}` : null,
	 *   }
	 * })) { ... }
	 *
	 * // Collect all items
	 * const allUsers = [];
	 * for await (const page of rezo.paginate('/users', {
	 *   pagination: { transform: (resp) => resp.data.results }
	 * })) {
	 *   allUsers.push(...page);
	 * }
	 * ```
	 */
	paginate<T = any>(url: string, options?: RezoHttpRequest & {
		pagination?: {
			/** Extract the next page URL from the response. Return null/undefined to stop. */
			getNextUrl?: (response: RezoResponse<T>) => string | null | undefined;
			/** Transform each response into the yielded value. Defaults to yielding response.data. */
			transform?: (response: RezoResponse<T>) => any;
			/** Maximum number of pages to fetch. Default: Infinity. */
			countLimit?: number;
			/** Maximum number of requests. Same as countLimit. */
			requestLimit?: number;
		};
	}): AsyncGenerator<T, void, undefined>;
	private _create;
	/** Get the cookie jar for this instance */
	get jar(): RezoCookieJar;
	set jar(jar: RezoCookieJar);
	/**
	 * Save cookies to file (if cookieFile is configured).
	 * Can also specify a different path to save to.
	 */
	saveCookies(filePath?: string): void;
	/**
	 * Stream a resource - returns immediately with StreamResponse
	 * The response data is emitted via 'data' events.
	 *
	 * @param url - URL to stream from
	 * @param options - Request options (optional)
	 * @returns StreamResponse that emits 'data', 'end', 'error' events
	 *
	 * @example
	 * ```typescript
	 * const stream = rezo.stream('https://example.com/large-file');
	 * stream.on('data', (chunk) => console.log('Received:', chunk.length, 'bytes'));
	 * stream.on('end', () => console.log('Stream complete'));
	 * stream.on('error', (err) => console.error('Error:', err));
	 * ```
	 */
	stream(url: string | URL, options?: RezoHttpRequest): RezoStreamResponse;
	/**
	 * Download a resource to a file - returns immediately with DownloadResponse
	 * The download progress and completion are emitted via events.
	 *
	 * @param url - URL to download from
	 * @param saveTo - File path to save the download to
	 * @param options - Request options (optional)
	 * @returns DownloadResponse that emits 'progress', 'complete', 'error' events
	 *
	 * @example
	 * ```typescript
	 * const download = rezo.download('https://example.com/file.zip', './downloads/file.zip');
	 * download.on('progress', (p) => console.log(`${p.percent}% complete`));
	 * download.on('complete', () => console.log('Download finished'));
	 * download.on('error', (err) => console.error('Error:', err));
	 * ```
	 */
	download(url: string | URL, saveTo: string, options?: RezoHttpRequest): RezoDownloadResponse;
	/**
	 * Upload data with progress tracking - returns immediately with UploadResponse
	 * The upload progress and completion are emitted via events.
	 *
	 * @param url - URL to upload to
	 * @param data - Data to upload (Buffer, FormData, string, etc.)
	 * @param options - Request options (optional)
	 * @returns UploadResponse that emits 'progress', 'complete', 'error' events
	 *
	 * @example
	 * ```typescript
	 * const upload = rezo.upload('https://example.com/upload', fileBuffer);
	 * upload.on('progress', (p) => console.log(`${p.percent}% uploaded`));
	 * upload.on('complete', (response) => console.log('Upload finished:', response));
	 * upload.on('error', (err) => console.error('Error:', err));
	 * ```
	 */
	upload(url: string | URL, data: Buffer | FormData | RezoFormData | string | Record<string, any>, options?: RezoHttpRequest): RezoUploadResponse;
	/**
	 * Set cookies in the cookie jar from various input formats.
	 *
	 * This method accepts multiple input formats for maximum flexibility:
	 * - **Netscape cookie file content** (string): Full cookie file content in Netscape format
	 * - **Set-Cookie header array** (string[]): Array of Set-Cookie header values
	 * - **Serialized cookie objects** (SerializedCookie[]): Array of plain objects with cookie properties
	 * - **Cookie instances** (Cookie[]): Array of Cookie class instances
	 *
	 * @param cookies - Cookies to set in one of the supported formats
	 * @param url - Optional URL context for the cookies (used for domain/path inference)
	 * @param startNew - If true, clears all existing cookies before setting new ones (default: false)
	 *
	 * @example
	 * ```typescript
	 * // From Netscape cookie file content
	 * const netscapeContent = `# Netscape HTTP Cookie File
	 * .example.com\tTRUE\t/\tFALSE\t0\tsession\tabc123`;
	 * rezo.setCookies(netscapeContent);
	 *
	 * // From Set-Cookie header array
	 * rezo.setCookies([
	 *   'session=abc123; Domain=example.com; Path=/; HttpOnly',
	 *   'user=john; Domain=example.com; Path=/; Max-Age=3600'
	 * ], 'https://example.com');
	 *
	 * // From serialized cookie objects
	 * rezo.setCookies([
	 *   { key: 'session', value: 'abc123', domain: 'example.com', path: '/' },
	 *   { key: 'user', value: 'john', domain: 'example.com', path: '/', maxAge: 3600 }
	 * ]);
	 *
	 * // From Cookie instances
	 * import { Cookie } from 'rezo';
	 * const cookie = new Cookie({ key: 'token', value: 'xyz789', domain: 'api.example.com' });
	 * rezo.setCookies([cookie]);
	 *
	 * // Replace all cookies (startNew = true)
	 * rezo.setCookies([{ key: 'new', value: 'cookie' }], undefined, true);
	 * ```
	 *
	 * @see {@link getCookies} - Retrieve cookies from the jar
	 * @see {@link RezoCookieJar} - The underlying cookie jar class
	 */
	setCookies(stringCookies: string): void;
	setCookies(stringCookies: string, url: string, startNew?: boolean): void;
	setCookies(serializedStringCookiesCookies: string, url: string | undefined, startNew: boolean): void;
	setCookies(serializedCookies: SerializedCookie[]): void;
	setCookies(serializedCookies: SerializedCookie[], url: string, startNew?: boolean): void;
	setCookies(serializedCookies: SerializedCookie[], url: string | undefined, startNew: boolean): void;
	setCookies(cookies: Cookie[]): void;
	setCookies(cookies: Cookie[], url: string, startNew?: boolean): void;
	setCookies(cookies: Cookie[], url: string | undefined, startNew: boolean): void;
	setCookies(setCookieArray: string[]): void;
	setCookies(setCookieArray: string[], url: string, startNew?: boolean): void;
	setCookies(setCookieArray: string[], url: string | undefined, startNew: boolean): void;
	/**
	 * Get cookies from the cookie jar in multiple convenient formats.
	 *
	 * Returns a `Cookies` object containing stored cookies in various formats
	 * for different use cases. This provides flexible access to cookies for
	 * HTTP headers, file storage, serialization, or programmatic manipulation.
	 *
	 * If a `url` is provided, only cookies valid for that URL (matching domain, path,
	 * expiration, etc.) are returned. If no `url` is provided, all cookies in the
	 * jar are returned.
	 *
	 * The returned `Cookies` object contains:
	 * - **array**: `Cookie[]` - Array of Cookie class instances for programmatic access
	 * - **serialized**: `SerializedCookie[]` - Plain objects for JSON serialization/storage
	 * - **netscape**: `string` - Netscape cookie file format for file-based storage
	 * - **string**: `string` - Cookie header format (`key=value; key2=value2`) for HTTP requests
	 * - **setCookiesString**: `string[]` - Array of Set-Cookie header strings
	 *
	 * @param url - Optional URL to filter cookies. If provided, returns only cookies valid for this URL.
	 * @returns A Cookies object with cookies in multiple formats
	 *
	 * @example
	 * ```typescript
	 * // Get ALL cookies in the jar
	 * const allCookies = rezo.getCookies();
	 *
	 * // Get cookies valid for a specific URL
	 * const googleCookies = rezo.getCookies('https://google.com');
	 * console.log(googleCookies.string); // Only sends valid cookies for google.com
	 *
	 * // Access as Cookie instances
	 * for (const cookie of allCookies.array) {
	 *   console.log(`${cookie.key}=${cookie.value}`);
	 * }
	 *
	 * // Save to Netscape cookie file
	 * fs.writeFileSync('cookies.txt', allCookies.netscape);
	 *
	 * // Serialize to JSON for storage
	 * const json = JSON.stringify(allCookies.serialized);
	 * localStorage.setItem('cookies', json);
	 * ```
	 *
	 * @see {@link setCookies} - Set cookies in the jar
	 * @see {@link clearCookies} - Remove all cookies from the jar
	 * @see {@link cookieJar} - Access the underlying RezoCookieJar for more methods
	 */
	getCookies(): Cookies;
	getCookies(url: string): Cookies;
	/**
	 * Remove all cookies from the cookie jar.
	 *
	 * This method synchronously clears the entire cookie store, removing all
	 * cookies regardless of domain, path, or expiration. Useful for:
	 * - Logging out users and clearing session state
	 * - Resetting the client to a clean state between test runs
	 * - Implementing "clear cookies" functionality in applications
	 * - Starting fresh before authenticating with different credentials
	 *
	 * This operation is immediate and cannot be undone. If you need to preserve
	 * certain cookies, use {@link getCookies} to save them before clearing,
	 * then restore specific ones with {@link setCookies}.
	 *
	 * @example
	 * ```typescript
	 * // Simple logout - clear all cookies
	 * rezo.clearCookies();
	 *
	 * // Save cookies before clearing (if needed)
	 * const savedCookies = rezo.getCookies();
	 * rezo.clearCookies();
	 * // Later, restore specific cookies if needed
	 * const importantCookies = savedCookies.array.filter(c => c.key === 'preferences');
	 * rezo.setCookies(importantCookies);
	 *
	 * // Clear and re-authenticate
	 * rezo.clearCookies();
	 * await rezo.post('https://api.example.com/login', {
	 *   username: 'newuser',
	 *   password: 'newpass'
	 * });
	 *
	 * // Use in test teardown
	 * afterEach(() => {
	 *   rezo.clearCookies(); // Clean state for next test
	 * });
	 * ```
	 *
	 * @see {@link getCookies} - Get all cookies before clearing
	 * @see {@link setCookies} - Restore or set new cookies after clearing
	 * @see {@link cookieJar} - Access the underlying RezoCookieJar for more control
	 */
	clearCookies(): void;
	/**
	 * Destroy this Rezo instance and clean up resources.
	 *
	 * Releases internal resources such as ProxyManager cooldown timers.
	 * Call this when the instance is no longer needed to prevent memory leaks.
	 *
	 * @example
	 * ```typescript
	 * const rezo = new Rezo({ proxyManager: new ProxyManager({ ... }) });
	 * // ... use rezo ...
	 * rezo.destroy(); // cleanup timers and state
	 * ```
	 */
	destroy(): void;
	/**
	 * Convert a Rezo request configuration to a cURL command string.
	 *
	 * Generates a valid cURL command that can be executed in a terminal to
	 * reproduce the same HTTP request. Useful for:
	 * - Debugging and sharing requests
	 * - Documentation and examples
	 * - Testing requests outside of Node.js
	 * - Exporting requests to other tools
	 *
	 * @param config - Request configuration object
	 * @returns A cURL command string
	 *
	 * @example
	 * ```typescript
	 * const curl = Rezo.toCurl({
	 *   url: 'https://api.example.com/users',
	 *   method: 'POST',
	 *   headers: { 'Content-Type': 'application/json' },
	 *   body: { name: 'John', email: 'john@example.com' }
	 * });
	 * // Output: curl -X POST -H 'content-type: application/json' --data-raw '{"name":"John","email":"john@example.com"}' -L --compressed 'https://api.example.com/users'
	 * ```
	 */
	static toCurl(config: RezoRequestConfig | RezoRequestOptions): string;
	/**
	 * Parse a cURL command string into a Rezo request configuration.
	 *
	 * Converts a cURL command into a configuration object that can be
	 * passed directly to Rezo request methods. Useful for:
	 * - Importing requests from browser DevTools
	 * - Converting curl examples from API documentation
	 * - Migrating scripts from curl to Rezo
	 *
	 * Supports common cURL options:
	 * - `-X, --request` - HTTP method
	 * - `-H, --header` - Request headers
	 * - `-d, --data, --data-raw, --data-binary` - Request body
	 * - `-u, --user` - Basic authentication
	 * - `-x, --proxy` - Proxy configuration
	 * - `--socks5, --socks4` - SOCKS proxy
	 * - `-L, --location` - Follow redirects
	 * - `--max-redirs` - Maximum redirects
	 * - `--max-time` - Request timeout
	 * - `-k, --insecure` - Skip TLS verification
	 * - `-A, --user-agent` - User agent header
	 *
	 * @param curlCommand - A cURL command string
	 * @returns A request configuration object
	 *
	 * @example
	 * ```typescript
	 * // From browser DevTools "Copy as cURL"
	 * const config = Rezo.fromCurl(`
	 *   curl 'https://api.example.com/data' \\
	 *     -H 'Authorization: Bearer token123' \\
	 *     -H 'Content-Type: application/json'
	 * `);
	 *
	 * // Use with Rezo
	 * const rezo = new Rezo();
	 * const response = await rezo.request(config);
	 * ```
	 */
	static fromCurl(curlCommand: string): RezoRequestOptions;
}
/**
 * Proxy configuration interface
 * @description Defines the structure for proxy server configuration
 * supporting HTTP, HTTPS, and SOCKS proxies with authentication.
 */
export type IProxy = RezoRequestConfig["proxy"];
interface queueOptions$1 {
	/** Queue name (optional) - if not provided, a random name will be generated */
	name?: string;
	/** Maximum concurrent requests */
	concurrency?: number;
	/** Interval in milliseconds between batches */
	interval?: number;
	/** Maximum requests per interval */
	intervalCap?: number;
	/** Request timeout in milliseconds */
	timeout?: number;
	/** Throw error on timeout */
	throwOnTimeout?: boolean;
	/** Auto-start the queue */
	autoStart?: boolean;
	/** Carry over concurrency count between intervals */
	carryoverConcurrencyCount?: boolean;
	/**
	 * Random delay in milliseconds added to each request (0 to randomDelay).
	 * When configured on a limiter, this takes
	 * priority over autoThrottle for the matching domain.
	 * @example
	 * ```typescript
	 * // Add 0-2000ms random jitter between requests
	 * crawler.config.addLimiter({
	 *   domain: 'api.example.com',
	 *   options: { concurrency: 2, randomDelay: 2000 }
	 * });
	 * ```
	 */
	randomDelay?: number;
}
/**
 * Crawler response structure
 * @description Standardized response format for crawler operations.
 */
export interface CrawlerResponse<T = any> {
	/** Response data */
	data: T;
	/** HTTP status code */
	status: number;
	/** HTTP status text */
	statusText: string;
	/** Response headers */
	headers: Record<string, string>;
	/** Original request URL */
	url: string;
	/** Final URL after redirects */
	finalUrl: string;
	/** Content-Type header value */
	contentType?: string;
	/** Content-Length header value */
	contentLength?: number;
	/** Serialized cookies from response */
	cookies?: string;
}
declare const options: {
	readonly user_agent_type: {
		readonly label: "Browser";
		readonly options: {
			readonly Desktop: "desktop";
			readonly "Desktop Chrome": "desktop_chrome";
			readonly "Desktop Edge": "desktop_edge";
			readonly "Desktop Firefox": "desktop_firefox";
			readonly "Desktop Opera": "desktop_opera";
			readonly "Desktop Safari": "desktop_safari";
			readonly Mobile: "mobile";
			readonly "Mobile Android": "mobile_android";
			readonly "Mobile iOS": "mobile_ios";
			readonly Tablet: "tablet";
			readonly "Tablet Android": "tablet_android";
			readonly "Tablet iOS": "tablet_ios";
		};
	};
	readonly locale: {
		readonly label: "Locale";
		readonly options: {
			readonly "Afghanistan - Pashto": "ps-af";
			readonly "Afghanistan - Persian": "fa-af";
			readonly "Albania - Albanian": "sq-al";
			readonly "Albania - English": "en-al";
			readonly "Algeria - Arabic": "ar-dz";
			readonly "Algeria - French": "fr-dz";
			readonly "American Samoa - English": "en-as";
			readonly "Andorra - Catalan": "ca-ad";
			readonly "Angola - Kikongo": "kg-ao";
			readonly "Angola - Portuguese": "pt-ao";
			readonly "Anguilla - English": "en-ai";
			readonly "Antigua and Barbuda - English": "en-ag";
			readonly "Argentina - Latin American Spanish": "es-419-ar";
			readonly "Argentina - Spanish": "es-ar";
			readonly "Armenia - Armenian": "hy-am";
			readonly "Armenia - Russian": "ru-am";
			readonly "Australia - English": "en-au";
			readonly "Austria - German": "de-at";
			readonly "Azerbaijan - Azerbaijani": "az-az";
			readonly "Azerbaijan - Russian": "ru-az";
			readonly "Bahamas - English": "en-bs";
			readonly "Bahrain - Arabic": "ar-bh";
			readonly "Bahrain - English": "en-bh";
			readonly "Bangladesh - Bengali": "bn-bd";
			readonly "Bangladesh - English": "en-bd";
			readonly "Belarus - Belarusian": "be-by";
			readonly "Belarus - English": "en-by";
			readonly "Belarus - Russian": "ru-by";
			readonly "Belgium - Dutch": "nl-be";
			readonly "Belgium - English": "en-be";
			readonly "Belgium - French": "fr-be";
			readonly "Belgium - German": "de-be";
			readonly "Belize - English": "en-bz";
			readonly "Belize - Latin American Spanish": "es-419-bz";
			readonly "Belize - Spanish": "es-bz";
			readonly "Benin - French": "fr-bj";
			readonly "Benin - Yoruba": "yo-bj";
			readonly "Bhutan - English": "en-bt";
			readonly "Bolivia - Latin American Spanish": "es-419-bo";
			readonly "Bolivia - Quechua": "qu-bo";
			readonly "Bolivia - Spanish": "es-bo";
			readonly "Bosnia and Herzegovina - Bosnian": "bs-ba";
			readonly "Bosnia and Herzegovina - Croatian": "hr-ba";
			readonly "Bosnia and Herzegovina - Serbian": "sr-ba";
			readonly "Botswana - English": "en-bw";
			readonly "Botswana - Tswana": "tn-bw";
			readonly "Brazil - Portuguese": "pt-br";
			readonly "British Virgin Islands - English": "en-vg";
			readonly "Brunei - Chinese": "zh-bn";
			readonly "Brunei - English": "en-bn";
			readonly "Brunei - Malay": "ms-bn";
			readonly "Bulgaria - Bulgarian": "bg-bg";
			readonly "Burkina Faso - French": "fr-bf";
			readonly "Burundi - French": "fr-bi";
			readonly "Burundi - Kirundi": "rn-bi";
			readonly "Burundi - Swahili": "sw-bi";
			readonly "Cambodia - English": "en-kh";
			readonly "Cambodia - Kmher": "km-kh";
			readonly "Cameroon - English": "en-cm";
			readonly "Cameroon - French": "fr-cm";
			readonly "Canada - English": "en-ca";
			readonly "Canada - French": "fr-ca";
			readonly "Canada - Latin American Spanish": "es-419-ca";
			readonly "Cape Verde - Portuguese": "pt-cv";
			readonly "Central African Republic - French": "fr-cf";
			readonly "Chad - Arabic": "ar-td";
			readonly "Chad - French": "fr-td";
			readonly "Chile - Latin American Spanish": "es-419-cl";
			readonly "Chile - Spanish": "es-cl";
			readonly "China - Chinese (Simplified)": "zh-cn";
			readonly "Colombia - Latin American Spanish": "es-419-co";
			readonly "Colombia - Spanish": "es-co";
			readonly "Cook Islands - English": "en-ck";
			readonly "Costa Rica - English": "en-cr";
			readonly "Costa Rica - Latin American Spanish": "es-419-cr";
			readonly "Costa Rica - Spanish": "es-cr";
			readonly "Croatia - Croatian": "hr-hr";
			readonly "Cuba - Latin American Spanish": "es-419-cu";
			readonly "Cuba - Spanish": "es-cu";
			readonly "Cyprus - English": "en-cy";
			readonly "Cyprus - Greek": "el-cy";
			readonly "Cyprus - Turkish": "tr-cy";
			readonly "Czech Republic - Czech": "cs-cz";
			readonly "Democratic Republic of the Congo - Acoli": "ach-CD";
			readonly "Denmark - Danish": "da-dk";
			readonly "Denmark - Faroese": "fo-dk";
			readonly "Djibouti - Arabic": "ar-dj";
			readonly "Djibouti - French": "fr-dj";
			readonly "Djibouti - Somali": "so-dj";
			readonly "Dominica - English": "en-dm";
			readonly "Dominican Republic - Latin American Spanish": "es-419-do";
			readonly "Dominican Republic - Spanish": "es-do";
			readonly "Ecuador - Latin American Spanish": "es-419-ec";
			readonly "Ecuador - Spanish": "es-ec";
			readonly "Egypt - Arabic": "ar-eg";
			readonly "Egypt - English": "en-eg";
			readonly "El Salvador - Latin American Spanish": "es-419-sv";
			readonly "El Salvador - Spanish": "es-sv";
			readonly "Estonia - Estonian": "et-ee";
			readonly "Estonia - Russian": "ru-ee";
			readonly "Ethiopia - Amharic": "am-et";
			readonly "Ethiopia - English": "en-et";
			readonly "Ethiopia - Somali": "so-et";
			readonly "Federated States of Micronesia - English": "en-fm";
			readonly "Fiji - English": "en-fj";
			readonly "Finland - Finnish": "fi-fi";
			readonly "Finland - Swedish": "sv-fi";
			readonly "France - French": "fr-fr";
			readonly "Gabon - French": "fr-ga";
			readonly "Gambia - English": "en-gm";
			readonly "Gambia - Wolof": "wo-gm";
			readonly "Georgia - Kartuli": "ka-ge";
			readonly "Germany - German": "de-de";
			readonly "Ghana - English": "en-gh";
			readonly "Gibraltar - English": "en-gi";
			readonly "Gibraltar - Italian": "it-gi";
			readonly "Gibraltar - Portuguese": "pt-gi";
			readonly "Gibraltar - Spanish": "es-gi";
			readonly "Greece - Greek": "el-gr";
			readonly "Greenland - Danish": "da-gl";
			readonly "Greenland - English": "en-gl";
			readonly "Guadeloupe - French": "fr-gp";
			readonly "Guatemala - Latin American Spanish": "es-419-gt";
			readonly "Guatemala - Spanish": "es-gt";
			readonly "Guernsey - English": "en-gg";
			readonly "Guernsey - French": "fr-gg";
			readonly "Guyana - English": "en-gy";
			readonly "Haiti - English": "en-ht";
			readonly "Haiti - French": "fr-ht";
			readonly "Haiti - Haitian Creole": "ht-ht";
			readonly "Honduras - Latin American Spanish": "es-419-hn";
			readonly "Honduras - Spanish": "es-hn";
			readonly "Hong Kong - Chinese (Simplified Han)": "zh-cn-hk";
			readonly "Hong Kong - Chinese (Traditional Han)": "zh-hk-hk";
			readonly "Hong Kong - English": "en-hk";
			readonly "Hungary - Hungarian": "hu-hu";
			readonly "Iceland - English": "en-is";
			readonly "Iceland - Icelandic": "is-is";
			readonly "India - Bengali": "bn-in";
			readonly "India - English": "en-in";
			readonly "India - Gujarati": "gu-in";
			readonly "India - Hindi": "hi-in";
			readonly "India - Kannada": "ka-in";
			readonly "India - Malayalam": "ml-in";
			readonly "India - Marathi": "mr-in";
			readonly "India - Punjabi": "pa-in";
			readonly "India - Tamil": "ta-in";
			readonly "India - Telugu": "te-in";
			readonly "Indonesia - English": "en-id";
			readonly "Indonesia - Indonesian": "id-id";
			readonly "Indonesia - Javanese": "jw-id";
			readonly "Iraq - Arabic": "ar-iq";
			readonly "Iraq - English": "en-iq";
			readonly "Ireland - English": "en-ie";
			readonly "Ireland - Irish": "ga-ie";
			readonly "Isle of Man - English": "en-im";
			readonly "Israel - Arabic": "ar-il";
			readonly "Israel - English": "en-il";
			readonly "Israel - Hebrew": "iw-il";
			readonly "Italy - Italian": "it-it";
			readonly "Ivory Coast - French": "fr-ci";
			readonly "Jamaica - English": "en-jm";
			readonly "Japan - Japanese": "ja-jp";
			readonly "Jersey - English": "en-je";
			readonly "Jordan - Arabic": "ar-jo";
			readonly "Jordan - English": "en-jo";
			readonly "Kazakhstan - Kazakh": "kk-kz";
			readonly "Kazakhstan - Russian": "ru-kz";
			readonly "Kenya - English": "en-ke";
			readonly "Kenya - Swahili": "sw-ke";
			readonly "Kiribati - English": "en-ki";
			readonly "Kurgyzstan - Kyrgyz": "ky-kg";
			readonly "Kurgyzstan - Russian": "ru-kg";
			readonly "Kuwait - Arabic": "ar-kw";
			readonly "Kuwait - English": "en-kw";
			readonly "Laos - English": "en-la";
			readonly "Laos - Lao": "lo-la";
			readonly "Latvia - Latvian": "lv-lv";
			readonly "Latvia - Lithuanian": "lt-lv";
			readonly "Latvia - Russian": "ru-lv";
			readonly "Lebanon - Arabic": "ar-lb";
			readonly "Lebanon - English": "en-lb";
			readonly "Lebanon - French": "fr-lb";
			readonly "Lesotho - English": "en-ls";
			readonly "Lesotho - Sesotho": "st-ls";
			readonly "Libya - Arabic": "ar-ly";
			readonly "Libya - English": "en-ly";
			readonly "Libya - Italian": "it-ly";
			readonly "Liechtenstein - German": "de-li";
			readonly "Lithuania - Lithuanian": "lt-lt";
			readonly "Luxembourg - French": "fr-lu";
			readonly "Luxembourg - German": "de-lu";
			readonly "Macedonia - Macedonian": "mk-mk";
			readonly "Madagascar - French": "fr-mg";
			readonly "Madagascar - Malagasy": "mg-mg";
			readonly "Malawi - Chichewa": "ny-mw";
			readonly "Malawi - English": "en-mw";
			readonly "Malaysia - English": "en-my";
			readonly "Malaysia - Malay": "ms-my";
			readonly "Maldives - English": "en-mv";
			readonly "Mali - French": "fr-ml";
			readonly "Malta - English": "en-mt";
			readonly "Malta - Maltese": "mt-mt";
			readonly "Mauritius - English": "en-mu";
			readonly "Mauritius - French": "fr-mu";
			readonly "Mauritius - Mauritian Creole": "mfe-mu";
			readonly "Mexico - Latin American Spanish": "es-419-mx";
			readonly "Mexico - Spanish": "es-mx";
			readonly "Moldova - Moldovan": "mo-md";
			readonly "Moldova - Russian": "ru-md";
			readonly "Mongolia - Mongolian": "mn-mn";
			readonly "Montenegro - Croatian": "bs-me";
			readonly "Montenegro - Montenegrin": "sr-me-me";
			readonly "Montenegro - Serbian": "sr-me";
			readonly "Montserrat - English": "en-ms";
			readonly "Morocco - Arabic": "ar-ma";
			readonly "Morocco - French": "fr-ma";
			readonly "Mozambique - Portuguese": "pt-mz";
			readonly "Myanmar - Burmese": "my-mm";
			readonly "Myanmar - English": "en-mm";
			readonly "Namibia - Afrikaans": "af-na";
			readonly "Namibia - English": "en-na";
			readonly "Namibia - German": "de-na";
			readonly "Nauru - English": "en-nr";
			readonly "Nepal - English": "en-np";
			readonly "Nepal - Nepali": "ne-np";
			readonly "Netherlands - Dutch": "nl-nl";
			readonly "New Zealand - English": "en-nz";
			readonly "New Zealand - Maori": "mi-nz";
			readonly "Nicaragua - English": "en-ni";
			readonly "Nicaragua - Latin American Spanish": "es-419-ni";
			readonly "Nicaragua - Spanish": "es-ni";
			readonly "Niger - French": "fr-ne";
			readonly "Niger - Hausa": "ha-ne";
			readonly "Nigeria - English": "en-ng";
			readonly "Nigeria - Hausa": "ha-ng";
			readonly "Nigeria - Igbo": "ig-ng";
			readonly "Nigeria - Yoruba": "yo-ng";
			readonly "Niue - English": "en-nu";
			readonly "Norfolk Island - English": "en-nf";
			readonly "Norway - Norwegian": "no-no";
			readonly "Oman - Arabic": "ar-om";
			readonly "Oman - English": "en-om";
			readonly "Pakistan - English": "en-pk";
			readonly "Pakistan - Urdu": "ur-pk";
			readonly "Palestinian territories - Arabic": "ar-ps";
			readonly "Palestinian territories - English": "en-ps";
			readonly "Panama - English": "en-pa";
			readonly "Panama - Latin American Spanish": "es-419-pa";
			readonly "Panama - Spanish": "es-pa";
			readonly "Papua New Guinea - English": "en-pg";
			readonly "Paraguay - Latin American Spanish": "es-419-py";
			readonly "Paraguay - Spanish": "es-py";
			readonly "Peru - Latin American Spanish": "es-419-pe";
			readonly "Peru - Spanish": "es-pe";
			readonly "Philippines - English": "en-ph";
			readonly "Philippines - Filipino": "fil-ph";
			readonly "Pitcairn Island - English": "en-pn";
			readonly "Poland - Polish": "pl-pl";
			readonly "Portugal - Portuguese": "pt-pt";
			readonly "Puerto Rico - English": "en-pr";
			readonly "Puerto Rico - Latin American Spanish": "es-419-pr";
			readonly "Puerto Rico - Spanish": "es-pr";
			readonly "Qatar - Arabic": "ar-qa";
			readonly "Qatar - English": "en-qa";
			readonly "Republic of the Congo - Acoli": "ach-CG";
			readonly "Republic of the Congo - French": "fr-cg";
			readonly "Romania - German": "de-ro";
			readonly "Romania - Hungarian": "hu-ro";
			readonly "Romania - Romanian": "ro-ro";
			readonly "Russia - Russian": "ru-ru";
			readonly "Rwanda - English": "en-rw";
			readonly "Rwanda - French": "fr-rw";
			readonly "Rwanda - Kinyarwanda": "rw-rw";
			readonly "Rwanda - Swahili": "sw-rw";
			readonly "Saint Helena": "en-sh";
			readonly "Saint Vincent and the Grenadines - English": "en-vc";
			readonly "Samoa - English": "en-ws";
			readonly "San Marino - Italian": "it-sm";
			readonly "Saudi Arabia - Arabic": "ar-sa";
			readonly "Saudi Arabia - English": "en-sa";
			readonly "Senegal - French": "fr-sn";
			readonly "Serbia - Serbian": "sr-rs";
			readonly "Seychelles - English": "en-sc";
			readonly "Seychelles - French": "fr-sc";
			readonly "Seychelles - Seychellois Creole": "crs-sc";
			readonly "Siera Leone - English": "en-sl";
			readonly "Singapore - Chinese": "zh-sg";
			readonly "Singapore - English": "en-sg";
			readonly "Singapore - Malay": "ms-sg";
			readonly "Singapore - Tamil": "ta-sg";
			readonly "Slovakia - Slovak": "sk-sk";
			readonly "Slovenia - Slovenian": "sl-si";
			readonly "Solomon Islands - English": "en-sb";
			readonly "Somalia - Arabic": "ar-so";
			readonly "Somalia - English": "en-so";
			readonly "Somalia - Somali": "so-so";
			readonly "South Africa - Afrikaans": "af-za";
			readonly "South Africa - English": "en-za";
			readonly "South Africa - IsiXhosa": "xh-za";
			readonly "South Africa - IsiZulu": "zu-za";
			readonly "South Africa - Nothern Sotho": "nso-za";
			readonly "South Africa - Sesotho": "st-za";
			readonly "South Africa - Setswana": "tn-za";
			readonly "South Korea - Korean": "ko-kr";
			readonly "Spain - Catalan": "ca-es";
			readonly "Spain - Spanish": "es-es";
			readonly "Sri Lanka - English": "en-lk";
			readonly "Sri Lanka - Sinhala": "si-lk";
			readonly "Sri Lanka - Tamil": "ta-lk";
			readonly "Suriname - Dutch": "nl-sr";
			readonly "Suriname - English": "en-sr";
			readonly "Sweden - Swedish": "sv-se";
			readonly "Switzerland - English": "en-ch";
			readonly "Switzerland - French": "fr-ch";
			readonly "Switzerland - German": "de-ch";
			readonly "Switzerland - Italian": "it-ch";
			readonly "Switzerland - Rumantsch": "rm-ch";
			readonly "S\u00E3o Tom\u00E9 and Pr\u00EDncipe - Portuguese": "pt-st";
			readonly "Taiwan - Chinese": "zh-tw";
			readonly "Tajikistan - Russian": "ru-tj";
			readonly "Tajikistan - Tajik": "tg-tj";
			readonly "Tanzania - English": "en-tz";
			readonly "Tanzania - Swahili": "sw-tz";
			readonly "Thailand - English": "en-th";
			readonly "Thailand - Thai": "th-th";
			readonly "The Democratic Republic of the Congo - French": "fr-cd";
			readonly "Timor-Leste - Indonesian": "id-TL";
			readonly "Timor-Leste - Portuguese": "pt-tl";
			readonly "Togo - French": "fr-tg";
			readonly "Tokelau - English": "en-tk";
			readonly "Tonga - English": "en-to";
			readonly "Tonga - Tongan": "to-to";
			readonly "Trinidad and Tobago - English": "en-tt";
			readonly "Trinidad and Tobago - French": "fr-tt";
			readonly "Trinidad and Tobago - Latin American Spanish": "es-419-tt";
			readonly "Trinidad and Tobago - Spanish": "es-tt";
			readonly "Tunisia - Arabic": "ar-tn";
			readonly "Tunisia - English": "en-tn";
			readonly "Turkey - Turkish": "tr-tr";
			readonly "Turkmenistan - Russian": "ru-tm";
			readonly "Turkmenistan - Turkmen": "tk-tm";
			readonly "Uganda - English": "en-ug";
			readonly "Uganda - Kiswahili": "sw-ug";
			readonly "Ukraine - Russian": "ru-ua";
			readonly "Ukraine - Ukranian": "uk-ua";
			readonly "United Arab Emirates - Arabic": "ar-ae";
			readonly "United Arab Emirates - English": "en-ae";
			readonly "United Kingdom - English": "en-gb";
			readonly "United States - English": "en-us";
			readonly "United States - Korean": "ko-us";
			readonly "United States - Latin American Spanish": "es-419-us";
			readonly "United States - Simplified Chinese": "zh-cn-us";
			readonly "United States - Spanish": "es-us";
			readonly "United States - Traditional Chinese": "zh-tw-us";
			readonly "United States - Vietnamese": "vi-us";
			readonly "United States Virgin Islands - English": "en-vi";
			readonly "Uruguay - Latin American Spanish": "es-419-uy";
			readonly "Uruguay - Spanish": "es-uy";
			readonly "Uzbekistan - Russian": "ru-uz";
			readonly "Uzbekistan - Uzbek": "uz-uz";
			readonly "Vanuatu - English": "en-vu";
			readonly "Vanuatu - French": "fr-vu";
			readonly "Venezuela - Latin American Spanish": "es-419-ve";
			readonly "Venezuela - Spanish": "es-ve";
			readonly "Vietnam - English": "en-vn";
			readonly "Vietnam - French": "fr-vn";
			readonly "Vietnam - Taiwanese": "zh-vn";
			readonly "Vietnam - Vietnamese": "vi-vn";
			readonly "Zambia - English": "en-zm";
			readonly "Zimbabwe - English": "en-zw";
			readonly "Zimbabwe - Ndebele": "zu-zw";
			readonly "Zimbabwe - Shona": "sn-zw";
		};
	};
	readonly geo_location: {
		readonly label: "Location";
		readonly options: {
			readonly "Aaland Islands": "Aaland Islands";
			readonly Afghanistan: "Afghanistan";
			readonly Albania: "Albania";
			readonly Algeria: "Algeria";
			readonly "American Samoa": "American Samoa";
			readonly Andorra: "Andorra";
			readonly Angola: "Angola";
			readonly Anguilla: "Anguilla";
			readonly Antarctica: "Antarctica";
			readonly "Antigua and Barbuda": "Antigua and Barbuda";
			readonly Argentina: "Argentina";
			readonly Armenia: "Armenia";
			readonly Aruba: "Aruba";
			readonly Australia: "Australia";
			readonly Austria: "Austria";
			readonly Azerbaijan: "Azerbaijan";
			readonly Bahamas: "Bahamas";
			readonly Bahrain: "Bahrain";
			readonly Bangladesh: "Bangladesh";
			readonly Barbados: "Barbados";
			readonly Belarus: "Belarus";
			readonly Belgium: "Belgium";
			readonly Belize: "Belize";
			readonly Benin: "Benin";
			readonly Bermuda: "Bermuda";
			readonly Bhutan: "Bhutan";
			readonly "Bolivia Plurinational State of": "Bolivia Plurinational State of";
			readonly "Bonaire Sint Eustatius and Saba": "Bonaire Sint Eustatius and Saba";
			readonly "Bosnia and Herzegovina": "Bosnia and Herzegovina";
			readonly Botswana: "Botswana";
			readonly "Bouvet Island": "Bouvet Island";
			readonly Brazil: "Brazil";
			readonly "British Indian Ocean Territory": "British Indian Ocean Territory";
			readonly "Brunei Darussalam": "Brunei Darussalam";
			readonly Bulgaria: "Bulgaria";
			readonly "Burkina Faso": "Burkina Faso";
			readonly Burundi: "Burundi";
			readonly "Cabo Verde": "Cabo Verde";
			readonly Cambodia: "Cambodia";
			readonly Cameroon: "Cameroon";
			readonly Canada: "Canada";
			readonly "Cayman Islands": "Cayman Islands";
			readonly "Central African Republic": "Central African Republic";
			readonly Chad: "Chad";
			readonly Chile: "Chile";
			readonly China: "China";
			readonly "Christmas Island": "Christmas Island";
			readonly "Cocos Keeling Islands": "Cocos Keeling Islands";
			readonly Colombia: "Colombia";
			readonly Comoros: "Comoros";
			readonly Congo: "Congo";
			readonly "Congo the Democratic Republic of the": "Congo the Democratic Republic of the";
			readonly "Cook Islands": "Cook Islands";
			readonly "Costa Rica": "Costa Rica";
			readonly Croatia: "Croatia";
			readonly Cuba: "Cuba";
			readonly "Cura\u00C3\u00A7ao": "Cura\u00C3\u00A7ao";
			readonly Cyprus: "Cyprus";
			readonly Czechia: "Czechia";
			readonly "C\u00C3\u00B4te dIvoire": "C\u00C3\u00B4te dIvoire";
			readonly Denmark: "Denmark";
			readonly Djibouti: "Djibouti";
			readonly Dominica: "Dominica";
			readonly "Dominican Republic": "Dominican Republic";
			readonly Ecuador: "Ecuador";
			readonly Egypt: "Egypt";
			readonly "El Salvador": "El Salvador";
			readonly "Equatorial Guinea": "Equatorial Guinea";
			readonly Eritrea: "Eritrea";
			readonly Estonia: "Estonia";
			readonly Eswatini: "Eswatini";
			readonly Ethiopia: "Ethiopia";
			readonly "Falkland Islands [Malvinas]": "Falkland Islands [Malvinas]";
			readonly "Faroe Islands": "Faroe Islands";
			readonly Fiji: "Fiji";
			readonly Finland: "Finland";
			readonly France: "France";
			readonly "French Guiana": "French Guiana";
			readonly "French Polynesia": "French Polynesia";
			readonly "French Southern Territories": "French Southern Territories";
			readonly Gabon: "Gabon";
			readonly Gambia: "Gambia";
			readonly Georgia: "Georgia";
			readonly Germany: "Germany";
			readonly Ghana: "Ghana";
			readonly Gibraltar: "Gibraltar";
			readonly Greece: "Greece";
			readonly Greenland: "Greenland";
			readonly Grenada: "Grenada";
			readonly Guadeloupe: "Guadeloupe";
			readonly Guam: "Guam";
			readonly Guatemala: "Guatemala";
			readonly Guernsey: "Guernsey";
			readonly Guinea: "Guinea";
			readonly "Guinea-Bissau": "Guinea-Bissau";
			readonly Guyana: "Guyana";
			readonly Haiti: "Haiti";
			readonly "Heard Island and McDonald Islands": "Heard Island and McDonald Islands";
			readonly "Holy See": "Holy See";
			readonly Honduras: "Honduras";
			readonly "Hong Kong": "Hong Kong";
			readonly Hungary: "Hungary";
			readonly Iceland: "Iceland";
			readonly India: "India";
			readonly Indonesia: "Indonesia";
			readonly "Iran Islamic Republic of": "Iran Islamic Republic of";
			readonly Iraq: "Iraq";
			readonly Ireland: "Ireland";
			readonly "Isle of Man": "Isle of Man";
			readonly Israel: "Israel";
			readonly Italy: "Italy";
			readonly Jamaica: "Jamaica";
			readonly Japan: "Japan";
			readonly Jersey: "Jersey";
			readonly Jordan: "Jordan";
			readonly Kazakhstan: "Kazakhstan";
			readonly Kenya: "Kenya";
			readonly Kiribati: "Kiribati";
			readonly Korea: "Korea";
			readonly Kuwait: "Kuwait";
			readonly Kyrgyzstan: "Kyrgyzstan";
			readonly "Lao Peoples Democratic Republic": "Lao Peoples Democratic Republic";
			readonly Latvia: "Latvia";
			readonly Lebanon: "Lebanon";
			readonly Lesotho: "Lesotho";
			readonly Liberia: "Liberia";
			readonly Libya: "Libya";
			readonly Liechtenstein: "Liechtenstein";
			readonly Lithuania: "Lithuania";
			readonly Luxembourg: "Luxembourg";
			readonly Macao: "Macao";
			readonly Madagascar: "Madagascar";
			readonly Malawi: "Malawi";
			readonly Malaysia: "Malaysia";
			readonly Maldives: "Maldives";
			readonly Mali: "Mali";
			readonly Malta: "Malta";
			readonly "Marshall Islands": "Marshall Islands";
			readonly Martinique: "Martinique";
			readonly Mauritania: "Mauritania";
			readonly Mauritius: "Mauritius";
			readonly Mayotte: "Mayotte";
			readonly Mexico: "Mexico";
			readonly "Micronesia Federated States of": "Micronesia Federated States of";
			readonly "Moldova Republic of": "Moldova Republic of";
			readonly Monaco: "Monaco";
			readonly Mongolia: "Mongolia";
			readonly Montenegro: "Montenegro";
			readonly Montserrat: "Montserrat";
			readonly Morocco: "Morocco";
			readonly Mozambique: "Mozambique";
			readonly Myanmar: "Myanmar";
			readonly Namibia: "Namibia";
			readonly Nauru: "Nauru";
			readonly Nepal: "Nepal";
			readonly Netherlands: "Netherlands";
			readonly "New Caledonia": "New Caledonia";
			readonly "New Zealand": "New Zealand";
			readonly Nicaragua: "Nicaragua";
			readonly Niger: "Niger";
			readonly Nigeria: "Nigeria";
			readonly Niue: "Niue";
			readonly "Norfolk Island": "Norfolk Island";
			readonly "Northern Mariana Islands": "Northern Mariana Islands";
			readonly Norway: "Norway";
			readonly Oman: "Oman";
			readonly Pakistan: "Pakistan";
			readonly Palau: "Palau";
			readonly "Palestine State of": "Palestine State of";
			readonly Panama: "Panama";
			readonly "Papua New Guinea": "Papua New Guinea";
			readonly Paraguay: "Paraguay";
			readonly Peru: "Peru";
			readonly Philippines: "Philippines";
			readonly Pitcairn: "Pitcairn";
			readonly Poland: "Poland";
			readonly Portugal: "Portugal";
			readonly "Puerto Rico": "Puerto Rico";
			readonly Qatar: "Qatar";
			readonly "Republic of North Macedonia": "Republic of North Macedonia";
			readonly Romania: "Romania";
			readonly Russia: "Russia";
			readonly Rwanda: "Rwanda";
			readonly "R\u00C3\u00A9union": "R\u00C3\u00A9union";
			readonly "Saint Barth\u00C3\u00A9lemy": "Saint Barth\u00C3\u00A9lemy";
			readonly "Saint Helena Ascension and Tristan da Cunha": "Saint Helena Ascension and Tristan da Cunha";
			readonly "Saint Kitts and Nevis": "Saint Kitts and Nevis";
			readonly "Saint Lucia": "Saint Lucia";
			readonly "Saint Martin French part": "Saint Martin French part";
			readonly "Saint Pierre and Miquelon": "Saint Pierre and Miquelon";
			readonly "Saint Vincent and the Grenadines": "Saint Vincent and the Grenadines";
			readonly Samoa: "Samoa";
			readonly "San Marino": "San Marino";
			readonly "Sao Tome and Principe": "Sao Tome and Principe";
			readonly "Saudi Arabia": "Saudi Arabia";
			readonly Senegal: "Senegal";
			readonly Serbia: "Serbia";
			readonly Seychelles: "Seychelles";
			readonly "Sierra Leone": "Sierra Leone";
			readonly Singapore: "Singapore";
			readonly "Sint Maarten Dutch part": "Sint Maarten Dutch part";
			readonly Slovakia: "Slovakia";
			readonly Slovenia: "Slovenia";
			readonly "Solomon Islands": "Solomon Islands";
			readonly Somalia: "Somalia";
			readonly "South Africa": "South Africa";
			readonly "South Georgia and the South Sandwich Islands": "South Georgia and the South Sandwich Islands";
			readonly "South Sudan": "South Sudan";
			readonly Spain: "Spain";
			readonly "Sri Lanka": "Sri Lanka";
			readonly Sudan: "Sudan";
			readonly Suriname: "Suriname";
			readonly "Svalbard and Jan Mayen": "Svalbard and Jan Mayen";
			readonly Sweden: "Sweden";
			readonly Switzerland: "Switzerland";
			readonly "Syrian Arab Republic": "Syrian Arab Republic";
			readonly "Taiwan Province of China": "Taiwan Province of China";
			readonly Tajikistan: "Tajikistan";
			readonly "Tanzania United Republic of": "Tanzania United Republic of";
			readonly Thailand: "Thailand";
			readonly "Timor-Leste": "Timor-Leste";
			readonly Togo: "Togo";
			readonly Tokelau: "Tokelau";
			readonly Tonga: "Tonga";
			readonly "Trinidad and Tobago": "Trinidad and Tobago";
			readonly Tunisia: "Tunisia";
			readonly Turkey: "Turkey";
			readonly Turkmenistan: "Turkmenistan";
			readonly "Turks and Caicos Islands": "Turks and Caicos Islands";
			readonly Tuvalu: "Tuvalu";
			readonly Uganda: "Uganda";
			readonly Ukraine: "Ukraine";
			readonly "United Arab Emirates": "United Arab Emirates";
			readonly "United Kingdom": "United Kingdom";
			readonly "United States": "United States";
			readonly "United States Minor Outlying Islands": "United States Minor Outlying Islands";
			readonly Uruguay: "Uruguay";
			readonly Uzbekistan: "Uzbekistan";
			readonly Vanuatu: "Vanuatu";
			readonly "Venezuela Bolivarian Republic of": "Venezuela Bolivarian Republic of";
			readonly "Viet Nam": "Viet Nam";
			readonly "Virgin Islands British": "Virgin Islands British";
			readonly "Virgin Islands U.S.": "Virgin Islands U.S.";
			readonly "Wallis and Futuna": "Wallis and Futuna";
			readonly "Western Sahara": "Western Sahara";
			readonly Yemen: "Yemen";
			readonly Zambia: "Zambia";
			readonly Zimbabwe: "Zimbabwe";
		};
	};
};
export type GeoLocation = keyof typeof options.geo_location.options;
export type Locale = keyof typeof options.locale.options;
export type BrowserType = keyof typeof options.user_agent_type.options;
export interface OxylabsOptions {
	username: string;
	password: string;
	browserType?: BrowserType | string;
	locale?: Locale | string;
	geoLocation?: GeoLocation | string;
	http_method?: "get" | "post";
	base64Body?: string;
	returnAsBase64?: boolean;
	successful_status_codes?: number[];
	session_id?: string;
	follow_redirects?: boolean;
	javascript_rendering?: boolean;
	headers?: OutgoingHttpHeaders;
	cookies?: {
		key: string;
		value: string;
	}[];
	render?: boolean;
	context?: Record<string, any>;
	timeout?: number;
}
export type OxylabsConfig = OxylabsOptions;
/**
 * Oxylabs API Response Types
 *
 * Type definitions for the Oxylabs Web Scraper API responses.
 *
 * @module tools/addon/oxylabs/types
 * @author Rezo HTTP Client Library
 */
/**
 * Cookie structure returned by Oxylabs API
 */
export interface OxylabsCookie {
	/** Cookie name */
	key: string;
	/** Cookie value */
	value: string;
	/** Cookie domain */
	domain?: string;
	/** Cookie path */
	path?: string;
	/** Whether the cookie is secure */
	secure?: boolean;
	/** Whether the cookie is HTTP only */
	httponly?: boolean;
	/** Cookie expiration date string */
	expires?: string;
	/** Cookie max age in seconds */
	"max-age"?: string;
	/** Cookie SameSite attribute */
	samesite?: "Strict" | "Lax" | "None";
}
/**
 * Response headers from Oxylabs API
 */
export interface OxylabsHeaders {
	[key: string]: string;
}
/**
 * Internal response data from Oxylabs API
 */
export interface OxylabsInternalResponse {
	/** Response headers */
	headers?: OxylabsHeaders;
	/** Response cookies */
	cookies?: OxylabsCookie[];
}
/**
 * Individual result content from Oxylabs API
 */
export interface OxylabsContent {
	/** Page HTML content */
	content: string;
	/** HTTP status code of the scraped page */
	status_code: number;
	/** Final URL after redirects */
	url: string;
	/** Job ID */
	job_id?: string;
	/** Created timestamp */
	created_at?: string;
	/** Updated timestamp */
	updated_at?: string;
	/** Internal response data (headers, cookies) */
	_response?: OxylabsInternalResponse;
}
/**
 * Complete Oxylabs API response structure
 */
export interface OxylabsResponse {
	/** Array of results (usually contains one item) */
	results: OxylabsContent[];
	/** Job ID */
	job_id?: string;
	/** Request status */
	status?: string;
	/** Error message if request failed */
	error?: string;
}
/**
 * Scrape result with parsed content and metadata
 */
export interface OxylabsScrapeResult {
	/** HTTP status code of the scraped page */
	statusCode: number;
	/** Final URL after redirects */
	url: string;
	/** Page HTML content */
	content: string;
	/** Cookies from the response */
	cookies: OxylabsCookie[];
	/** Response headers */
	headers: Record<string, string>;
	/** Job ID for reference */
	jobId?: string;
	/** Whether JavaScript was rendered */
	rendered: boolean;
	/** Geo-location used */
	geoLocation?: string;
	/** Locale used */
	locale?: string;
	/** Browser type used */
	browserType?: string;
	/** Raw API response for advanced use */
	raw: OxylabsResponse;
}
declare class Oxylabs {
	private readonly config;
	private readonly http;
	private readonly authHeader;
	/**
	 * Create a new Oxylabs client instance
	 *
	 * @param config - Oxylabs API configuration
	 * @throws Error if username or password is missing
	 *
	 * @example
	 * ```typescript
	 * const oxylabs = new Oxylabs({
	 *   username: 'customer_id',
	 *   password: 'password',
	 *   render: true,
	 *   geoLocation: 'United States'
	 * });
	 * ```
	 */
	constructor(config: OxylabsConfig);
	/**
	 * Scrape a URL using Oxylabs Web Scraper API
	 *
	 * @param url - URL to scrape
	 * @param options - Per-request options to override defaults
	 * @returns Promise resolving to scrape result
	 * @throws Error if API request fails
	 *
	 * @example
	 * ```typescript
	 * // Simple scrape
	 * const result = await oxylabs.scrape('https://example.com');
	 *
	 * // With options
	 * const result = await oxylabs.scrape('https://example.com', {
	 *   geoLocation: 'Germany',
	 *   render: true
	 * });
	 *
	 * // Access result
	 * console.log(result.content);
	 * console.log(result.statusCode);
	 * console.log(result.cookies);
	 * ```
	 */
	scrape(url: string, options?: Partial<OxylabsConfig>): Promise<OxylabsScrapeResult>;
	/**
	 * Scrape multiple URLs in sequence
	 *
	 * @param urls - Array of URLs to scrape
	 * @param options - Per-request options to override defaults
	 * @param delayMs - Delay between requests in milliseconds (default: 1000)
	 * @returns Promise resolving to array of scrape results
	 *
	 * @example
	 * ```typescript
	 * const results = await oxylabs.scrapeMany([
	 *   'https://example.com/page1',
	 *   'https://example.com/page2'
	 * ], { geoLocation: 'United States' }, 2000);
	 * ```
	 */
	scrapeMany(urls: string[], options?: Partial<OxylabsConfig>, delayMs?: number): Promise<OxylabsScrapeResult[]>;
	/**
	 * Build the request body for Oxylabs API
	 */
	private buildRequestBody;
	/**
	 * Get the current configuration
	 *
	 * @returns Current Oxylabs configuration (password is masked)
	 */
	getConfig(): Omit<OxylabsConfig, "password"> & {
		password: "***";
	};
	/**
	 * Create a new instance with different configuration
	 *
	 * @param config - New configuration options
	 * @returns New Oxylabs instance
	 *
	 * @example
	 * ```typescript
	 * const usClient = oxylabs.withConfig({ geoLocation: 'United States' });
	 * const ukClient = oxylabs.withConfig({ geoLocation: 'United Kingdom' });
	 * ```
	 */
	withConfig(config: Partial<OxylabsConfig>): Oxylabs;
	/**
	 * Test the Oxylabs API connection
	 *
	 * @returns Promise resolving to true if connection is successful
	 * @throws Error if connection fails
	 */
	testConnection(): Promise<boolean>;
}
/**
 * Decodo API Response Types
 *
 * Type definitions for the Decodo (formerly Smartproxy) Web Scraping API responses.
 *
 * @module tools/addon/decodo/types
 * @author Rezo HTTP Client Library
 */
/**
 * Cookie structure returned by Decodo API
 */
export interface DecodoCookie {
	/** Cookie name */
	name: string;
	/** Cookie value */
	value: string;
	/** Cookie domain */
	domain?: string;
	/** Cookie path */
	path?: string;
	/** Whether the cookie is secure */
	secure?: boolean;
	/** Whether the cookie is HTTP only */
	httpOnly?: boolean;
	/** Cookie expiration timestamp */
	expires?: number;
	/** Cookie SameSite attribute */
	sameSite?: "Strict" | "Lax" | "None";
}
/**
 * Response headers from Decodo API
 */
export interface DecodoHeaders {
	[key: string]: string;
}
/**
 * Individual result content from Decodo API
 */
export interface DecodoContent {
	/** Page HTML content */
	body: string;
	/** HTTP status code of the scraped page */
	status_code: number;
	/** Final URL after redirects */
	url: string;
	/** Response headers */
	headers?: DecodoHeaders;
	/** Response cookies */
	cookies?: DecodoCookie[];
	/** Content type */
	content_type?: string;
	/** Response size in bytes */
	content_length?: number;
}
/**
 * Complete Decodo API response structure
 */
export interface DecodoResponse {
	/** Task ID */
	id: string;
	/** Task status */
	status: string;
	/** Result data */
	results: DecodoContent[];
	/** Error message if request failed */
	error?: string;
	/** Error code */
	error_code?: string;
}
declare const options$1: {
	readonly user_agent_type: {
		readonly label: "Browser";
		readonly options: {
			readonly Desktop: "desktop";
			readonly "Desktop Chrome": "desktop_chrome";
			readonly "Desktop Edge": "desktop_edge";
			readonly "Desktop Firefox": "desktop_firefox";
			readonly "Desktop Opera": "desktop_opera";
			readonly "Desktop Safari": "desktop_safari";
			readonly Mobile: "mobile";
			readonly "Mobile Android": "mobile_android";
			readonly "Mobile iOS": "mobile_ios";
			readonly Tablet: "tablet";
			readonly "Tablet Android": "tablet_android";
			readonly "Tablet iOS": "tablet_ios";
		};
	};
	readonly locale: {
		readonly label: "Locale";
		readonly options: {
			readonly "Afghanistan - Pashto": "ps-af";
			readonly "Afghanistan - Persian": "fa-af";
			readonly "Albania - Albanian": "sq-al";
			readonly "Albania - English": "en-al";
			readonly "Algeria - Arabic": "ar-dz";
			readonly "Algeria - French": "fr-dz";
			readonly "American Samoa - English": "en-as";
			readonly "Andorra - Catalan": "ca-ad";
			readonly "Angola - Kikongo": "kg-ao";
			readonly "Angola - Portuguese": "pt-ao";
			readonly "Anguilla - English": "en-ai";
			readonly "Antigua and Barbuda - English": "en-ag";
			readonly "Argentina - Latin American Spanish": "es-419-ar";
			readonly "Argentina - Spanish": "es-ar";
			readonly "Armenia - Armenian": "hy-am";
			readonly "Armenia - Russian": "ru-am";
			readonly "Australia - English": "en-au";
			readonly "Austria - German": "de-at";
			readonly "Azerbaijan - Azerbaijani": "az-az";
			readonly "Azerbaijan - Russian": "ru-az";
			readonly "Bahamas - English": "en-bs";
			readonly "Bahrain - Arabic": "ar-bh";
			readonly "Bahrain - English": "en-bh";
			readonly "Bangladesh - Bengali": "bn-bd";
			readonly "Bangladesh - English": "en-bd";
			readonly "Belarus - Belarusian": "be-by";
			readonly "Belarus - English": "en-by";
			readonly "Belarus - Russian": "ru-by";
			readonly "Belgium - Dutch": "nl-be";
			readonly "Belgium - English": "en-be";
			readonly "Belgium - French": "fr-be";
			readonly "Belgium - German": "de-be";
			readonly "Belize - English": "en-bz";
			readonly "Belize - Latin American Spanish": "es-419-bz";
			readonly "Belize - Spanish": "es-bz";
			readonly "Benin - French": "fr-bj";
			readonly "Benin - Yoruba": "yo-bj";
			readonly "Bhutan - English": "en-bt";
			readonly "Bolivia - Latin American Spanish": "es-419-bo";
			readonly "Bolivia - Quechua": "qu-bo";
			readonly "Bolivia - Spanish": "es-bo";
			readonly "Bosnia and Herzegovina - Bosnian": "bs-ba";
			readonly "Bosnia and Herzegovina - Croatian": "hr-ba";
			readonly "Bosnia and Herzegovina - Serbian": "sr-ba";
			readonly "Botswana - English": "en-bw";
			readonly "Botswana - Tswana": "tn-bw";
			readonly "Brazil - Portuguese": "pt-br";
			readonly "British Virgin Islands - English": "en-vg";
			readonly "Brunei - Chinese": "zh-bn";
			readonly "Brunei - English": "en-bn";
			readonly "Brunei - Malay": "ms-bn";
			readonly "Bulgaria - Bulgarian": "bg-bg";
			readonly "Burkina Faso - French": "fr-bf";
			readonly "Burundi - French": "fr-bi";
			readonly "Burundi - Kirundi": "rn-bi";
			readonly "Burundi - Swahili": "sw-bi";
			readonly "Cambodia - English": "en-kh";
			readonly "Cambodia - Kmher": "km-kh";
			readonly "Cameroon - English": "en-cm";
			readonly "Cameroon - French": "fr-cm";
			readonly "Canada - English": "en-ca";
			readonly "Canada - French": "fr-ca";
			readonly "Canada - Latin American Spanish": "es-419-ca";
			readonly "Cape Verde - Portuguese": "pt-cv";
			readonly "Central African Republic - French": "fr-cf";
			readonly "Chad - Arabic": "ar-td";
			readonly "Chad - French": "fr-td";
			readonly "Chile - Latin American Spanish": "es-419-cl";
			readonly "Chile - Spanish": "es-cl";
			readonly "China - Chinese (Simplified)": "zh-cn";
			readonly "Colombia - Latin American Spanish": "es-419-co";
			readonly "Colombia - Spanish": "es-co";
			readonly "Cook Islands - English": "en-ck";
			readonly "Costa Rica - English": "en-cr";
			readonly "Costa Rica - Latin American Spanish": "es-419-cr";
			readonly "Costa Rica - Spanish": "es-cr";
			readonly "Croatia - Croatian": "hr-hr";
			readonly "Cuba - Latin American Spanish": "es-419-cu";
			readonly "Cuba - Spanish": "es-cu";
			readonly "Cyprus - English": "en-cy";
			readonly "Cyprus - Greek": "el-cy";
			readonly "Cyprus - Turkish": "tr-cy";
			readonly "Czech Republic - Czech": "cs-cz";
			readonly "Democratic Republic of the Congo - Acoli": "ach-CD";
			readonly "Denmark - Danish": "da-dk";
			readonly "Denmark - Faroese": "fo-dk";
			readonly "Djibouti - Arabic": "ar-dj";
			readonly "Djibouti - French": "fr-dj";
			readonly "Djibouti - Somali": "so-dj";
			readonly "Dominica - English": "en-dm";
			readonly "Dominican Republic - Latin American Spanish": "es-419-do";
			readonly "Dominican Republic - Spanish": "es-do";
			readonly "Ecuador - Latin American Spanish": "es-419-ec";
			readonly "Ecuador - Spanish": "es-ec";
			readonly "Egypt - Arabic": "ar-eg";
			readonly "Egypt - English": "en-eg";
			readonly "El Salvador - Latin American Spanish": "es-419-sv";
			readonly "El Salvador - Spanish": "es-sv";
			readonly "Estonia - Estonian": "et-ee";
			readonly "Estonia - Russian": "ru-ee";
			readonly "Ethiopia - Amharic": "am-et";
			readonly "Ethiopia - English": "en-et";
			readonly "Ethiopia - Somali": "so-et";
			readonly "Federated States of Micronesia - English": "en-fm";
			readonly "Fiji - English": "en-fj";
			readonly "Finland - Finnish": "fi-fi";
			readonly "Finland - Swedish": "sv-fi";
			readonly "France - French": "fr-fr";
			readonly "Gabon - French": "fr-ga";
			readonly "Gambia - English": "en-gm";
			readonly "Gambia - Wolof": "wo-gm";
			readonly "Georgia - Kartuli": "ka-ge";
			readonly "Germany - German": "de-de";
			readonly "Ghana - English": "en-gh";
			readonly "Gibraltar - English": "en-gi";
			readonly "Gibraltar - Italian": "it-gi";
			readonly "Gibraltar - Portuguese": "pt-gi";
			readonly "Gibraltar - Spanish": "es-gi";
			readonly "Greece - Greek": "el-gr";
			readonly "Greenland - Danish": "da-gl";
			readonly "Greenland - English": "en-gl";
			readonly "Guadeloupe - French": "fr-gp";
			readonly "Guatemala - Latin American Spanish": "es-419-gt";
			readonly "Guatemala - Spanish": "es-gt";
			readonly "Guernsey - English": "en-gg";
			readonly "Guernsey - French": "fr-gg";
			readonly "Guyana - English": "en-gy";
			readonly "Haiti - English": "en-ht";
			readonly "Haiti - French": "fr-ht";
			readonly "Haiti - Haitian Creole": "ht-ht";
			readonly "Honduras - Latin American Spanish": "es-419-hn";
			readonly "Honduras - Spanish": "es-hn";
			readonly "Hong Kong - Chinese (Simplified Han)": "zh-cn-hk";
			readonly "Hong Kong - Chinese (Traditional Han)": "zh-hk-hk";
			readonly "Hong Kong - English": "en-hk";
			readonly "Hungary - Hungarian": "hu-hu";
			readonly "Iceland - English": "en-is";
			readonly "Iceland - Icelandic": "is-is";
			readonly "India - Bengali": "bn-in";
			readonly "India - English": "en-in";
			readonly "India - Gujarati": "gu-in";
			readonly "India - Hindi": "hi-in";
			readonly "India - Kannada": "ka-in";
			readonly "India - Malayalam": "ml-in";
			readonly "India - Marathi": "mr-in";
			readonly "India - Punjabi": "pa-in";
			readonly "India - Tamil": "ta-in";
			readonly "India - Telugu": "te-in";
			readonly "Indonesia - English": "en-id";
			readonly "Indonesia - Indonesian": "id-id";
			readonly "Indonesia - Javanese": "jw-id";
			readonly "Iraq - Arabic": "ar-iq";
			readonly "Iraq - English": "en-iq";
			readonly "Ireland - English": "en-ie";
			readonly "Ireland - Irish": "ga-ie";
			readonly "Isle of Man - English": "en-im";
			readonly "Israel - Arabic": "ar-il";
			readonly "Israel - English": "en-il";
			readonly "Israel - Hebrew": "iw-il";
			readonly "Italy - Italian": "it-it";
			readonly "Ivory Coast - French": "fr-ci";
			readonly "Jamaica - English": "en-jm";
			readonly "Japan - Japanese": "ja-jp";
			readonly "Jersey - English": "en-je";
			readonly "Jordan - Arabic": "ar-jo";
			readonly "Jordan - English": "en-jo";
			readonly "Kazakhstan - Kazakh": "kk-kz";
			readonly "Kazakhstan - Russian": "ru-kz";
			readonly "Kenya - English": "en-ke";
			readonly "Kenya - Swahili": "sw-ke";
			readonly "Kiribati - English": "en-ki";
			readonly "Kurgyzstan - Kyrgyz": "ky-kg";
			readonly "Kurgyzstan - Russian": "ru-kg";
			readonly "Kuwait - Arabic": "ar-kw";
			readonly "Kuwait - English": "en-kw";
			readonly "Laos - English": "en-la";
			readonly "Laos - Lao": "lo-la";
			readonly "Latvia - Latvian": "lv-lv";
			readonly "Latvia - Lithuanian": "lt-lv";
			readonly "Latvia - Russian": "ru-lv";
			readonly "Lebanon - Arabic": "ar-lb";
			readonly "Lebanon - English": "en-lb";
			readonly "Lebanon - French": "fr-lb";
			readonly "Lesotho - English": "en-ls";
			readonly "Lesotho - Sesotho": "st-ls";
			readonly "Libya - Arabic": "ar-ly";
			readonly "Libya - English": "en-ly";
			readonly "Libya - Italian": "it-ly";
			readonly "Liechtenstein - German": "de-li";
			readonly "Lithuania - Lithuanian": "lt-lt";
			readonly "Luxembourg - French": "fr-lu";
			readonly "Luxembourg - German": "de-lu";
			readonly "Macedonia - Macedonian": "mk-mk";
			readonly "Madagascar - French": "fr-mg";
			readonly "Madagascar - Malagasy": "mg-mg";
			readonly "Malawi - Chichewa": "ny-mw";
			readonly "Malawi - English": "en-mw";
			readonly "Malaysia - English": "en-my";
			readonly "Malaysia - Malay": "ms-my";
			readonly "Maldives - English": "en-mv";
			readonly "Mali - French": "fr-ml";
			readonly "Malta - English": "en-mt";
			readonly "Malta - Maltese": "mt-mt";
			readonly "Mauritius - English": "en-mu";
			readonly "Mauritius - French": "fr-mu";
			readonly "Mauritius - Mauritian Creole": "mfe-mu";
			readonly "Mexico - Latin American Spanish": "es-419-mx";
			readonly "Mexico - Spanish": "es-mx";
			readonly "Moldova - Moldovan": "mo-md";
			readonly "Moldova - Russian": "ru-md";
			readonly "Mongolia - Mongolian": "mn-mn";
			readonly "Montenegro - Croatian": "bs-me";
			readonly "Montenegro - Montenegrin": "sr-me-me";
			readonly "Montenegro - Serbian": "sr-me";
			readonly "Montserrat - English": "en-ms";
			readonly "Morocco - Arabic": "ar-ma";
			readonly "Morocco - French": "fr-ma";
			readonly "Mozambique - Portuguese": "pt-mz";
			readonly "Myanmar - Burmese": "my-mm";
			readonly "Myanmar - English": "en-mm";
			readonly "Namibia - Afrikaans": "af-na";
			readonly "Namibia - English": "en-na";
			readonly "Namibia - German": "de-na";
			readonly "Nauru - English": "en-nr";
			readonly "Nepal - English": "en-np";
			readonly "Nepal - Nepali": "ne-np";
			readonly "Netherlands - Dutch": "nl-nl";
			readonly "New Zealand - English": "en-nz";
			readonly "New Zealand - Maori": "mi-nz";
			readonly "Nicaragua - English": "en-ni";
			readonly "Nicaragua - Latin American Spanish": "es-419-ni";
			readonly "Nicaragua - Spanish": "es-ni";
			readonly "Niger - French": "fr-ne";
			readonly "Niger - Hausa": "ha-ne";
			readonly "Nigeria - English": "en-ng";
			readonly "Nigeria - Hausa": "ha-ng";
			readonly "Nigeria - Igbo": "ig-ng";
			readonly "Nigeria - Yoruba": "yo-ng";
			readonly "Niue - English": "en-nu";
			readonly "Norfolk Island - English": "en-nf";
			readonly "Norway - Norwegian": "no-no";
			readonly "Oman - Arabic": "ar-om";
			readonly "Oman - English": "en-om";
			readonly "Pakistan - English": "en-pk";
			readonly "Pakistan - Urdu": "ur-pk";
			readonly "Palestinian territories - Arabic": "ar-ps";
			readonly "Palestinian territories - English": "en-ps";
			readonly "Panama - English": "en-pa";
			readonly "Panama - Latin American Spanish": "es-419-pa";
			readonly "Panama - Spanish": "es-pa";
			readonly "Papua New Guinea - English": "en-pg";
			readonly "Paraguay - Latin American Spanish": "es-419-py";
			readonly "Paraguay - Spanish": "es-py";
			readonly "Peru - Latin American Spanish": "es-419-pe";
			readonly "Peru - Spanish": "es-pe";
			readonly "Philippines - English": "en-ph";
			readonly "Philippines - Filipino": "fil-ph";
			readonly "Pitcairn Island - English": "en-pn";
			readonly "Poland - Polish": "pl-pl";
			readonly "Portugal - Portuguese": "pt-pt";
			readonly "Puerto Rico - English": "en-pr";
			readonly "Puerto Rico - Latin American Spanish": "es-419-pr";
			readonly "Puerto Rico - Spanish": "es-pr";
			readonly "Qatar - Arabic": "ar-qa";
			readonly "Qatar - English": "en-qa";
			readonly "Republic of the Congo - Acoli": "ach-CG";
			readonly "Republic of the Congo - French": "fr-cg";
			readonly "Romania - German": "de-ro";
			readonly "Romania - Hungarian": "hu-ro";
			readonly "Romania - Romanian": "ro-ro";
			readonly "Russia - Russian": "ru-ru";
			readonly "Rwanda - English": "en-rw";
			readonly "Rwanda - French": "fr-rw";
			readonly "Rwanda - Kinyarwanda": "rw-rw";
			readonly "Rwanda - Swahili": "sw-rw";
			readonly "Saint Helena": "en-sh";
			readonly "Saint Vincent and the Grenadines - English": "en-vc";
			readonly "Samoa - English": "en-ws";
			readonly "San Marino - Italian": "it-sm";
			readonly "Saudi Arabia - Arabic": "ar-sa";
			readonly "Saudi Arabia - English": "en-sa";
			readonly "Senegal - French": "fr-sn";
			readonly "Serbia - Serbian": "sr-rs";
			readonly "Seychelles - English": "en-sc";
			readonly "Seychelles - French": "fr-sc";
			readonly "Seychelles - Seychellois Creole": "crs-sc";
			readonly "Siera Leone - English": "en-sl";
			readonly "Singapore - Chinese": "zh-sg";
			readonly "Singapore - English": "en-sg";
			readonly "Singapore - Malay": "ms-sg";
			readonly "Singapore - Tamil": "ta-sg";
			readonly "Slovakia - Slovak": "sk-sk";
			readonly "Slovenia - Slovenian": "sl-si";
			readonly "Solomon Islands - English": "en-sb";
			readonly "Somalia - Arabic": "ar-so";
			readonly "Somalia - English": "en-so";
			readonly "Somalia - Somali": "so-so";
			readonly "South Africa - Afrikaans": "af-za";
			readonly "South Africa - English": "en-za";
			readonly "South Africa - IsiXhosa": "xh-za";
			readonly "South Africa - IsiZulu": "zu-za";
			readonly "South Africa - Nothern Sotho": "nso-za";
			readonly "South Africa - Sesotho": "st-za";
			readonly "South Africa - Setswana": "tn-za";
			readonly "South Korea - Korean": "ko-kr";
			readonly "Spain - Catalan": "ca-es";
			readonly "Spain - Spanish": "es-es";
			readonly "Sri Lanka - English": "en-lk";
			readonly "Sri Lanka - Sinhala": "si-lk";
			readonly "Sri Lanka - Tamil": "ta-lk";
			readonly "Suriname - Dutch": "nl-sr";
			readonly "Suriname - English": "en-sr";
			readonly "Sweden - Swedish": "sv-se";
			readonly "Switzerland - English": "en-ch";
			readonly "Switzerland - French": "fr-ch";
			readonly "Switzerland - German": "de-ch";
			readonly "Switzerland - Italian": "it-ch";
			readonly "Switzerland - Rumantsch": "rm-ch";
			readonly "S\u00E3o Tom\u00E9 and Pr\u00EDncipe - Portuguese": "pt-st";
			readonly "Taiwan - Chinese": "zh-tw";
			readonly "Tajikistan - Russian": "ru-tj";
			readonly "Tajikistan - Tajik": "tg-tj";
			readonly "Tanzania - English": "en-tz";
			readonly "Tanzania - Swahili": "sw-tz";
			readonly "Thailand - English": "en-th";
			readonly "Thailand - Thai": "th-th";
			readonly "The Democratic Republic of the Congo - French": "fr-cd";
			readonly "Timor-Leste - Indonesian": "id-TL";
			readonly "Timor-Leste - Portuguese": "pt-tl";
			readonly "Togo - French": "fr-tg";
			readonly "Tokelau - English": "en-tk";
			readonly "Tonga - English": "en-to";
			readonly "Tonga - Tongan": "to-to";
			readonly "Trinidad and Tobago - English": "en-tt";
			readonly "Trinidad and Tobago - French": "fr-tt";
			readonly "Trinidad and Tobago - Latin American Spanish": "es-419-tt";
			readonly "Trinidad and Tobago - Spanish": "es-tt";
			readonly "Tunisia - Arabic": "ar-tn";
			readonly "Tunisia - English": "en-tn";
			readonly "Turkey - Turkish": "tr-tr";
			readonly "Turkmenistan - Russian": "ru-tm";
			readonly "Turkmenistan - Turkmen": "tk-tm";
			readonly "Uganda - English": "en-ug";
			readonly "Uganda - Kiswahili": "sw-ug";
			readonly "Ukraine - Russian": "ru-ua";
			readonly "Ukraine - Ukranian": "uk-ua";
			readonly "United Arab Emirates - Arabic": "ar-ae";
			readonly "United Arab Emirates - English": "en-ae";
			readonly "United Kingdom - English": "en-gb";
			readonly "United States - English": "en-us";
			readonly "United States - Korean": "ko-us";
			readonly "United States - Latin American Spanish": "es-419-us";
			readonly "United States - Simplified Chinese": "zh-cn-us";
			readonly "United States - Spanish": "es-us";
			readonly "United States - Traditional Chinese": "zh-tw-us";
			readonly "United States - Vietnamese": "vi-us";
			readonly "United States Virgin Islands - English": "en-vi";
			readonly "Uruguay - Latin American Spanish": "es-419-uy";
			readonly "Uruguay - Spanish": "es-uy";
			readonly "Uzbekistan - Russian": "ru-uz";
			readonly "Uzbekistan - Uzbek": "uz-uz";
			readonly "Vanuatu - English": "en-vu";
			readonly "Vanuatu - French": "fr-vu";
			readonly "Venezuela - Latin American Spanish": "es-419-ve";
			readonly "Venezuela - Spanish": "es-ve";
			readonly "Vietnam - English": "en-vn";
			readonly "Vietnam - French": "fr-vn";
			readonly "Vietnam - Taiwanese": "zh-vn";
			readonly "Vietnam - Vietnamese": "vi-vn";
			readonly "Zambia - English": "en-zm";
			readonly "Zimbabwe - English": "en-zw";
			readonly "Zimbabwe - Ndebele": "zu-zw";
			readonly "Zimbabwe - Shona": "sn-zw";
		};
	};
	readonly geo_location: {
		readonly label: "Location";
		readonly options: {
			readonly Afghanistan: "Afghanistan";
			readonly Albania: "Albania";
			readonly Algeria: "Algeria";
			readonly "American Samoa": "American Samoa";
			readonly Andorra: "Andorra";
			readonly Angola: "Angola";
			readonly Anguilla: "Anguilla";
			readonly "Antigua & Barbuda": "Antigua & Barbuda";
			readonly Argentina: "Argentina";
			readonly Armenia: "Armenia";
			readonly "Ascension Island": "Ascension Island";
			readonly Australia: "Australia";
			readonly Austria: "Austria";
			readonly Azerbaijan: "Azerbaijan";
			readonly Bahamas: "Bahamas";
			readonly Bahrain: "Bahrain";
			readonly Bangladesh: "Bangladesh";
			readonly Belarus: "Belarus";
			readonly Belgium: "Belgium";
			readonly Belize: "Belize";
			readonly Benin: "Benin";
			readonly Bhutan: "Bhutan";
			readonly Bolivia: "Bolivia";
			readonly "Bosnia & Herzegovinia": "Bosnia & Herzegovinia";
			readonly Botswana: "Botswana";
			readonly Brazil: "Brazil";
			readonly "British Virgin Islands": "British Virgin Islands";
			readonly Brunei: "Brunei";
			readonly Bulgaria: "Bulgaria";
			readonly "Burkina Faso": "Burkina Faso";
			readonly Burundi: "Burundi";
			readonly Cambodia: "Cambodia";
			readonly Cameroon: "Cameroon";
			readonly Canada: "Canada";
			readonly "Cape Verde": "Cape Verde";
			readonly "Catalan Countries": "Catalan Countries";
			readonly "Central African Republic": "Central African Republic";
			readonly Chad: "Chad";
			readonly Chile: "Chile";
			readonly China: "China";
			readonly Columbia: "Columbia";
			readonly Congo: "Congo";
			readonly "Cook Islands": "Cook Islands";
			readonly "Costa Rica": "Costa Rica";
			readonly "C\u00F4te d'Ivoire": "C\u00F4te d'Ivoire";
			readonly Croatia: "Croatia";
			readonly Cuba: "Cuba";
			readonly Cyprus: "Cyprus";
			readonly "Czech Republic": "Czech Republic";
			readonly Denmark: "Denmark";
			readonly Djibouti: "Djibouti";
			readonly Dominica: "Dominica";
			readonly "Dominican Republic": "Dominican Republic";
			readonly Ecuador: "Ecuador";
			readonly Egypt: "Egypt";
			readonly "El Salvador": "El Salvador";
			readonly Estonia: "Estonia";
			readonly Ethiopia: "Ethiopia";
			readonly Fiji: "Fiji";
			readonly Finland: "Finland";
			readonly France: "France";
			readonly Gabon: "Gabon";
			readonly Gambia: "Gambia";
			readonly Georgia: "Georgia";
			readonly Germany: "Germany";
			readonly Ghana: "Ghana";
			readonly Gibraltar: "Gibraltar";
			readonly Greece: "Greece";
			readonly Greenland: "Greenland";
			readonly Guadeloupe: "Guadeloupe";
			readonly Guatemala: "Guatemala";
			readonly Guernsey: "Guernsey";
			readonly Guyana: "Guyana";
			readonly Haiti: "Haiti";
			readonly Honduras: "Honduras";
			readonly "Hong Kong": "Hong Kong";
			readonly Hungary: "Hungary";
			readonly Iceland: "Iceland";
			readonly India: "India";
			readonly Indonesia: "Indonesia";
			readonly Iraq: "Iraq";
			readonly Ireland: "Ireland";
			readonly "Isle of Man": "Isle of Man";
			readonly Israel: "Israel";
			readonly Italy: "Italy";
			readonly "Ivory Coast": "Ivory Coast";
			readonly Jamaica: "Jamaica";
			readonly Japan: "Japan";
			readonly Jersey: "Jersey";
			readonly Jordon: "Jordon";
			readonly Kazakhstan: "Kazakhstan";
			readonly Kenya: "Kenya";
			readonly Kiribati: "Kiribati";
			readonly Kuwait: "Kuwait";
			readonly Kyrgyzstan: "Kyrgyzstan";
			readonly Laos: "Laos";
			readonly Latvia: "Latvia";
			readonly Lebanon: "Lebanon";
			readonly Lesotho: "Lesotho";
			readonly Libya: "Libya";
			readonly Liechtenstein: "Liechtenstein";
			readonly Lithuania: "Lithuania";
			readonly Luxembourg: "Luxembourg";
			readonly Macedonia: "Macedonia";
			readonly Madagascar: "Madagascar";
			readonly Malawi: "Malawi";
			readonly Malaysia: "Malaysia";
			readonly Maldives: "Maldives";
			readonly Mali: "Mali";
			readonly Malta: "Malta";
			readonly Mauritius: "Mauritius";
			readonly Mexico: "Mexico";
			readonly Micronesia: "Micronesia";
			readonly Moldavia: "Moldavia";
			readonly Mongolia: "Mongolia";
			readonly Montenegro: "Montenegro";
			readonly Montserrat: "Montserrat";
			readonly Morocco: "Morocco";
			readonly Mozambique: "Mozambique";
			readonly Namibia: "Namibia";
			readonly Nauru: "Nauru";
			readonly Nepal: "Nepal";
			readonly Netherlands: "Netherlands";
			readonly "New Zealand": "New Zealand";
			readonly Nicaragua: "Nicaragua";
			readonly Niger: "Niger";
			readonly Nigeria: "Nigeria";
			readonly Niue: "Niue";
			readonly "Norfolk Island": "Norfolk Island";
			readonly Norway: "Norway";
			readonly Oman: "Oman";
			readonly Pakistan: "Pakistan";
			readonly Palestine: "Palestine";
			readonly Panama: "Panama";
			readonly "Papua New Guina": "Papua New Guina";
			readonly Paraguay: "Paraguay";
			readonly Peru: "Peru";
			readonly Philippines: "Philippines";
			readonly Pitcairn: "Pitcairn";
			readonly Poland: "Poland";
			readonly Portugal: "Portugal";
			readonly "Puerto Rico": "Puerto Rico";
			readonly Quatar: "Quatar";
			readonly Romania: "Romania";
			readonly Russia: "Russia";
			readonly Rwanda: "Rwanda";
			readonly "Saint Helena": "Saint Helena";
			readonly Samoa: "Samoa";
			readonly "San Marino": "San Marino";
			readonly "Sao Tome and Principe": "Sao Tome and Principe";
			readonly "Saudia Arabia": "Saudia Arabia";
			readonly Senegal: "Senegal";
			readonly Serbia: "Serbia";
			readonly "S Serbia": "Serbia";
			readonly Seychelles: "Seychelles";
			readonly "Sierra Leone": "Sierra Leone";
			readonly Singapore: "Singapore";
			readonly Slovakia: "Slovakia";
			readonly Slovenia: "Slovenia";
			readonly "Solomon Islands": "Solomon Islands";
			readonly Somalia: "Somalia";
			readonly "South Africa": "South Africa";
			readonly Korea: "Korea";
			readonly Spain: "Spain";
			readonly "Sri Lanka": "Sri Lanka";
			readonly "St Vincent & Grenadines": "St Vincent & Grenadines";
			readonly Suriname: "Suriname";
			readonly Sweden: "Sweden";
			readonly Switzerland: "Switzerland";
			readonly Taiwan: "Taiwan";
			readonly Tajikistan: "Tajikistan";
			readonly Tanzania: "Tanzania";
			readonly Thailand: "Thailand";
			readonly "Timor-Leste": "Timor-Leste";
			readonly Togo: "Togo";
			readonly Tokelau: "Tokelau";
			readonly Tonga: "Tonga";
			readonly "Trinidad & Tobago": "Trinidad & Tobago";
			readonly Tunisia: "Tunisia";
			readonly Turkey: "Turkey";
			readonly Turkmenistan: "Turkmenistan";
			readonly Uganda: "Uganda";
			readonly Ukraine: "Ukraine";
			readonly "United Arab Emirates": "United Arab Emirates";
			readonly "United Kingdom": "United Kingdom";
			readonly "United States": "United States";
			readonly Uruguay: "Uruguay";
			readonly Uzbekistan: "Uzbekistan";
			readonly Vanuatu: "Vanuatu";
			readonly Venezuela: "Venezuela";
			readonly Vietnam: "Vietnam";
			readonly "Virgin Islands (US)": "Virgin Islands (US)";
			readonly Zambia: "Zambia";
			readonly Zimbabwe: "Zimbabwe";
		};
	};
};
type GeoLocation$1 = keyof typeof options$1.geo_location.options;
type Locale$1 = keyof typeof options$1.locale.options;
type BrowserType$1 = keyof typeof options$1.user_agent_type.options;
export type DecodoHeadlessMode = "html" | "png" | "pdf";
export interface IOptions {
	username: string;
	password: string;
	browserType?: BrowserType$1 | string;
	locale?: Locale$1 | string;
	geoLocation?: GeoLocation$1 | string;
	http_method?: "get" | "post";
	base64Body?: string;
	successful_status_codes?: number[];
	session_id?: string;
	javascript_rendering?: boolean;
	headers?: OutgoingHttpHeaders | Record<string, string>;
	cookies?: {
		key: string;
		value: string;
	}[];
	deviceType?: BrowserType$1 | string;
	country?: GeoLocation$1 | string;
	state?: string;
	city?: string;
	headless?: DecodoHeadlessMode;
	sessionId?: string;
	sessionDuration?: number;
	javascript?: string;
	javascriptWait?: number;
	waitForCss?: string;
	timeout?: number;
}
export interface AuthOptions extends IOptions {
	username: string;
	password: string;
}
export interface BasicAuthOptions extends IOptions {
	token: string;
}
export type DecodoOptions = AuthOptions | BasicAuthOptions;
export type DecodoConfig = DecodoOptions;
/**
 * Scrape result with parsed content and metadata
 */
export interface DecodoScrapeResult {
	/** HTTP status code of the scraped page */
	statusCode: number;
	/** Final URL after redirects */
	url: string;
	/** Page HTML content */
	content: string;
	/** Cookies from the response */
	cookies: DecodoCookie[];
	/** Response headers */
	headers: Record<string, string>;
	/** Task ID for reference */
	taskId?: string;
	/** Whether JavaScript was rendered */
	rendered: boolean;
	/** Country used */
	country?: string;
	/** City used */
	city?: string;
	/** State used */
	state?: string;
	/** Device type used */
	deviceType?: string;
	/** Content type */
	contentType?: string;
	/** Response size in bytes */
	contentLength?: number;
	/** Raw API response for advanced use */
	raw: DecodoResponse;
}
declare class Decodo {
	private readonly config;
	private readonly http;
	private readonly authHeader;
	/**
	 * Create a new Decodo client instance
	 *
	 * @param config - Decodo API configuration (supports username/password OR token auth)
	 * @throws Error if authentication credentials are missing
	 *
	 * @example
	 * ```typescript
	 * // Username/password authentication
	 * const decodo = new Decodo({
	 *   username: 'user',
	 *   password: 'password',
	 *   headless: 'html',
	 *   country: 'US'
	 * });
	 *
	 * // Token authentication (alternative)
	 * const decodo = new Decodo({
	 *   token: 'your_api_token',
	 *   headless: 'html',
	 *   country: 'US'
	 * });
	 * ```
	 */
	constructor(config: DecodoConfig);
	/**
	 * Scrape a URL using Decodo Web Scraping API
	 *
	 * @param url - URL to scrape
	 * @param options - Per-request options to override defaults
	 * @returns Promise resolving to scrape result
	 * @throws Error if API request fails
	 *
	 * @example
	 * ```typescript
	 * // Simple scrape
	 * const result = await decodo.scrape('https://example.com');
	 *
	 * // With options
	 * const result = await decodo.scrape('https://example.com', {
	 *   country: 'DE',
	 *   headless: 'html',
	 *   waitForCss: '.content-loaded'
	 * });
	 *
	 * // Access result
	 * console.log(result.content);
	 * console.log(result.statusCode);
	 * console.log(result.cookies);
	 * ```
	 */
	scrape(url: string, options?: Partial<DecodoConfig>): Promise<DecodoScrapeResult>;
	/**
	 * Scrape multiple URLs in sequence
	 *
	 * @param urls - Array of URLs to scrape
	 * @param options - Per-request options to override defaults
	 * @param delayMs - Delay between requests in milliseconds (default: 1000)
	 * @returns Promise resolving to array of scrape results
	 *
	 * @example
	 * ```typescript
	 * const results = await decodo.scrapeMany([
	 *   'https://example.com/page1',
	 *   'https://example.com/page2'
	 * ], { country: 'US' }, 2000);
	 * ```
	 */
	scrapeMany(urls: string[], options?: Partial<DecodoConfig>, delayMs?: number): Promise<DecodoScrapeResult[]>;
	/**
	 * Scrape with session persistence for multi-page crawling
	 *
	 * @param urls - Array of URLs to scrape in the same session
	 * @param options - Per-request options to override defaults
	 * @param sessionDuration - Session duration in minutes (default: 10)
	 * @returns Promise resolving to array of scrape results
	 *
	 * @example
	 * ```typescript
	 * // Scrape login flow with session persistence
	 * const results = await decodo.scrapeWithSession([
	 *   'https://example.com/login',
	 *   'https://example.com/dashboard'
	 * ], {}, 10);
	 * ```
	 */
	scrapeWithSession(urls: string[], options?: Partial<DecodoConfig>, sessionDuration?: number): Promise<DecodoScrapeResult[]>;
	/**
	 * Build the request body for Decodo API
	 */
	private buildRequestBody;
	/**
	 * Get the current configuration
	 *
	 * @returns Current Decodo configuration (password is masked)
	 */
	getConfig(): Omit<DecodoConfig, "password"> & {
		password: "***";
	};
	/**
	 * Create a new instance with different configuration
	 *
	 * @param config - New configuration options
	 * @returns New Decodo instance
	 *
	 * @example
	 * ```typescript
	 * const usClient = decodo.withConfig({ country: 'US' });
	 * const ukClient = decodo.withConfig({ country: 'GB' });
	 * ```
	 */
	withConfig(config: Partial<DecodoConfig>): Decodo;
	/**
	 * Test the Decodo API connection
	 *
	 * @returns Promise resolving to true if connection is successful
	 * @throws Error if connection fails
	 */
	testConnection(): Promise<boolean>;
}
/**
 * Represents a domain or list of domains for crawler targeting
 * @description Can be specified in multiple formats:
 * - As a string array of exact domains (e.g. ['example.com', 'test.com'])
 * - As a single string for exact domain match (e.g. 'example.com')
 * - As a wildcard string (e.g. '*.example.com' or 'sub.*.example.com')
 * - As a regex pattern string (e.g. '^(.*\.)?example\.com$')
 * The crawler will use this to determine which domains to process or filter
 * @example
 * // Array of domains
 * const domains: Domain = ['example.com', 'test.com'];
 * // Single domain
 * const domain: Domain = 'example.com';
 * // Wildcard domain
 * const wildcardDomain: Domain = '*.example.com';
 * // Regex pattern
 * const regexDomain: Domain = '^(sub|api)\.example\.com$';
 */
export type Domain = string[] | string | RegExp;
/**
 * Supported HTTP adapter types for crawler requests
 * @description
 * - 'http': Standard Node.js HTTP/HTTPS adapter (default)
 * - 'http2': HTTP/2 adapter with session pooling
 * - 'curl': cURL adapter for maximum compatibility
 * - 'fetch': Browser-compatible Fetch API adapter
 */
export type CrawlerAdapterType = "http" | "http2" | "curl" | "fetch";
/**
 * Per-domain retry/rate-limit options, attachable via addLimiter()
 */
export interface LimiterRetryOptions {
	/** Enable retry handling for this domain (default: true) */
	enable: boolean;
	/** Max retries on 429 before giving up on that URL (default: 3) */
	max429Retries?: number;
	/** Base delay in ms for retry (default: 1000) */
	retryDelay?: number;
	/** Status codes to retry on (e.g. [500, 502, 503]) */
	retryOnStatusCode?: number[];
	/** Status codes that should retry without proxy */
	retryWithoutProxyOnStatusCode?: number[];
	/** Max retry attempts for non-429 errors (default: 3) */
	maxRetryAttempts?: number;
	/** Use exponential backoff — doubles delay on each retry (default: true) */
	backoff?: boolean;
}
export interface StableThroughputLimiterConfig {
	domain?: Domain;
	isGlobal?: boolean;
	options?: queueOptions$1;
	retry?: LimiterRetryOptions;
}
export interface StableThroughputPresetOptions {
	/** Base URL for the crawl */
	baseUrl: string;
	/** Main crawler concurrency */
	concurrency?: number;
	/** Scraper/email queue concurrency */
	scraperConcurrency?: number;
	/** Global retry delay for non-domain-specific retries */
	retryDelay?: number;
	/** Global retry attempts for non-domain-specific retries */
	maxRetryAttempts?: number;
	/** Global retryable status codes. 429 is intentionally omitted because domain retry config handles it. */
	retryOnStatusCode?: number[];
	/** Max time to wait on 429 responses before giving up */
	maxWaitOn429?: number;
	/** Whether to wait on long 429 Retry-After values regardless of cap */
	alwaysWaitOn429?: boolean;
	/** Optional global limiter applied to all domains */
	globalLimiter?: queueOptions$1 | false;
	/** Domain to treat as the primary crawl target. Defaults to the baseUrl hostname. */
	domain?: Domain;
	/** Domain-specific limiter for the primary crawl target */
	domainLimiter?: queueOptions$1 | false;
	/** Domain-specific retry policy for the primary crawl target */
	domainRetry?: LimiterRetryOptions | false;
	/** Additional limiter configs to append */
	extraLimiters?: StableThroughputLimiterConfig[];
	/** Final option overrides merged on top of the preset */
	overrides?: Partial<ICrawlerOptions>;
}
export interface CrawlerProxyConfig {
	domain?: Domain;
	isGlobal?: boolean;
	proxy: IProxy;
	/** Set true when the configured proxy endpoint rotates IPs between requests. */
	rotating?: boolean;
}
/**
 * Configuration interface for the CrawlerOptions class
 * @description Defines all available options for configuring web crawler behavior,
 * including request settings, retry logic, caching, proxies, rate limiting, and more.
 */
export interface ICrawlerOptions {
	/** Base URL for the crawler - the starting point for crawling operations */
	baseUrl: string;
	/** HTTP adapter to use for requests (default: 'http') */
	adapter?: CrawlerAdapterType;
	/** Enable navigation history for resumable crawling (default: false) */
	enableNavigationHistory?: boolean;
	/** Session ID for navigation history - allows resuming specific crawl sessions */
	sessionId?: string;
	/** Whether to reject unauthorized SSL certificates (default: true) */
	rejectUnauthorized?: boolean;
	/** Custom user agent string for HTTP requests */
	userAgent?: string;
	/** Whether to use a random user agent for each request (default: false) */
	useRndUserAgent?: boolean;
	/** Request timeout in milliseconds (default: 30000) */
	timeout?: number;
	/** Maximum number of redirects to follow (default: 10) */
	maxRedirects?: number;
	/** Maximum number of retry attempts for failed requests (default: 3) */
	maxRetryAttempts?: number;
	/** Delay between retry attempts in milliseconds (default: 0) */
	retryDelay?: number;
	/** HTTP status codes that should trigger a retry (default: [408, 429, 500, 502, 503, 504]) */
	retryOnStatusCode?: number[];
	/** Force revisiting URLs even if they've been visited before (default: false) */
	forceRevisit?: boolean;
	/** Status codes that should trigger retry without proxy (default: [407, 403]) */
	retryWithoutProxyOnStatusCode?: number[];
	/** Whether to retry on proxy-related errors (default: true) */
	retryOnProxyError?: boolean;
	/** Maximum retry attempts specifically for proxy errors (default: 3) */
	maxRetryOnProxyError?: number;
	/** Allow revisiting the same URL multiple times (default: false) */
	allowRevisiting?: boolean;
	/** Enable caching of responses (default: true) */
	enableCache?: boolean;
	/** Cache time-to-live in milliseconds (default: 7 days) */
	cacheTTL?: number;
	/** Directory path for cache storage (default: "./cache") */
	cacheDir?: string;
	/** Whether to throw fatal errors or handle them gracefully (default: false) */
	throwFatalError?: boolean;
	/** Enable debug logging (default: false) */
	debug?: boolean;
	/** Oxylabs proxy service configuration for specific domains or global use */
	oxylabs?: {
		enable: true;
		labs: [
			{
				domain: Domain;
				isGlobal?: boolean;
				options: OxylabsOptions;
				queueOptions: queueOptions$1;
			}
		];
	} | {
		enable: false;
	} | undefined | false;
	/** Proxy configuration for specific domains or global use */
	proxy?: {
		enable: true;
		proxies: CrawlerProxyConfig[];
	} | {
		enable: false;
	} | undefined | false;
	/** Rate limiting configuration for specific domains or global use */
	limiter?: {
		enable: true;
		limiters: Array<{
			domain?: Domain;
			isGlobal?: boolean;
			options?: queueOptions$1;
			retry?: LimiterRetryOptions;
		}>;
	} | {
		enable: false;
	} | undefined | false;
	/** Custom HTTP headers configuration for specific domains or global use */
	headers?: {
		enable: true;
		httpHeaders: [
			{
				domain: Domain;
				isGlobal?: boolean;
				headers: OutgoingHttpHeaders | Headers;
			}
		];
	} | {
		enable: false;
	} | undefined | false;
	/** Decodo proxy service configuration for specific domains or global use */
	decodo?: {
		enable: true;
		labs: [
			{
				domain: Domain;
				isGlobal?: boolean;
				options: DecodoOptions;
				queueOptions: queueOptions$1;
			}
		];
	} | {
		enable: false;
	} | undefined | false;
	/** Global browser fingerprint stealth configuration. When set, Rezo applies browser-consistent
	 *  TLS fingerprint, headers, and UA automatically. Overrides `useRndUserAgent`. */
	stealth?: RezoStealth;
	/** Domain-specific stealth configurations. Each entry creates a dedicated Rezo instance with its own stealth profile. */
	stealths?: {
		enable: true;
		profiles: [
			{
				domain: Domain;
				isGlobal?: boolean;
				stealth: RezoStealth;
			}
		];
	} | {
		enable: false;
	} | undefined | false;
	/** Enable graceful shutdown handlers for SIGINT/SIGTERM - saves session state (default: false) */
	enableSignalHandlers?: boolean;
	/** Maximum concurrent requests for crawler (default: 100) */
	concurrency?: number;
	/** Maximum concurrent requests for scraper - separate queue (default: same as concurrency) */
	scraperConcurrency?: number;
	/** Maximum crawl depth from start URL (0 = unlimited, default: 0) */
	maxDepth?: number;
	/** Maximum total URLs to crawl (0 = unlimited, default: 0) */
	maxUrls?: number;
	/** Maximum response size in bytes to process (0 = unlimited, default: 0) */
	maxResponseSize?: number;
	/** Respect robots.txt rules (default: false) */
	respectRobotsTxt?: boolean;
	/** Follow rel="nofollow" links (default: false - ignores nofollow links) */
	followNofollow?: boolean;
	/** Enable automatic throttling based on server response times (default: true) */
	autoThrottle?: boolean;
	/** Target request delay in ms for AutoThrottle (default: 1000) */
	autoThrottleTargetDelay?: number;
	/** Minimum delay between requests in ms (default: 100) */
	autoThrottleMinDelay?: number;
	/** Maximum delay between requests in ms (default: 60000) */
	autoThrottleMaxDelay?: number;
	/** Maximum time to wait on 429 response in ms (default: 1800000 = 30 min) */
	maxWaitOn429?: number;
	/** Always wait on 429 regardless of time, shows warning (default: false) */
	alwaysWaitOn429?: boolean;
}
/**
 * Advanced web crawler configuration class with support for domain-specific settings
 * @description Provides comprehensive configuration options for web crawling operations,
 * including support for proxies, rate limiting, custom headers, caching, retry logic,
 * and integration with external services like Oxylabs. Supports both global and
 * domain-specific configurations for fine-grained control over crawling behavior.
 *
 * @example
 * ```typescript
 * // Basic configuration
 * const options = new CrawlerOptions({
 *   baseUrl: 'https://example.com',
 *   timeout: 10000,
 *   maxRetryAttempts: 5
 * });
 *
 * // Add domain-specific proxy
 * options.addProxy({
 *   domain: 'api.example.com',
 *   proxy: { host: 'proxy.example.com', port: 8080 }
 * });
 *
 * // Add global rate limiting
 * options.addLimiter({
 *   domain: '*',
 *   isGlobal: true,
 *   options: { concurrency: 2, interval: 1000 }
 * });
 * ```
 */
export declare class CrawlerOptions {
	private static destroyQueue;
	private static destroyConfigQueues;
	private static splitConfigs;
	private static getHostname;
	static createStableThroughputOptions(options: StableThroughputPresetOptions): ICrawlerOptions;
	/** Base URL for the crawler - the starting point for crawling operations */
	baseUrl: string;
	/** HTTP adapter to use for requests */
	adapter: CrawlerAdapterType;
	/** Enable navigation history for resumable crawling */
	enableNavigationHistory: boolean;
	/** Session ID for navigation history - allows resuming specific crawl sessions */
	sessionId: string;
	/** Whether to reject unauthorized SSL certificates */
	rejectUnauthorized?: boolean;
	/** Custom user agent string for HTTP requests */
	userAgent?: string;
	/** Whether to use a random user agent for each request */
	useRndUserAgent?: boolean;
	/** Request timeout in milliseconds */
	timeout?: number;
	/** Maximum number of redirects to follow */
	maxRedirects?: number;
	/** Maximum number of retry attempts for failed requests */
	maxRetryAttempts?: number;
	/** Delay between retry attempts in milliseconds */
	retryDelay?: number;
	/** HTTP status codes that should trigger a retry */
	retryOnStatusCode?: number[];
	/** Force revisiting URLs even if they've been visited before */
	forceRevisit?: boolean;
	/** Status codes that should trigger retry without proxy */
	retryWithoutProxyOnStatusCode?: number[];
	/** Whether to retry on proxy-related errors */
	retryOnProxyError?: boolean;
	/** Maximum retry attempts specifically for proxy errors */
	maxRetryOnProxyError?: number;
	/** Allow revisiting the same URL multiple times */
	allowRevisiting?: boolean;
	/** Enable caching of responses */
	enableCache?: boolean;
	/** Cache time-to-live in milliseconds */
	cacheTTL?: number;
	/** Directory path for cache storage */
	cacheDir?: string;
	/** Whether to throw fatal errors or handle them gracefully */
	throwFatalError?: boolean;
	/** Enable debug logging */
	debug?: boolean;
	/** Enable graceful shutdown handlers for SIGINT/SIGTERM - saves session state */
	enableSignalHandlers: boolean;
	/** Maximum concurrent requests for crawler (default: 100) */
	concurrency: number;
	/** Maximum concurrent requests for scraper (default: same as concurrency) */
	scraperConcurrency: number;
	/** Maximum crawl depth from start URL (0 = unlimited) */
	maxDepth: number;
	/** Maximum total URLs to crawl (0 = unlimited) */
	maxUrls: number;
	/** Maximum response size in bytes to process (0 = unlimited) */
	maxResponseSize: number;
	/** Respect robots.txt rules */
	respectRobotsTxt: boolean;
	/** Follow rel="nofollow" links */
	followNofollow: boolean;
	/** Enable automatic throttling based on server response times */
	autoThrottle: boolean;
	/** Target request delay in ms for AutoThrottle */
	autoThrottleTargetDelay: number;
	/** Minimum delay between requests in ms */
	autoThrottleMinDelay: number;
	/** Maximum delay between requests in ms */
	autoThrottleMaxDelay: number;
	/** Maximum time to wait on 429 response in ms */
	maxWaitOn429: number;
	/** Always wait on 429 regardless of time */
	alwaysWaitOn429: boolean;
	/** Browser fingerprint stealth configuration */
	stealth?: RezoStealth;
	/** Internal storage for Oxylabs configurations with domain mapping */
	oxylabs: {
		domain?: Domain;
		isGlobal?: boolean;
		adaptar: Oxylabs;
		pqueue?: RezoQueue;
	}[];
	/** Internal storage for Decodo configurations with domain mapping */
	decodo: {
		domain?: Domain;
		isGlobal?: boolean;
		adaptar: Decodo;
		pqueue?: RezoQueue;
	}[];
	/** Internal storage for stealth Rezo instances with domain mapping */
	stealthProfiles: {
		domain?: Domain;
		isGlobal?: boolean;
		adaptar: Rezo;
	}[];
	/** Internal storage for proxy configurations with domain mapping */
	private proxies;
	/** Internal storage for rate limiter configurations with domain mapping */
	private limiters;
	/** Callback invoked when a new limiter is added (set by Crawler for onQueueChange) */
	onLimiterAdded?: (queue: RezoQueue) => void;
	/** Callback invoked when a new provider queue is added (set by Crawler for onQueueChange) */
	onProviderAdded?: (queue: RezoQueue) => void;
	/** Internal storage for custom header configurations with domain mapping */
	private requestHeaders;
	/**
	 * List of modern user agent strings for rotation
	 * @description Array of user agent strings representing modern browsers
	 * that can be randomly selected when useRndUserAgent is enabled.
	 * Generated using the generateModernUserAgents() helper function.
	 * @private
	 */
	private userAgents;
	/**
	 * Creates a new CrawlerOptions instance with the specified configuration
	 * @param options - Partial configuration object implementing ICrawlerOptions interface
	 * @description Initializes all crawler settings with provided values or sensible defaults.
	 * Automatically processes and stores domain-specific configurations for headers, proxies,
	 * rate limiters, and Oxylabs settings.
	 */
	constructor(options?: Partial<ICrawlerOptions>);
	/**
	 * Get all configured domains for a specific adapter type
	 * @param type - Type of adapter to get domains for ('headers', 'proxies', 'limiters', or 'oxylabs')
	 * @returns Array of domain patterns that have configurations
	 * @description Returns all domain patterns that have been configured for the specified adapter type.
	 * Useful for debugging and understanding current configuration state.
	 * @example
	 * ```typescript
	 * const configuredDomains = options.getConfiguredDomains('proxies');
	 * console.log('Domains with proxy configs:', configuredDomains);
	 * ```
	 */
	getConfiguredDomains(type: "headers" | "proxies" | "limiters" | "oxylabs" | "decodo" | "stealth"): Domain[];
	/**
	 * Remove all configurations for a specific domain pattern
	 * @param domain - Domain pattern to remove configurations for
	 * @returns The CrawlerOptions instance for method chaining
	 * @description Removes all configurations (headers, proxies, limiters, oxylabs) that match
	 * the specified domain pattern. Useful for cleaning up domain-specific settings.
	 * @example
	 * ```typescript
	 * // Remove all configs for a specific domain
	 * options.removeDomain('old-api.example.com');
	 * ```
	 */
	removeDomain(domain: Domain): CrawlerOptions;
	/**
	 * Check if two domain patterns are equal
	 * @param domain1 - First domain pattern
	 * @param domain2 - Second domain pattern
	 * @returns True if domains are equal, false otherwise
	 * @description Compares two domain patterns for equality, handling arrays and strings.
	 * @private
	 */
	private _domainsEqual;
	/**
	 * Get a summary of all current configurations
	 * @returns Object containing counts and details of all configurations
	 * @description Provides an overview of the current crawler configuration state,
	 * including counts of each adapter type and global vs domain-specific settings.
	 * @example
	 * ```typescript
	 * const summary = options.getConfigurationSummary();
	 * console.log(`Total proxies: ${summary.proxies.total}`);
	 * ```
	 */
	getConfigurationSummary(): {
		headers: {
			total: number;
			global: number;
			domainSpecific: number;
		};
		proxies: {
			total: number;
			global: number;
			domainSpecific: number;
		};
		limiters: {
			total: number;
			global: number;
			domainSpecific: number;
		};
		oxylabs: {
			total: number;
			global: number;
			domainSpecific: number;
		};
		decodo: {
			total: number;
			global: number;
			domainSpecific: number;
		};
	};
	/**
	 * Internal method to process and add HTTP header configurations
	 * @param options - Header configuration object with enable flag and header definitions
	 * @description Validates and stores header configurations for domain-specific or global use.
	 * Converts Headers objects to plain objects for internal storage.
	 * @private
	 */
	private _addHeaders;
	/**
	 * Internal method to process and add proxy configurations
	 * @param options - Proxy configuration object with enable flag and proxy definitions
	 * @description Validates and stores proxy configurations for domain-specific or global use.
	 * Ensures proxy objects contain valid configuration before storage.
	 * @private
	 */
	private _addProxies;
	/**
	 * Internal method to process and add rate limiter configurations
	 * @param options - Limiter configuration object with enable flag and queue options
	 * @description Validates and stores rate limiter configurations, creating RezoQueue instances
	 * for each valid configuration. Supports domain-specific or global rate limiting.
	 * @private
	 */
	private _addLimiters;
	/**
	 * Internal method to process and add Oxylabs proxy service configurations
	 * @param options - Oxylabs configuration object with enable flag and service definitions
	 * @description Validates and stores Oxylabs configurations, creating Oxylabs adapter instances
	 * for each valid configuration. Supports domain-specific or global Oxylabs usage.
	 * @private
	 */
	private _addOxylabs;
	/**
 * Internal method to process and add Oxylabs proxy service configurations
 * @param options - Oxylabs configuration object with enable flag and service definitions
 * @description Validates and stores Oxylabs configurations, creating Oxylabs adapter instances
 * for each valid configuration. Supports domain-specific or global Oxylabs usage.
 * @private
 */
	private _addDecodo;
	/**
	 * Internal method to process and add stealth profile configurations
	 * @param options - Stealth configuration object with enable flag and profile definitions
	 * @description Validates and stores stealth configurations, creating dedicated Rezo instances
	 * with stealth enabled for each valid configuration.
	 * @private
	 */
	private _addStealths;
	/**
	 * Add HTTP headers configuration for specific domains or globally
	 * @param headers - Configuration object containing domain pattern, headers, and global flag
	 * @param headers.domain - Domain pattern to match (string, array, wildcard, or regex)
	 * @param headers.headers - HTTP headers to add for matching domains
	 * @param headers.isGlobal - Whether this configuration applies globally (optional)
	 * @returns The CrawlerOptions instance for method chaining
	 * @description Adds custom HTTP headers that will be included in requests to matching domains.
	 * Headers can be applied globally or to specific domain patterns.
	 * @example
	 * ```typescript
	 * options.addHeaders({
	 *   domain: 'api.example.com',
	 *   headers: { 'Authorization': 'Bearer token123' }
	 * });
	 * ```
	 */
	addHeaders(headers: {
		domain: Domain;
		isGlobal?: boolean;
		headers: OutgoingHttpHeaders | Headers;
	}): CrawlerOptions;
	/**
	 * Add proxy configuration for specific domains or globally
	 * @param proxy - Configuration object containing domain pattern, proxy settings, and global flag
	 * @param proxy.domain - Domain pattern to match (string, array, wildcard, or regex)
	 * @param proxy.proxy - Proxy configuration object with host, port, auth, etc.
	 * @param proxy.isGlobal - Whether this configuration applies globally (optional)
	 * @returns The CrawlerOptions instance for method chaining
	 * @description Adds proxy configuration that will be used for requests to matching domains.
	 * Proxies can be applied globally or to specific domain patterns.
	 * @example
	 * ```typescript
	 * options.addProxy({
	 *   domain: '*.example.com',
	 *   proxy: { host: 'proxy.example.com', port: 8080, auth: 'user:pass' }
	 * });
	 * ```
	 */
	addProxy(proxy: CrawlerProxyConfig): CrawlerOptions;
	/**
	 * Add multiple proxy configurations at once
	 * @param proxies - Proxy configurations to register
	 * @returns The current CrawlerOptions instance for method chaining
	 */
	addProxies(proxies: CrawlerProxyConfig[]): CrawlerOptions;
	getProxyConfig(url: string, useGlobal?: boolean, random?: boolean): {
		proxy: IProxy;
		rotating: boolean;
	} | null;
	/**
	 * Add rate limiter configuration for specific domains or globally
	 * @param options - Configuration object containing domain pattern, queue options, and global flag
	 * @param options.domain - Domain pattern to match (string, array, wildcard, or regex)
	 * @param options.options - Queue options for rate limiting (concurrency, interval, etc.)
	 * @param options.isGlobal - Whether this configuration applies globally (optional)
	 * @returns The CrawlerOptions instance for method chaining
	 * @description Adds rate limiting configuration that will control request frequency to matching domains.
	 * Rate limiters can be applied globally or to specific domain patterns.
	 * @example
	 * ```typescript
	 * options.addLimiter({
	 *   domain: 'api.example.com',
	 *   options: { concurrency: 2, interval: 1000, intervalCap: 10 }
	 * });
	 * ```
	 */
	addLimiter(options: {
		domain: Domain;
		isGlobal?: boolean;
	} & ({
		options: queueOptions$1;
		retry?: LimiterRetryOptions;
	} | {
		retry: LimiterRetryOptions;
		options?: queueOptions$1;
	})): this;
	/**
	 * Add Oxylabs proxy service configuration for specific domains or globally
	 * @param options - Configuration object containing domain pattern, Oxylabs settings, and global flag
	 * @param options.domain - Domain pattern to match (string, array, wildcard, or regex)
	 * @param options.options - Oxylabs service configuration options
	 * @param options.queueOptions - Queue options for managing Oxylabs requests
	 * @param options.isGlobal - Whether this configuration applies globally (optional)
	 * @returns The CrawlerOptions instance for method chaining
	 * @description Adds Oxylabs proxy service configuration for enhanced web scraping capabilities.
	 * Oxylabs can be applied globally or to specific domain patterns.
	 * @example
	 * ```typescript
	 * options.addOxylabs({
	 *   domain: 'protected-site.com',
	 *   options: { username: 'user', password: 'pass', endpoint: 'datacenter' },
	 *   queueOptions: { concurrency: 1, interval: 2000 }
	 * });
	 * ```
	 */
	addOxylabs(options: {
		domain: Domain;
		isGlobal?: boolean;
		options: OxylabsOptions;
		queueOptions: queueOptions$1;
	}): CrawlerOptions;
	/**
 * Add Decodo proxy service configuration for specific domains or globally
 * @param options - Configuration object containing domain pattern, Decodo settings, and global flag
 * @param options.domain - Domain pattern to match (string, array, wildcard, or regex)
 * @param options.options - Decodo service configuration options
 * @param options.queueOptions - Queue options for managing Decodo requests
 * @param options.isGlobal - Whether this configuration applies globally (optional)
 * @returns The CrawlerOptions instance for method chaining
 * @description Adds Decodo proxy service configuration for enhanced web scraping capabilities.
 * Decodo can be applied globally or to specific domain patterns.
 * @example
 * ```typescript
 * options.addDecodo({
 *   domain: 'protected-site.com',
 *   options: { username: 'user', password: 'pass', endpoint: 'datacenter' },
 *   queueOptions: { concurrency: 1, interval: 2000 }
 * });
 * ```
 */
	addDecodo(options: {
		domain: Domain;
		isGlobal?: boolean;
		options: DecodoOptions;
		queueOptions: queueOptions$1;
	}): CrawlerOptions;
	/**
	 * Add a stealth profile for specific domains or globally
	 * @param options - Configuration with domain pattern and RezoStealth instance
	 * @returns The CrawlerOptions instance for method chaining
	 * @description Creates a dedicated Rezo HTTP instance with the given stealth profile.
	 * When the crawler visits a matching domain, it uses this instance instead of the default.
	 * @example
	 * ```typescript
	 * options.addStealth({
	 *   domain: 'protected-site.com',
	 *   stealth: new RezoStealth({ rotate: true, family: 'chrome' })
	 * });
	 * ```
	 */
	addStealth(options: {
		domain: Domain;
		isGlobal?: boolean;
		stealth: RezoStealth;
	}): CrawlerOptions;
	/**
	 * Destroy all limiter queues to release resources and stop intervals
	 * @description Properly destroys all RezoQueue instances created by addLimiter().
	 * This stops any setInterval timers that would otherwise keep the process alive.
	 * Called automatically by Crawler.destroy().
	 * @example
	 * ```typescript
	 * // Clean up all limiters
	 * options.destroyLimiters();
	 * ```
	 */
	destroyLimiters(): void;
	/**
	 * Destroy all provider queues created via addOxylabs()/addDecodo()
	 * @description Properly destroys any RezoQueue instances created from provider queueOptions.
	 * Called automatically by Crawler.destroy().
	 */
	destroyProviderQueues(): void;
	/**
	 * Get all configured limiter queues
	 * @description Returns all RezoQueue instances created by addLimiter().
	 * Useful for subscribing to queue events across all limiters.
	 * @returns Array of limiter configurations with their RezoQueue instances
	 * @example
	 * ```typescript
	 * const limiters = options.getLimiters();
	 * for (const limiter of limiters) {
	 *   limiter.pqueue.on('completed', () => console.log('Task done'));
	 * }
	 * ```
	 */
	getLimiters(): ReadonlyArray<{
		domain?: Domain;
		isGlobal?: boolean;
		pqueue: RezoQueue;
		randomDelay?: number;
	}>;
	/**
	 * Get the randomDelay configured for a specific URL's domain
	 * @param url - The URL to check
	 * @param useGlobal - Whether to fall back to global limiters
	 * @returns The randomDelay in milliseconds, or undefined if not configured
	 */
	getRandomDelay(url: string, useGlobal?: boolean): number | undefined;
	/**
	 * Clear all global configurations from headers, proxies, limiters, Decodo, and Oxylabs
	 * @returns The CrawlerOptions instance for method chaining
	 * @description Removes all configurations marked as global while preserving domain-specific settings.
	 * Useful for resetting global behavior while maintaining targeted configurations.
	 * @example
	 * ```typescript
	 * // Remove all global configs but keep domain-specific ones
	 * options.clearGlobalConfigs();
	 * ```
	 */
	clearGlobalConfigs(): CrawlerOptions;
	/**
	 * Get the appropriate adapter (proxy, limiter, oxylabs, or headers) for a specific URL
	 * @param url - The URL to find configuration for
	 * @param type - Type of adapter to retrieve ('proxies', 'limiters', 'oxylabs', or 'headers')
	 * @param useGlobal - Whether to fall back to global configurations if no domain match is found
	 * @returns The matching configuration object or null if none found
	 * @description Searches for domain-specific configurations first, then falls back to global
	 * configurations if useGlobal is true. Uses domain matching logic including wildcards and regex.
	 * @example
	 * ```typescript
	 * const proxy = options.getAdapter('https://api.example.com', 'proxies', true);
	 * const headers = options.getAdapter('https://example.com', 'headers');
	 * ```
	 */
	getAdapter(url: string, type: "proxies", useGlobal?: boolean, random?: boolean): IProxy | null;
	getAdapter(url: string, type: "limiters", useGlobal?: boolean, random?: boolean): RezoQueue | null;
	getAdapter(url: string, type: "oxylabs", useGlobal?: boolean, random?: boolean): Oxylabs | null;
	getAdapter(url: string, type: "decodo", useGlobal?: boolean, random?: boolean): Decodo | null;
	getAdapter(url: string, type: "stealth", useGlobal?: boolean, random?: boolean): Rezo | null;
	getAdapter(url: string, type: "headers", useGlobal?: boolean, random?: boolean): OutgoingHttpHeaders | null;
	/**
	 * Get retry options for a specific URL from its domain limiter config
	 * @param url - The URL to look up retry options for
	 * @returns LimiterRetryOptions if configured for this domain, null otherwise
	 */
	getRetryOptions(url: string): LimiterRetryOptions | null;
	/**
	 * Generate a random integer between min and max values (inclusive)
	 * @param min - Minimum value (default: 0)
	 * @param max - Maximum value (default: Number.MAX_VALUE)
	 * @returns Random integer between min and max
	 * @description Generates a random integer within the specified range using
	 * Math.random(). The range is inclusive of both min and max values.
	 * @example
	 * ```typescript
	 * // Get random number between 1-10
	 * const rand = options.rnd(1, 10);
	 * ```
	 */
	rnd(min?: number, max?: number): number;
	/**
	 * Check if a specific URL has any configuration for the given adapter type
	 * @param url - The URL to check for configuration
	 * @param type - Type of adapter to check for ('headers', 'proxies', 'limiters', or 'oxylabs')
	 * @param useGlobal - Whether to include global configurations in the check
	 * @returns True if configuration exists for the URL, false otherwise
	 * @description Determines if there are any matching configurations (domain-specific or global)
	 * for the specified URL and adapter type. Useful for conditional logic.
	 * @example
	 * ```typescript
	 * if (options.hasDomain('https://api.example.com', 'proxies', true)) {
	 *   // Use proxy for this domain
	 * }
	 * ```
	 */
	hasDomain(url: string, type: "headers" | "proxies" | "limiters" | "oxylabs" | "decodo" | "stealth", useGlobal?: boolean): boolean;
	pickHeaders(url: string, useGlobal?: boolean, defaultHeaders?: Headers | OutgoingHttpHeaders, useRandomUserAgent?: boolean): OutgoingHttpHeaders;
	/**
	 * Internal method to check if a domain matches the specified domain pattern(s)
	 * @param url - The URL to test for domain matching
	 * @param domains - Domain pattern(s) to match against (string[], string, or RegExp)
	 * @returns True if the domain matches any of the patterns, false otherwise
	 * @description Supports comprehensive domain matching strategies:
	 * - Exact string matching for domains
	 * - Array of domains/patterns for multiple matches
	 * - Wildcard patterns (e.g., '*.example.com', 'sub.*.example.com')
	 * - Regex string patterns with automatic detection
	 * - RegExp objects for complex matching rules
	 * - Domain-based matching (hostname only)
	 * - Domain-path-based matching (full URL)
	 * - Subdomain support and partial matching
	 * @private
	 */
	private _hasDomain;
	private selectConfigEntry;
	/**
	 * Extract the domain name from a URL or validate if input is already a domain
	 * @param url - URL string or domain name to process
	 * @returns The extracted domain name or null if invalid
	 * @description Handles both full URLs and plain domain names. Uses URL parsing
	 * for full URLs and hostname validation for plain domains.
	 * @private
	 */
	private getDomainName;
	/**
	 * Validate if a string is a valid hostname/domain name
	 * @param domain - String to validate as hostname
	 * @returns True if valid hostname, false otherwise
	 * @description Validates hostname format according to RFC standards:
	 * - Maximum 255 characters
	 * - Valid character patterns
	 * - No leading/trailing hyphens
	 * - Proper domain structure
	 * @private
	 */
	private isHostName;
	/**
	 * Validate if a string is a valid URL with proper scheme and hostname
	 * @param domain - String to validate as URL
	 * @returns True if valid URL, false otherwise
	 * @description Validates URL format including:
	 * - Proper HTTP/HTTPS scheme
	 * - Valid hostname structure
	 * - URL constructor compatibility
	 * - Basic security checks
	 * @private
	 */
	private isValidUrl;
	/**
	 * Get random user agent for request diversity
	 * @returns Random user agent string
	 */
	private getRandomUserAgent;
}
export interface EmailDiscoveryEvent<T = Record<string, any>> {
	email: string;
	discoveredAt: string;
	timestamp: Date;
	metadata: T;
}
/**
 * Check if URL belongs to a restricted domain
 * @param url - URL to check
 * @returns Boolean indicating if domain is restricted
 */
export declare function isRestrictedDomain(url: string): boolean;
export interface HealthSnapshot {
	/** Timestamp of snapshot */
	timestamp: number;
	/** Requests per second (rolling average) */
	requestsPerSecond: number;
	/** Success rate percentage (0-100) */
	successRate: number;
	/** Failure rate percentage (0-100) */
	failureRate: number;
	/** Average response time in ms */
	avgResponseTime: number;
	/** 95th percentile response time in ms */
	p95ResponseTime: number;
	/** Current queue depth */
	queueDepth: number;
	/** Active concurrent requests */
	activeRequests: number;
	/** Total requests processed */
	totalRequests: number;
	/** Total successful requests */
	totalSuccesses: number;
	/** Total failed requests */
	totalFailures: number;
	/** Uptime in milliseconds */
	uptimeMs: number;
}
export type VisitOxylabsOverrides = Partial<Pick<OxylabsConfig, "browserType" | "locale" | "geoLocation" | "http_method" | "base64Body" | "returnAsBase64" | "successful_status_codes" | "session_id" | "follow_redirects" | "javascript_rendering" | "cookies" | "render" | "context">>;
export type VisitDecodoOverrides = Partial<Pick<DecodoConfig, "deviceType" | "locale" | "country" | "state" | "city" | "headless" | "sessionId" | "sessionDuration" | "javascript" | "javascriptWait" | "waitForCss" | "http_method" | "base64Body" | "successful_status_codes" | "session_id" | "javascript_rendering" | "cookies">>;
interface RedirectEvent$1 {
	originalUrl: string;
	finalUrl: string;
	redirectCount: number;
	statusCode: number;
}
/**
 * Export format options
 */
export type ExportFormat = "json" | "jsonl" | "csv";
/**
 * Handler with element bound to `this` context.
 * Use `function` syntax (not arrow functions) to access `this`.
 *
 * @example
 * ```typescript
 * crawler.onText('h1', async function(text) {
 *   console.log(text, this.tagName); // `this` is the element
 * });
 * ```
 */
export type ElementBoundHandler<TValue, TElement = Element> = (this: TElement, value: TValue) => Promise<void>;
/**
 * Handler for attribute extraction with element bound to `this`.
 * Receives both the attribute value and attribute name.
 */
export type AttributeHandler = (this: Element, value: string, attributeName: string) => Promise<void>;
/**
 * Crawl statistics
 */
export interface CrawlStats {
	urlsVisited: number;
	urlsQueued: number;
	urlsFailed: number;
	startTime: number;
	endTime?: number;
	currentDepth: number;
}
/**
 * Queue change event data passed to onQueueChange handler.
 * Fires when any queue's state changes (main crawler queue, scraper queue, limiter queues, or provider queues).
 */
export interface QueueChangeEvent {
	/** Name of the queue that changed */
	queueName: string;
	/** Type of queue: 'crawler', 'scraper', 'limiter', or 'provider' */
	queueType: "crawler" | "scraper" | "limiter" | "provider";
	/** The event that triggered this change */
	event: "add" | "start" | "completed" | "error" | "timeout" | "cancelled" | "idle" | "active" | "paused" | "resumed";
	/** Number of tasks currently running */
	pending: number;
	/** Number of tasks waiting in queue */
	size: number;
	/** Total tasks (pending + size) */
	total: number;
	/** Is queue paused */
	isPaused: boolean;
	/** Is queue idle (no tasks) */
	isIdle: boolean;
	/** Task ID if event is task-specific (add, start, completed, error, timeout, cancelled) */
	taskId?: string;
}
/**
 * A powerful web crawler that provides event-driven HTML parsing and data extraction.
 * Supports caching, proxy rotation, retry mechanisms, and email lead discovery.
 *
 * @example
 * ```typescript
 * const crawler = new Crawler({
 *   http: rezoInstance,
 *   baseUrl: 'https://example.com',
 *   enableCache: true,
 *   socksProxies: [{ host: 'proxy.com', port: 1080 }]
 * });
 *
 * crawler
 *   .onDocument(async (doc) => {
 *     console.log('Page title:', doc.title);
 *   })
 *   .onAnchor(async (anchor) => {
 *     console.log('Found link:', anchor.href);
 *   })
 *   .visit('/page1')
 *   .visit('/page2');
 *
 * await crawler.waitForAll();
 * ```
 */
export declare class Crawler {
	private http;
	private readonly events;
	private readonly jsonEvents;
	private readonly errorEvents;
	private readonly responseEvents;
	private readonly rawResponseEvents;
	private emailDiscoveredEvents;
	private emailLeadsEvents;
	/** Counter for active event handlers (not queued, runs directly) */
	private eventCount;
	/**
	 * Key-value cache instance for storing HTTP responses.
	 * Uses SQLite as the underlying storage mechanism.
	 */
	cacher: FileCacher;
	private queue;
	private scraperQueue;
	private readonly isCacheEnabled;
	readonly config: CrawlerOptions;
	private urlStorage;
	private isStorageReady;
	private isCacheReady;
	private leadsFinder;
	/** Navigation history for resumable crawling */
	private navigationHistory;
	private isNavigationHistoryReady;
	private isSessionReady;
	private currentSession;
	private navigationHistoryInitPromise;
	/** Adapter-specific request executor */
	private adapterExecutor;
	private adaptedHttpClients;
	private adapterInitPromise;
	private adapterType;
	/** Track if the crawler has been destroyed */
	private isDestroyed;
	/** Track if graceful shutdown has been requested */
	private shutdownRequested;
	/** robots.txt parser and validator */
	private robotsTxt;
	/** AutoThrottle: track response times per domain for adaptive rate limiting */
	private domainResponseTimes;
	private domainCurrentDelay;
	/** Crawl statistics */
	private crawlStats;
	/** URL depth tracking for maxDepth limit */
	private urlDepthMap;
	/** Periodic cleanup interval for memory management */
	private cleanupInterval?;
	/** Auto-checkpoint interval for session persistence */
	private checkpointInterval?;
	/** Last checkpoint timestamp */
	private lastCheckpointTime;
	/** Memory monitor for auto-throttling */
	private memoryMonitor;
	/** Health metrics for monitoring */
	private healthMetrics;
	/** Original concurrency for restoration after memory pressure */
	private originalConcurrency;
	/** Shutdown handler reference for cleanup */
	private shutdownHandler;
	/** Per-domain rate limit tracking: domain → backoff-until timestamp */
	private rateLimitedDomains;
	/** Lifecycle event handlers */
	private startHandlers;
	private finishHandlers;
	private redirectHandlers;
	private queueChangeHandlers;
	/** Data collection for export - bounded to prevent memory issues */
	private collectedData;
	/** Flag to track if work has been scheduled for the current crawl run */
	private hasScheduledWork;
	/** Flag to track if start handlers have run for the current crawl run */
	private hasStartedLifecycle;
	/** Promise lock for triggerStartHandlers to prevent race condition */
	private startHandlersPromise;
	/**
	 * Creates a new Crawler instance with the specified configuration.
	 *
	 * @param crawlerOptions - Crawler configuration options
	 * @param http - Optional Rezo HTTP client instance (creates default if not provided)
	 *
	 * @example
	 * ```typescript
	 * // Basic usage (creates default Rezo instance)
	 * const crawler = new Crawler({
	 *   baseUrl: 'https://example.com',
	 *   enableCache: true,
	 *   cacheDir: './cache',
	 * });
	 *
	 * // With resumable crawling
	 * const crawler = new Crawler({
	 *   baseUrl: 'https://example.com',
	 *   enableNavigationHistory: true,
	 *   sessionId: 'my-session',
	 *   cacheDir: './cache',
	 * });
	 *
	 * // With custom Rezo instance
	 * const crawler = new Crawler({
	 *   baseUrl: 'https://example.com',
	 *   adapter: 'curl',
	 * }, myRezoInstance);
	 * ```
	 */
	constructor(crawlerOptions: ICrawlerOptions, http?: Rezo);
	/**
	 * Register process signal handlers for graceful shutdown
	 */
	private registerShutdownHandlers;
	/**
	 * Remove process signal handlers
	 */
	private removeShutdownHandlers;
	/**
	 * Graceful shutdown - finish current tasks and save state
	 */
	gracefulShutdown(): Promise<void>;
	/**
	 * Initialize the HTTP adapter based on configuration
	 */
	private initializeAdapter;
	private waitForAdapter;
	private getRequestClient;
	private headersToRecord;
	private encodeProviderBody;
	private findProviderQueue;
	private runWithQueues;
	private getProviderQueues;
	private getManagedQueues;
	private startManagedQueues;
	private clearManagedQueues;
	private persistNavigationSession;
	/**
	 * Ensures the crawler has not been explicitly destroyed.
	 * Called internally before any public operation.
	 */
	private ensureActive;
	/**
	 * Initialize navigation history and session
	 */
	private initializeNavigationHistory;
	/**
	 * Wait for navigation history and session to be ready
	 */
	private waitForNavigationHistory;
	/**
	 * Ensure navigation history is ready and return it (or null if not enabled)
	 * This is used by visit() and other methods that need to write to navigation history
	 */
	private ensureNavigationHistoryReady;
	/**
	 * Add URL to navigation history queue
	 */
	private addToNavigationQueue;
	private removeFromNavigationQueue;
	/**
	 * Mark URL as visited in navigation history
	 */
	private markUrlVisited;
	private syncNavigationSessionStats;
	/**
	 * Get the current crawl session
	 */
	getSession(): CrawlSession | null;
	/**
	 * Get the session ID
	 */
	getSessionId(): string;
	/**
	 * Resume a previous crawl session
	 * @param sessionId - Optional session ID to resume (uses current session if not provided)
	 * @returns Promise resolving to the Crawler instance for chaining
	 */
	resume(sessionId?: string): Promise<Crawler>;
	/**
	 * Get list of resumable sessions
	 * @returns Promise resolving to array of sessions that can be resumed
	 */
	getResumableSessions(): Promise<CrawlSession[]>;
	/**
	 * Pause the current crawl session
	 */
	pause(): Promise<void>;
	/**
	 * Mark the current session as completed
	 */
	complete(): Promise<void>;
	/**
	 * Get the current adapter type being used
	 */
	getAdapterType(): CrawlerAdapterType;
	/**
	 * Switch to a different adapter at runtime
	 * @param adapter - The adapter type to switch to
	 */
	setAdapter(adapter: CrawlerAdapterType): Promise<void>;
	private rawResponseHandler;
	/**
	 * Wait for cache to be ready with timeout (non-recursive)
	 * @param timeoutMs - Maximum time to wait in milliseconds (default: 30s)
	 */
	private waitForCache;
	/**
	 * Wait for storage to be ready with timeout (non-recursive)
	 * @param timeoutMs - Maximum time to wait in milliseconds (default: 30s)
	 */
	private waitForStorage;
	/**
	 * Stop background monitoring/checkpoint intervals for the current crawl run.
	 */
	private stopBackgroundMonitoring;
	/**
	 * Wait only for queues that have actually received work.
	 * This prevents idle waits from hanging on unused secondary queues.
	 */
	private waitForActiveQueuesIdle;
	/**
	 * Start periodic cleanup to prevent unbounded memory growth
	 * Trims urlDepthMap and domainResponseTimes to reasonable sizes
	 * Also monitors memory and auto-throttles if needed
	 */
	private startPeriodicCleanup;
	/**
	 * Start auto-checkpointing to save session progress every 5 minutes
	 */
	private startAutoCheckpoint;
	/**
	 * Save current crawl progress to navigation history
	 */
	saveCheckpoint(): Promise<void>;
	private saveUrl;
	private hasUrlInCache;
	private saveCache;
	private getNamespace;
	private _hasCache;
	private getCache;
	private sleep;
	private _rnd;
	/**
	 * Registers a handler for error events during crawling.
	 * Triggered when errors occur during HTTP requests or processing.
	 *
	 * @template T - The expected type of the error data
	 * @param handler - Function to handle error events
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onError<RezoError>(async (error) => {
	 *   console.error('Crawl error:', error.message);
	 *   console.error('URL:', error.url);
	 *   console.error('Status:', error.status);
	 * });
	 * ```
	 */
	onError<T = RezoError>(handler: (error: T) => Promise<void>): Crawler;
	/**
	 * Registers a handler for JSON responses.
	 * Triggered when the response content-type indicates JSON data.
	 *
	 * @template T - The expected type of the JSON data
	 * @param handler - Function to handle parsed JSON data
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onJson<{users: User[]}>(async (data) => {
	 *   console.log('Found users:', data.users.length);
	 * });
	 * ```
	 */
	onJson<T = any>(handler: (jsonData: T) => Promise<void>): Crawler;
	/**
	 * Registers a handler for individual email discovery events.
	 * Triggered when an email address is found during crawling.
	 *
	 * @param handler - Function to handle email discovery events
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onEmailDiscovered(async (event) => {
	 *   console.log(`Found email: ${event.email} on ${event.url}`);
	 * });
	 * ```
	 */
	onEmailDiscovered<T = Record<string, any>>(handler: (email: EmailDiscoveryEvent<T>) => Promise<void>): Crawler;
	/**
	 * Registers a handler for bulk email leads discovery.
	 * Triggered when multiple email addresses are found and processed.
	 *
	 * @param handler - Function to handle arrays of discovered email addresses
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onEmailLeads(async (emails) => {
	 *   console.log(`Discovered ${emails.length} email leads`);
	 *   await saveEmailsToDatabase(emails);
	 * });
	 * ```
	 */
	onEmailLeads<T = Record<string, any>>(handler: (leads: EmailDiscoveryEvent<T>[]) => Promise<void>): Crawler;
	/**
	 * Registers a handler called before crawling starts.
	 * Useful for initialization, logging, or setup tasks.
	 *
	 * @param handler - Function to call before crawling begins
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onStart(async () => {
	 *   console.log('Crawl session started');
	 *   await initializeDatabase();
	 * });
	 * ```
	 */
	onStart(handler: () => Promise<void>): Crawler;
	/**
	 * Registers a handler called when crawling finishes.
	 * Receives crawl statistics including URLs visited, failed, and timing.
	 *
	 * @param handler - Function to call when crawling completes
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onFinish(async (stats) => {
	 *   console.log(`Crawl completed: ${stats.urlsVisited} URLs in ${stats.endTime - stats.startTime}ms`);
	 *   await generateReport(stats);
	 * });
	 * ```
	 */
	onFinish(handler: (stats: CrawlStats) => Promise<void>): Crawler;
	/**
	 * Registers a handler called when a redirect is followed.
	 * Provides information about the original URL, final URL, and redirect count.
	 *
	 * @param handler - Function to handle redirect events
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onRedirect(async (event) => {
	 *   console.log(`Redirect: ${event.originalUrl} -> ${event.finalUrl}`);
	 *   trackRedirects(event);
	 * });
	 * ```
	 */
	onRedirect(handler: (event: RedirectEvent$1) => Promise<void>): Crawler;
	/**
	 * Registers a handler called when any queue's state changes.
	 * Fires for the main crawler queue, scraper queue, and all limiter queues.
	 * Each event reports only the specific queue that changed (not aggregated).
	 *
	 * @param handler - Function to handle queue change events (sync callback)
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onQueueChange((event) => {
	 *   console.log(`[${event.queueType}:${event.queueName}] ${event.event} - pending: ${event.pending}, size: ${event.size}`);
	 * });
	 * ```
	 */
	onQueueChange(handler: (event: QueueChangeEvent) => void): Crawler;
	/**
	 * Registers a handler for raw response data.
	 * Triggered for all responses, providing access to the raw Buffer data.
	 *
	 * @param handler - Function to handle raw response data as Buffer
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onRawData(async (buffer) => {
	 *   console.log('Response size:', buffer.length, 'bytes');
	 *   await fs.writeFile('response.bin', buffer);
	 * });
	 * ```
	 */
	onRawData(handler: (data: Buffer) => Promise<void>): Crawler;
	/**
	 * Registers a handler for HTML document objects.
	 * Triggered for each successfully parsed HTML page.
	 *
	 * @param handler - Function to handle the parsed Document object
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onDocument(async (doc) => {
	 *   console.log('Page title:', doc.title);
	 *   console.log('Meta description:', doc.querySelector('meta[name="description"]')?.content);
	 * });
	 * ```
	 */
	onDocument(handler: (document: Document) => Promise<void>): Crawler;
	/**
	 * Registers a handler for HTML body elements.
	 * Triggered once per page for the document body.
	 *
	 * @param handler - Function to handle the HTMLBodyElement
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onBody(async (body) => {
	 *   console.log('Body classes:', body.className);
	 *   console.log('Body text length:', body.textContent?.length);
	 * });
	 * ```
	 */
	onBody(handler: (body: HTMLBodyElement) => Promise<void>): Crawler;
	/**
	 * Registers a handler for all HTML elements on a page.
	 * Triggered for every single HTML element found in the document.
	 *
	 * @param handler - Function to handle each HTMLElement
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onElement(async (element) => {
	 *   if (element.tagName === 'IMG') {
	 *     console.log('Found image:', element.getAttribute('src'));
	 *   }
	 * });
	 * ```
	 */
	onElement(handler: (element: HTMLElement) => Promise<void>): Crawler;
	/**
	 * Registers a handler for anchor elements (links).
	 * Can be used with or without a CSS selector to filter specific anchors.
	 *
	 * @param handler - Function to handle anchor elements
	 * @returns The crawler instance for method chaining
	 *
	 * @overload
	 * @param selection - CSS selector to filter anchor elements
	 * @param handler - Function to handle matching anchor elements
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Handle all anchor elements
	 * crawler.onAnchor(async (anchor) => {
	 *   console.log('Link:', anchor.href, 'Text:', anchor.textContent);
	 * });
	 *
	 * // Handle only external links
	 * crawler.onAnchor('a[href^="http"]', async (anchor) => {
	 *   console.log('External link:', anchor.href);
	 * });
	 * ```
	 */
	onAnchor(handler: (anchor: HTMLAnchorElement) => Promise<void>): Crawler;
	onAnchor(selection: string, handler: (anchor: HTMLAnchorElement) => Promise<void>): Crawler;
	/**
	 * Registers a handler for href attributes from anchor and link elements.
	 * Automatically resolves relative URLs to absolute URLs.
	 * Use `function` syntax (not arrow) to access `this` as the element.
	 *
	 * @param handler - Function receiving href string, with `this` bound to the element
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onHref(async function(href) {
	 *   console.log('Found URL:', href);
	 *   console.log('Link text:', this.textContent); // `this` is the anchor/link element
	 *   if (href.includes('/api/')) {
	 *     await crawler.visit(href);
	 *   }
	 * });
	 * ```
	 */
	onHref(handler: ElementBoundHandler<string, HTMLAnchorElement | HTMLLinkElement>): Crawler;
	/**
	 * Registers a handler for elements matching a CSS selector.
	 * Provides fine-grained control over which elements to process.
	 *
	 * @template T - The expected element type
	 * @param selection - CSS selector string to match elements
	 * @param handler - Function to handle matching elements
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Handle all product cards
	 * crawler.onSelection<HTMLDivElement>('.product-card', async (card) => {
	 *   const title = card.querySelector('.title')?.textContent;
	 *   const price = card.querySelector('.price')?.textContent;
	 *   console.log('Product:', title, 'Price:', price);
	 * });
	 * ```
	 */
	onSelection<T = HTMLElement>(selection: string, handler: (element: T) => Promise<void>): Crawler;
	/**
	 * Registers a handler for HTTP responses.
	 * Triggered for every HTTP response, providing access to response metadata.
	 *
	 * @template T - The expected response data type
	 * @param handler - Function to handle RezoResponse objects
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onResponse(async (response) => {
	 *   console.log('Status:', response.status);
	 *   console.log('Content-Type:', response.contentType);
	 *   console.log('Final URL:', response.finalUrl);
	 * });
	 * ```
	 */
	onResponse<T = any>(handler: (response: CrawlerResponse<T>) => Promise<void>): Crawler;
	/**
	 * Registers a handler for HTML element attributes.
	 * Can extract specific attributes from all elements or from elements matching a selector.
	 * Use `function` syntax (not arrow) to access `this` as the element.
	 *
	 * @param attribute - The attribute name to extract
	 * @param handler - Function receiving (value, attrName), with `this` bound to element
	 * @returns The crawler instance for method chaining
	 *
	 * @overload
	 * @param selection - CSS selector to filter elements
	 * @param attribute - The attribute name to extract
	 * @param handler - Function receiving (value, attrName), with `this` bound to element
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Extract all 'data-id' attributes
	 * crawler.onAttribute('data-id', async function(value, attrName) {
	 *   console.log('Found', attrName, ':', value, 'on:', this.tagName);
	 * });
	 *
	 * // Extract 'src' attributes from images only
	 * crawler.onAttribute('img', 'src', async function(value) {
	 *   console.log('Image source:', value, 'alt:', this.getAttribute('alt'));
	 * });
	 * ```
	 */
	onAttribute(attribute: string, handler: AttributeHandler): Crawler;
	onAttribute(selection: string, attribute: string, handler: AttributeHandler): Crawler;
	/**
	 * Registers a handler for text content of elements matching a CSS selector.
	 * Extracts and processes the textContent of matching elements.
	 * Use `function` syntax (not arrow) to access `this` as the element.
	 *
	 * @param selection - CSS selector to match elements
	 * @param handler - Function receiving text string, with `this` bound to element
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Extract all heading text with element context
	 * crawler.onText('h1, h2, h3', async function(text) {
	 *   console.log('Heading:', text.trim(), 'Tag:', this.tagName);
	 * });
	 *
	 * // Extract product prices with element context
	 * crawler.onText('.price', async function(text) {
	 *   const numericPrice = parseFloat(text.replace(/[^\d.]/g, ''));
	 *   console.log('Price:', numericPrice, 'Product:', this.closest('.product')?.id);
	 * });
	 * ```
	 */
	onText(selection: string, handler: ElementBoundHandler<string>): Crawler;
	/** Track which managed queues we've already subscribed to */
	private subscribedManagedQueues;
	/**
	 * Subscribe to a queue's events to emit QueueChangeEvent
	 * @param queue - The RezoQueue to subscribe to
	 * @param queueType - Type of queue: 'crawler', 'scraper', 'limiter', or 'provider'
	 */
	private _subscribeToQueueEvents;
	/**
	 * Subscribe to all limiter queues that haven't been subscribed to yet.
	 * Called when onQueueChange handlers are registered to ensure limiter events are captured.
	 */
	private _subscribeToManagedQueues;
	/**
	 * Invokes every registered error-event handler with the given error.
	 * Swallows per-handler throws so one misbehaving handler can't mask others.
	 * Used from the fire-and-forget execute/execute2 catch blocks so those
	 * errors reach the same handler chain as in-crawl errors.
	 */
	private dispatchErrorEvents;
	/**
	 * Run a handler with event tracking (not through queue).
	 * Increments eventCount before running, decrements after completion.
	 * This allows waitForAll() to wait for handlers without queue bloat.
	 */
	private _runHandler;
	/**
	 * Run a bound handler (using .call()) with event tracking.
	 */
	private _runBoundHandler;
	private _onBody;
	private _onAttribute;
	private _onText;
	private _onSelection;
	private _onElement;
	private _onHref;
	private _onAnchor;
	private _onDocument;
	private _onJson;
	private _onError;
	private _onEmailDiscovered;
	private _onEmailLeads;
	private _onRawResponse;
	private _onResponse;
	/**
	 * Calculate adaptive delay based on server response times (AutoThrottle)
	 */
	private calculateAutoThrottleDelay;
	/**
	 * Get current AutoThrottle delay for a domain
	 */
	private getAutoThrottleDelay;
	/**
	 * Handle 429 Too Many Requests response with retry cap, exponential backoff, and per-domain tracking.
	 * Uses domain-specific LimiterRetryOptions when configured via addLimiter(), otherwise falls back to global config.
	 */
	private handle429Response;
	/**
	 * Check if URL passes all crawl limit checks
	 */
	private checkCrawlLimits;
	/**
	 * Check if a link should be followed based on nofollow rules
	 */
	private _shouldFollowLink;
	/**
	 * Check response size against maxResponseSize limit
	 */
	private checkResponseSize;
	/**
	 * Collect data for later export
	 *
	 * @param data - Data to collect (will be added to export buffer)
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * crawler.onDocument(async (doc) => {
	 *   crawler.collect({
	 *     title: doc.title,
	 *     url: doc.URL,
	 *     h1: doc.querySelector('h1')?.textContent
	 *   });
	 * });
	 * ```
	 */
	collect(data: any): Crawler;
	/**
	 * Get all collected data
	 */
	getCollectedData(): any[];
	/**
	 * Clear collected data
	 */
	clearCollectedData(): Crawler;
	/**
	 * Export collected data to a file
	 *
	 * @param filePath - Output file path
	 * @param format - Export format: 'json', 'jsonl', or 'csv'
	 *
	 * @example
	 * ```typescript
	 * await crawler.waitForAll();
	 * await crawler.exportData('./output.json', 'json');
	 * await crawler.exportData('./output.csv', 'csv');
	 * ```
	 */
	exportData(filePath: string, format?: ExportFormat): Promise<void>;
	/**
	 * Get current crawl statistics
	 */
	getStats(): CrawlStats;
	/**
	 * Get health metrics snapshot for monitoring
	 */
	getHealthSnapshot(): HealthSnapshot;
	/**
	 * Check if crawler is healthy based on thresholds
	 */
	isHealthy(options?: {
		minSuccessRate?: number;
		maxAvgResponseTime?: number;
	}): boolean;
	/**
	 * Get Prometheus-formatted metrics for monitoring systems
	 */
	getPrometheusMetrics(prefix?: string): string;
	/**
	 * Trigger onStart handlers (called once on first visit)
	 * Uses promise lock to prevent race condition with concurrent visits
	 */
	private triggerStartHandlers;
	/**
	 * Trigger onFinish handlers
	 */
	private triggerFinishHandlers;
	/**
	 * Trigger onRedirect handlers
	 */
	private triggerRedirectHandlers;
	private buildUrl;
	/**
	 * Visits a URL and processes it according to registered event handlers.
	 * This is the primary method for initiating web crawling operations.
	 *
	 * @param url - The URL to visit (can be relative if baseUrl is configured)
	 * @param options - Optional configuration to override default settings
	 * @param options.method - HTTP method to use (default: "GET")
	 * @param options.headers - Additional headers for this request
	 * @param options.body - Request body for POST/PUT/PATCH requests
	 * @param options.timeout - Request timeout in milliseconds
	 * @param options.maxRedirects - Maximum redirects to follow
	 * @param options.maxRetryAttempts - Maximum retry attempts for this request
	 * @param options.retryDelay - Delay between retries in milliseconds
	 * @param options.retryOnStatusCode - Status codes that should trigger retry
	 * @param options.forceRevisit - Force visiting even if URL was previously visited
	 * @param options.retryWithoutProxyOnStatusCode - Status codes that trigger retry without proxy
	 * @param options.useProxy - Whether to use proxy for this request
	 * @param options.extractLeads - Whether to enable email lead extraction
	 * @returns The crawler instance for method chaining
	 *
	 * @example
	 * ```typescript
	 * // Basic usage
	 * crawler.visit('https://example.com');
	 *
	 * // With custom options
	 * crawler.visit('/api/data', {
	 *   method: 'POST',
	 *   body: JSON.stringify({ query: 'search term' }),
	 *   headers: { 'Content-Type': 'application/json' },
	 *   forceRevisit: true,
	 *   extractLeads: true
	 * });
	 *
	 * // Chain multiple visits
	 * crawler
	 *   .visit('/page1')
	 *   .visit('/page2')
	 *   .visit('/page3');
	 * ```
	 */
	visit(url: string, options?: {
		method?: "GET" | "POST" | "PUT" | "PATCH";
		headers?: OutgoingHttpHeaders | Record<string, string> | Headers;
		/** Query parameters to be appended to the URL. */
		params?: {
			[key: string]: string | number | boolean;
		};
		body?: any;
		timeout?: number;
		maxRedirects?: number;
		maxRetryAttempts?: number;
		retryDelay?: number;
		retryOnStatusCode?: number[];
		forceRevisit?: boolean;
		retryWithoutProxyOnStatusCode?: number[];
		useProxy?: boolean;
		extractLeads?: boolean;
		rejectUnauthorized?: boolean;
		useQueue?: boolean;
		deepEmailFinder?: boolean;
		useOxylabsScraperAi?: boolean;
		useOxylabsRotation?: boolean;
		useDecodo?: boolean;
		skipCache?: boolean;
		emailMetadata?: Record<string, any>;
	} & VisitOxylabsOverrides & VisitDecodoOverrides): Crawler;
	private execute;
	private execute2;
	private executeHttp;
	/**
	 * Waits for all queued crawling operations to complete.
	 * This method is essential for ensuring all asynchronous operations finish
	 * before the program exits or before processing results.
	 *
	 * @returns Promise that resolves when all queued operations are complete
	 *
	 * @example
	 * ```typescript
	 * // Queue multiple operations
	 * crawler
	 *   .visit('/page1')
	 *   .visit('/page2')
	 *   .visit('/page3');
	 *
	 * // Wait for all to complete
	 * await crawler.waitForAll();
	 * console.log('All pages have been processed');
	 *
	 * // Use in async function
	 * async function crawlWebsite() {
	 *   const results = [];
	 *
	 *   crawler.onDocument(async (doc) => {
	 *     results.push(doc.title);
	 *   });
	 *
	 *   crawler.visit('/sitemap');
	 *   await crawler.waitForAll();
	 *
	 *   return results;
	 * }
	 * ```
	 */
	waitForAll(): Promise<void>;
	/**
	 * Alias for waitForAll() - waits for all crawling operations to complete.
	 * @returns Promise that resolves when done
	 * @example
	 * ```typescript
	 * crawler.visit('https://example.com');
	 * await crawler.done();
	 * ```
	 */
	done(): Promise<void>;
	close(): Promise<void>;
	/**
	 * Destroys the crawler instance and releases all resources.
	 * Clears all queued tasks, closes caches, and cleans up event handlers.
	 * @returns Promise that resolves when destruction is complete
	 * @example
	 * ```typescript
	 * await crawler.destroy();
	 * // Crawler is now fully cleaned up
	 * ```
	 */
	destroy(): Promise<void>;
}

export {};
