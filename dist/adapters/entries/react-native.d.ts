import NodeFormData from 'form-data';
import { Blob as Blob$1 } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { Agent as HttpAgent, OutgoingHttpHeaders } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { Socket } from 'node:net';
import { Readable, Writable, WritableOptions } from 'node:stream';
import { SecureContext, TLSSocket } from 'node:tls';
import { Cookie as TouchCookie, CookieJar as TouchCookieJar, CreateCookieOptions } from 'tough-cookie';

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
export declare class RezoHeaders extends Headers {
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
	[Symbol.iterator](): ArrayIterator<[
		string,
		string | string[]
	]>;
	[util.inspect.custom](_depth: number, options: util.InspectOptionsStylized): string;
	get [Symbol.toStringTag](): string;
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
export declare class Cookie extends TouchCookie {
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
export declare class RezoCookieJar extends TouchCookieJar {
	constructor();
	constructor(cookies: Cookie[]);
	constructor(cookies: Cookie[], url: string);
	private generateCookies;
	cookies(): Cookies;
	parseResponseCookies(cookies: Cookie[]): Cookies;
	static toNetscapeCookie(cookies: Cookie[] | SerializedCookie[]): string;
	static toCookieString(cookies: Cookie[] | SerializedCookie[]): string;
	toCookieString(): string;
	toNetscapeCookie(): string;
	toArray(): Cookie[];
	toSetCookies(): string[];
	toSerializedCookies(): SerializedCookie[];
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
	loadFromFile(filePath: string, defaultUrl?: string): void;
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
export interface Cookies {
	array: Cookie[];
	serialized: SerializedCookie[];
	netscape: string;
	string: string;
	setCookiesString: string[];
}
export interface ReadableOptions {
	highWaterMark?: number;
	encoding?: string;
	objectMode?: boolean;
	read?(this: Readable, size: number): void;
	destroy?(this: Readable, error: Error | null, callback: (error: Error | null) => void): void;
	autoDestroy?: boolean;
}
export interface Options extends ReadableOptions {
	writable?: boolean;
	readable?: boolean;
	dataSize?: number;
	maxDataSize?: number;
	pauseStreams?: boolean;
}
export declare class RezoFormData extends NodeFormData {
	constructor(options?: Options);
	/**
	 * Get field entries as array of [name, value] pairs
	 * @returns {Promise<Array<[string, any]>>} Array of field entries
	 */
	getFieldEntries(): Promise<Array<[
		string,
		any
	]>>;
	/**
	 * Convert to native FormData
	 * @returns {Promise<FormData | null>}
	 */
	toNativeFormData(): Promise<FormData | null>;
	/**
	 * Create RezoFormData from native FormData
	 * @param {FormData} formData - Native FormData object
	 * @param {Options} options - Optional RezoFormData options
	 * @returns {Promise<RezoFormData>}
	 */
	static fromNativeFormData(formData: FormData, options?: Options): Promise<RezoFormData>;
	/**
	 * Get the content type header for this form data
	 * @returns {string} Content type with boundary
	 */
	getContentType(): string;
	/**
	 * Convert form data to Buffer
	 * @returns {Buffer} Form data as buffer
	 */
	toBuffer(): Buffer;
	/**
	 * Create RezoFormData from object
	 * Properly handles nested objects by JSON.stringify-ing them
	 * @param {Record<string, any>} obj - Object to convert
	 * @param {Options} options - Optional RezoFormData options
	 * @returns {RezoFormData}
	 */
	static fromObject(obj: Record<string, any>, options?: Options): RezoFormData;
	/**
	 * Helper to append a value to FormData with proper type handling
	 * @param {RezoFormData} formData - The form data to append to
	 * @param {string} key - The field name
	 * @param {any} value - The value to append
	 */
	private static appendValue;
	/**
	 * Convert to URL query string
	 * Warning: File, Blob, and binary data will be omitted
	 * @param {boolean} convertBinaryToBase64 - Convert binary data to base64 strings
	 * @returns {Promise<string>} URL query string
	 */
	toUrlQueryString(convertBinaryToBase64?: boolean): Promise<string>;
	/**
	 * Convert to URLSearchParams object
	 * Warning: File, Blob, and binary data will be omitted
	 * @param {boolean} convertBinaryToBase64 - Convert binary data to base64 strings
	 * @returns {Promise<URLSearchParams>} URLSearchParams object
	 */
	toURLSearchParams(convertBinaryToBase64?: boolean): Promise<URLSearchParams>;
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
 * Event map for StreamResponse - defines all available events and their signatures
 */
export interface StreamResponseEvents {
	close: [
	];
	drain: [
	];
	error: [
		err: RezoError
	];
	finish: [
		info: StreamFinishEvent
	];
	done: [
		info: StreamFinishEvent
	];
	start: [
		info: RequestStartEvent
	];
	initiated: [
	];
	headers: [
		info: ResponseHeadersEvent
	];
	cookies: [
		cookies: Cookie[]
	];
	status: [
		status: number,
		statusText: string
	];
	redirect: [
		info: RedirectEvent
	];
	progress: [
		progress: ProgressEvent$1
	];
	data: [
		chunk: Buffer | string
	];
	pipe: [
		src: Readable
	];
	unpipe: [
		src: Readable
	];
}
/**
 * Complete type-safe event method overrides for StreamResponse
 * All event listener methods return 'this' for chaining
 */
export interface StreamResponseEventOverrides {
	on<K extends keyof StreamResponseEvents>(event: K, listener: (...args: StreamResponseEvents[K]) => void): this;
	on(event: string | symbol, listener: (...args: any[]) => void): this;
	once<K extends keyof StreamResponseEvents>(event: K, listener: (...args: StreamResponseEvents[K]) => void): this;
	once(event: string | symbol, listener: (...args: any[]) => void): this;
	addListener<K extends keyof StreamResponseEvents>(event: K, listener: (...args: StreamResponseEvents[K]) => void): this;
	addListener(event: string | symbol, listener: (...args: any[]) => void): this;
	prependListener<K extends keyof StreamResponseEvents>(event: K, listener: (...args: StreamResponseEvents[K]) => void): this;
	prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
	prependOnceListener<K extends keyof StreamResponseEvents>(event: K, listener: (...args: StreamResponseEvents[K]) => void): this;
	prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
}
declare class StreamResponse extends Writable implements StreamResponseEventOverrides {
	private _finished;
	private _encoding?;
	constructor(opts?: WritableOptions);
	/**
	 * Set encoding for string chunks
	 * @param encoding - Buffer encoding (utf8, ascii, etc.)
	 * @returns this for chaining
	 */
	setEncoding(encoding: BufferEncoding): this;
	/**
	 * Get current encoding
	 */
	getEncoding(): BufferEncoding | undefined;
	/**
	 * Check if stream has finished
	 */
	isFinished(): boolean;
	/**
	 * Mark stream as finished (internal use)
	 * @internal
	 */
	_markFinished(): void;
	/**
	 * Internal write implementation required by Writable
	 * Emits 'data' event for each chunk received
	 * @internal
	 */
	_write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void;
	on(event: string | symbol, listener: (...args: any[]) => void): this;
	once(event: string | symbol, listener: (...args: any[]) => void): this;
	addListener(event: string | symbol, listener: (...args: any[]) => void): this;
	prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
	prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
	off(event: string | symbol, listener: (...args: any[]) => void): this;
	removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
	removeAllListeners(event?: string | symbol): this;
}
/**
 * Complete type-safe event method overrides for DownloadResponse
 * All event listener methods return 'this' for chaining
 */
export interface DownloadResponseEventOverrides {
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
	addListener(event: "error", listener: (err: RezoError) => void): this;
	addListener(event: "finish", listener: (info: DownloadFinishEvent) => void): this;
	addListener(event: "done", listener: (info: DownloadFinishEvent) => void): this;
	addListener(event: "start", listener: (info: RequestStartEvent) => void): this;
	addListener(event: "initiated", listener: () => void): this;
	addListener(event: "headers", listener: (info: ResponseHeadersEvent) => void): this;
	addListener(event: "cookies", listener: (cookies: Cookie[]) => void): this;
	addListener(event: "status", listener: (status: number, statusText: string) => void): this;
	addListener(event: "redirect", listener: (info: RedirectEvent) => void): this;
	addListener(event: "progress", listener: (progress: ProgressEvent$1) => void): this;
	addListener(event: string | symbol, listener: (...args: any[]) => void): this;
	prependListener(event: "error", listener: (err: RezoError) => void): this;
	prependListener(event: "finish", listener: (info: DownloadFinishEvent) => void): this;
	prependListener(event: "done", listener: (info: DownloadFinishEvent) => void): this;
	prependListener(event: "start", listener: (info: RequestStartEvent) => void): this;
	prependListener(event: "initiated", listener: () => void): this;
	prependListener(event: "headers", listener: (info: ResponseHeadersEvent) => void): this;
	prependListener(event: "cookies", listener: (cookies: Cookie[]) => void): this;
	prependListener(event: "status", listener: (status: number, statusText: string) => void): this;
	prependListener(event: "redirect", listener: (info: RedirectEvent) => void): this;
	prependListener(event: "progress", listener: (progress: ProgressEvent$1) => void): this;
	prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
	prependOnceListener(event: "error", listener: (err: RezoError) => void): this;
	prependOnceListener(event: "finish", listener: (info: DownloadFinishEvent) => void): this;
	prependOnceListener(event: "done", listener: (info: DownloadFinishEvent) => void): this;
	prependOnceListener(event: "start", listener: (info: RequestStartEvent) => void): this;
	prependOnceListener(event: "initiated", listener: () => void): this;
	prependOnceListener(event: "headers", listener: (info: ResponseHeadersEvent) => void): this;
	prependOnceListener(event: "cookies", listener: (cookies: Cookie[]) => void): this;
	prependOnceListener(event: "status", listener: (status: number, statusText: string) => void): this;
	prependOnceListener(event: "redirect", listener: (info: RedirectEvent) => void): this;
	prependOnceListener(event: "progress", listener: (progress: ProgressEvent$1) => void): this;
	prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
}
declare class DownloadResponse extends EventEmitter implements DownloadResponseEventOverrides {
	/** File name (basename or fullname) */
	fileName: string;
	/** Target URL */
	url: string;
	/** HTTP status code (set when headers received) */
	status?: number;
	/** HTTP status text (set when headers received) */
	statusText?: string;
	private _finished;
	constructor(fileName: string, url: string);
	/**
	 * Check if download has finished
	 */
	isFinished(): boolean;
	/**
	 * Mark download as finished (internal use)
	 * @internal
	 */
	_markFinished(): void;
	on(event: string | symbol, listener: (...args: any[]) => void): this;
	once(event: string | symbol, listener: (...args: any[]) => void): this;
	addListener(event: string | symbol, listener: (...args: any[]) => void): this;
	prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
	prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
	off(event: string | symbol, listener: (...args: any[]) => void): this;
	removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
	removeAllListeners(event?: string | symbol): this;
}
/**
 * Complete type-safe event method overrides for UploadResponse
 * All event listener methods return 'this' for chaining
 */
export interface UploadResponseEventOverrides {
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
	addListener(event: "error", listener: (err: RezoError) => void): this;
	addListener(event: "finish", listener: (info: UploadFinishEvent) => void): this;
	addListener(event: "done", listener: (info: UploadFinishEvent) => void): this;
	addListener(event: "start", listener: (info: RequestStartEvent) => void): this;
	addListener(event: "initiated", listener: () => void): this;
	addListener(event: "headers", listener: (info: ResponseHeadersEvent) => void): this;
	addListener(event: "cookies", listener: (cookies: Cookie[]) => void): this;
	addListener(event: "status", listener: (status: number, statusText: string) => void): this;
	addListener(event: "redirect", listener: (info: RedirectEvent) => void): this;
	addListener(event: "progress", listener: (progress: ProgressEvent$1) => void): this;
	addListener(event: string | symbol, listener: (...args: any[]) => void): this;
	prependListener(event: "error", listener: (err: RezoError) => void): this;
	prependListener(event: "finish", listener: (info: UploadFinishEvent) => void): this;
	prependListener(event: "done", listener: (info: UploadFinishEvent) => void): this;
	prependListener(event: "start", listener: (info: RequestStartEvent) => void): this;
	prependListener(event: "initiated", listener: () => void): this;
	prependListener(event: "headers", listener: (info: ResponseHeadersEvent) => void): this;
	prependListener(event: "cookies", listener: (cookies: Cookie[]) => void): this;
	prependListener(event: "status", listener: (status: number, statusText: string) => void): this;
	prependListener(event: "redirect", listener: (info: RedirectEvent) => void): this;
	prependListener(event: "progress", listener: (progress: ProgressEvent$1) => void): this;
	prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
	prependOnceListener(event: "error", listener: (err: RezoError) => void): this;
	prependOnceListener(event: "finish", listener: (info: UploadFinishEvent) => void): this;
	prependOnceListener(event: "done", listener: (info: UploadFinishEvent) => void): this;
	prependOnceListener(event: "start", listener: (info: RequestStartEvent) => void): this;
	prependOnceListener(event: "initiated", listener: () => void): this;
	prependOnceListener(event: "headers", listener: (info: ResponseHeadersEvent) => void): this;
	prependOnceListener(event: "cookies", listener: (cookies: Cookie[]) => void): this;
	prependOnceListener(event: "status", listener: (status: number, statusText: string) => void): this;
	prependOnceListener(event: "redirect", listener: (info: RedirectEvent) => void): this;
	prependOnceListener(event: "progress", listener: (progress: ProgressEvent$1) => void): this;
	prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
}
declare class UploadResponse extends EventEmitter implements UploadResponseEventOverrides {
	/** Target URL */
	url: string;
	/** File name if uploading a file */
	fileName?: string;
	/** HTTP status code (set when headers received) */
	status?: number;
	/** HTTP status text (set when headers received) */
	statusText?: string;
	private _finished;
	constructor(url: string, fileName?: string);
	/**
	 * Check if upload has finished
	 */
	isFinished(): boolean;
	/**
	 * Mark upload as finished (internal use)
	 * @internal
	 */
	_markFinished(): void;
	on(event: string | symbol, listener: (...args: any[]) => void): this;
	once(event: string | symbol, listener: (...args: any[]) => void): this;
	addListener(event: string | symbol, listener: (...args: any[]) => void): this;
	prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
	prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
	off(event: string | symbol, listener: (...args: any[]) => void): this;
	removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
	removeAllListeners(event?: string | symbol): this;
}
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
 * RezoStreamResponse - For responseType: 'stream'
 * Extends StreamResponse class (EventEmitter)
 * Emits 'data' events for response body chunks
 */
export interface RezoStreamResponse extends StreamResponse {
}
/**
 * RezoDownloadResponse - For fileName/saveTo options
 * Extends DownloadResponse class (EventEmitter)
 * Streams response body directly to file
 */
export interface RezoDownloadResponse extends DownloadResponse {
}
/**
 * RezoUploadResponse - For responseType: 'upload'
 * Extends UploadResponse class (EventEmitter)
 * Tracks upload progress and includes server response body
 */
export interface RezoUploadResponse extends UploadResponse {
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
 * Hook called before following a redirect
 * Use to inspect/modify redirect behavior
 */
export type BeforeRedirectHook = (config: RezoConfig, response: RezoResponse) => void | Promise<void>;
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
}
/**
 * Create empty hooks object with all arrays initialized
 */
export declare function createDefaultHooks(): RezoHooks;
/**
 * Merge base hooks with override hooks
 * Overrides are appended to base hooks (base runs first)
 */
export declare function mergeHooks(base: RezoHooks, overrides?: Partial<RezoHooks>): RezoHooks;
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
	/** @description Retry configuration */
	retry?: RezoRequestConfig["retry"];
	/** @description Compression settings */
	compression?: {
		/** @description Enable compression */
		enabled?: boolean;
		/** @description Compression threshold in bytes */
		threshold?: number;
		/** @description Supported compression algorithms */
		algorithms?: string[];
	};
	/** @description Enable cookie jar for session management */
	enableCookieJar?: boolean;
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
	/** @description Final resolved URL after redirects and processing */
	finalUrl: string;
	/** @description HTTP adapter used for the request */
	adapterUsed: "http" | "https" | "http2" | "fetch" | "xhr" | "curl";
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
	cookieJar: RezoCookieJar;
	/** @description Comprehensive timing information */
	timing: {
		/** @description Request start timestamp (absolute performance.now() value) */
		startTimestamp: number;
		/** @description Request end timestamp (absolute performance.now() value) */
		endTimestamp: number;
		/** @description DNS lookup duration in milliseconds */
		dnsMs?: number;
		/** @description TCP connection duration in milliseconds */
		tcpMs?: number;
		/** @description TLS handshake duration in milliseconds */
		tlsMs?: number;
		/** @description Time to first byte in milliseconds (from start to first response byte) */
		ttfbMs?: number;
		/** @description Content transfer duration in milliseconds */
		transferMs?: number;
		/** @description Total request duration in milliseconds (endTimestamp - startTimestamp) */
		durationMs: number;
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
	/** Character encoding for request body and response data */
	encoding?: BufferEncoding;
	/**
	 * Whether to use cookies for the request
	 */
	useCookies: boolean;
}
export declare enum RezoErrorCode {
	CONNECTION_REFUSED = "ECONNREFUSED",
	CONNECTION_RESET = "ECONNRESET",
	CONNECTION_TIMEOUT = "ETIMEDOUT",
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
	REQUEST_TIMEOUT = "UND_ERR_REQUEST_TIMEOUT",
	HEADERS_TIMEOUT = "UND_ERR_HEADERS_TIMEOUT",
	CONNECT_TIMEOUT = "UND_ERR_CONNECT_TIMEOUT",
	ABORTED = "ABORT_ERR",
	DOWNLOAD_FAILED = "REZ_DOWNLOAD_FAILED",
	UPLOAD_FAILED = "REZ_UPLOAD_FAILED",
	STREAM_ERROR = "REZ_STREAM_ERROR",
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
	CERTIFICATE_HOSTNAME_MISMATCH = "ERR_TLS_CERT_ALTNAME_INVALID",
	CERTIFICATE_EXPIRED = "CERT_HAS_EXPIRED",
	CERTIFICATE_SELF_SIGNED = "SELF_SIGNED_CERT_IN_CHAIN",
	CERTIFICATE_VERIFY_FAILED = "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	RATE_LIMITED = "REZ_RATE_LIMITED",
	UNKNOWN_ERROR = "REZ_UNKNOWN_ERROR"
}
export declare class RezoError<T = any> extends Error {
	readonly code?: string;
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
	readonly details: string;
	readonly suggestion: string;
	constructor(message: string, config: RezoConfig, code?: string, request?: RezoHttpRequest, response?: RezoResponse<T>);
	static isRezoError(error: unknown): error is RezoError;
	static fromError<T = any>(error: Error, config: RezoConfig, request?: RezoHttpRequest, response?: RezoResponse<T>): RezoError<T>;
	static createNetworkError<T = any>(message: string, code: string, config: RezoConfig, request?: RezoHttpRequest): RezoError<T>;
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
	static createProxyError<T = any>(code: string, config: RezoConfig, request?: RezoHttpRequest): RezoError<T>;
	static createSocksError<T = any>(code: string, config: RezoConfig, request?: RezoHttpRequest): RezoError<T>;
	static createTlsError<T = any>(code: string, config: RezoConfig, request?: RezoHttpRequest): RezoError<T>;
	static createRateLimitError<T = any>(config: RezoConfig, request?: RezoHttpRequest, response?: RezoResponse<T>): RezoError<T>;
	/**
	 * Convert error to JSON - only includes defined values
	 */
	toJSON(): Record<string, unknown>;
	toString(): string;
	getFullDetails(): string;
}
/**
 * Queue configuration options
 */
export interface QueueConfig {
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
	private intervalStart;
	private eventHandlers;
	private statsData;
	private totalDuration;
	private throughputWindow;
	private readonly throughputWindowSize;
	private idlePromise?;
	private emptyPromise?;
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
	 */
	onIdle(): Promise<void>;
	/**
	 * Wait for queue to be empty (no pending tasks, but may have running)
	 */
	onEmpty(): Promise<void>;
	/**
	 * Wait for queue size to be less than limit
	 * @param limit - Size threshold
	 */
	onSizeLessThan(limit: number): Promise<void>;
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
	 */
	private insertByPriority;
	/**
	 * Try to run next task if capacity available
	 */
	private tryRunNext;
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
/**
 * Response data types that control how Rezo parses the response body.
 *
 * @description
 * Specifies how the response body should be parsed and returned in `response.data`.
 * Choose the type that matches your expected response format.
 *
 * **Available Types:**
 *
 * - `'json'` - Parse response as JSON. Returns parsed object/array.
 *   Best for REST APIs that return JSON data.
 *
 * - `'text'` - Return response as a string. No parsing applied.
 *   Best for HTML, XML, plain text, or when you need raw content.
 *
 * - `'blob'` - Return as Blob object (browser environments).
 *   Best for binary data in browsers (images, files, etc).
 *
 * - `'arrayBuffer'` - Return as ArrayBuffer.
 *   Best for binary data processing, cryptographic operations.
 *
 * - `'buffer'` - Return as Node.js Buffer.
 *   Best for binary data in Node.js (files, images, binary protocols).
 *
 * - `'auto'` - Auto-detect based on Content-Type header (default).
 *   JSON for `application/json`, text for `text/*`, buffer otherwise.
 *
 * **Streaming Operations:**
 * For streaming, use dedicated methods instead of responseType:
 * - `rezo.stream(url)` - Returns StreamResponse for real-time data
 * - `rezo.download(url, saveTo)` - Returns DownloadResponse with progress
 * - `rezo.upload(url, data)` - Returns UploadResponse with progress
 *
 * @example
 * // Get JSON data (default for JSON APIs)
 * const { data } = await rezo.get('/api/users', { responseType: 'json' });
 *
 * // Get HTML as text
 * const { data: html } = await rezo.get('/page', { responseType: 'text' });
 *
 * // Get image as buffer
 * const { data: imageBuffer } = await rezo.get('/image.png', { responseType: 'buffer' });
 *
 * @default 'auto'
 */
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
	/** Retry configuration for failed requests */
	retry?: {
		/** Maximum number of retry attempts */
		maxRetries?: number;
		/** Delay between retries in milliseconds */
		retryDelay?: number;
		/** Whether to increment delay on each retry */
		incrementDelay?: boolean;
		/** HTTP status codes that should trigger a retry attempt  defaults are (408, 429, 500, 502, 503, 504, 425, 520) */
		statusCodes?: number[];
		/** Weather to stop or continue retry when certain condition is met*/
		condition?: (error: RezoError) => boolean | Promise<boolean>;
	};
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
	/** Custom cookie jar for managing cookies */
	cookieJar?: RezoCookieJar;
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
export type RezoHttpRequest = Omit<RezoRequestConfig, "body" | "url" | "method" | "form" | "json" | "formData" | "multipart" | "fullUrl" | "responseType">;
/**
 * Method-aware request types for better TypeScript inference
 * These types remove data/body fields from methods that don't typically use them
 */
/**
 * RezoHttpGetRequest - Request options for GET requests (no request body)
 * @public - Use with GET method
 */
export type RezoHttpGetRequest = Omit<RezoHttpRequest, "data" | "body">;
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
type BeforeProxySelectHook$1 = (context: BeforeProxySelectContext) => ProxyInfo | void | Promise<ProxyInfo | void>;
type AfterProxySelectHook$1 = (context: AfterProxySelectContext) => void | Promise<void>;
type BeforeProxyErrorHook$1 = (context: BeforeProxyErrorContext) => void | Promise<void>;
type AfterProxyErrorHook$1 = (context: AfterProxyErrorContext) => void | Promise<void>;
type BeforeProxyDisableHook$1 = (context: BeforeProxyDisableContext) => boolean | void | Promise<boolean | void>;
type AfterProxyDisableHook$1 = (context: AfterProxyDisableContext) => void | Promise<void>;
type AfterProxyRotateHook$1 = (context: AfterProxyRotateContext) => void | Promise<void>;
type AfterProxyEnableHook$1 = (context: AfterProxyEnableContext) => void | Promise<void>;
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
	/** Hook triggered when no proxies are available */
	onNoProxiesAvailable: OnNoProxiesAvailableHook$1[];
}
declare class ProxyManager {
	/** Configuration for the proxy manager */
	readonly config: ProxyManagerConfig;
	/** Internal proxy states map (proxyId -> state) */
	private states;
	/** Current index for sequential rotation */
	private currentIndex;
	/** Request counter for current proxy (sequential rotation) */
	private currentProxyRequests;
	/** Last selected proxy (for rotation tracking) */
	private lastSelectedProxy;
	/** Cooldown timers map (proxyId -> timerId) */
	private cooldownTimers;
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
	 * Get disabled proxies
	 */
	getDisabled(): ProxyInfo[];
	/**
	 * Get proxies in cooldown
	 */
	getCooldown(): ProxyInfo[];
	/**
	 * Process expired cooldowns and re-enable proxies
	 */
	private processExpiredCooldowns;
	/**
	 * Get next proxy based on rotation strategy
	 * @param url - The request URL (for whitelist/blacklist checking)
	 * @returns Selected proxy or null if should go direct
	 */
	next(url: string): ProxyInfo | null;
	/**
	 * Get detailed selection result with reason
	 * @param url - The request URL
	 * @returns Selection result with proxy and reason
	 */
	select(url: string): ProxySelectionResult;
	/**
	 * Select proxy based on rotation strategy
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
	add(proxies: ProxyInfo | ProxyInfo[]): void;
	/**
	 * Remove proxies from the pool
	 * @param proxies - Proxies to remove
	 */
	remove(proxies: ProxyInfo | ProxyInfo[]): void;
	/**
	 * Reset all proxies - re-enable all and reset counters
	 */
	reset(): void;
	/**
	 * Get current status of all proxies
	 */
	getStatus(): ProxyManagerStatus;
	/**
	 * Get state for a specific proxy
	 * @param proxy - The proxy to get state for
	 */
	getProxyState(proxy: ProxyInfo): ProxyState | undefined;
	/**
	 * Check if any proxies are available
	 */
	hasAvailableProxies(): boolean;
	/**
	 * Destroy the manager and cleanup timers
	 */
	destroy(): void;
	private runBeforeProxySelectHooksSync;
	private runAfterProxySelectHooksSync;
	private runBeforeProxyErrorHooksSync;
	private runAfterProxyErrorHooksSync;
	private runAfterProxyRotateHooks;
	private runAfterProxyDisableHooks;
	private runAfterProxyEnableHooks;
	/**
	 * Run onNoProxiesAvailable hooks synchronously
	 * Called when no proxies are available and an error is about to be thrown
	 */
	private runOnNoProxiesAvailableHooksSync;
	/**
	 * Run onNoProxiesAvailable hooks asynchronously
	 * Called when no proxies are available and an error is about to be thrown
	 */
	runOnNoProxiesAvailableHooks(context: OnNoProxiesAvailableContext): Promise<void>;
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
	/** Hooks for request/response lifecycle */
	hooks?: Partial<RezoHooks>;
	/** Whether to enable automatic cookie handling (default: true)*/
	enableCookieJar?: boolean;
	/** Custom cookie jar for managing cookies */
	cookieJar?: RezoHttpRequest["cookieJar"];
	/** Set default cookies to send with the requests in various formats */
	cookies?: RezoHttpRequest["cookies"];
	/**
	 * Path to cookie file for persistence.
	 * - .json files save cookies as serialized JSON
	 * - .txt files save cookies in Netscape format
	 * Cookies are loaded on construction and saved automatically after each request.
	 */
	cookieFile?: string;
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
}
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
declare class RezoURLSearchParams extends URLSearchParams {
	constructor(init?: string | URLSearchParams | NestedObject | string[][] | RezoURLSearchParams);
	/**
	 * Append a nested object to the search params
	 */
	appendObject(obj: NestedObject, prefix?: string): void;
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
	 * Convert to a plain object (useful for debugging)
	 */
	toObject(): Record<string, string>;
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
/**
 * Adapter function type - all adapters must implement this signature
 */
export type AdapterFunction<T = any> = (options: RezoRequestConfig, defaultOptions: RezoDefaultOptions, jar: RezoCookieJar) => Promise<RezoResponse<T> | RezoStreamResponse | RezoDownloadResponse | RezoUploadResponse>;
/**
 * Main Rezo class - Enterprise-grade HTTP client with advanced features
 */
export declare class Rezo {
	protected queue: RezoQueue | null;
	protected isQueueEnabled: boolean;
	defaults: RezoDefaultOptions;
	hooks: RezoHooks;
	private jar;
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
	private isvalidJson;
	private __create;
	/** Get the cookie jar for this instance */
	get cookieJar(): RezoCookieJar;
	set cookieJar(jar: RezoCookieJar);
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
	 * Get all cookies from the cookie jar in multiple convenient formats.
	 *
	 * Returns a `Cookies` object containing all stored cookies in various formats
	 * for different use cases. This provides flexible access to cookies for
	 * HTTP headers, file storage, serialization, or programmatic manipulation.
	 *
	 * The returned `Cookies` object contains:
	 * - **array**: `Cookie[]` - Array of Cookie class instances for programmatic access
	 * - **serialized**: `SerializedCookie[]` - Plain objects for JSON serialization/storage
	 * - **netscape**: `string` - Netscape cookie file format for file-based storage
	 * - **string**: `string` - Cookie header format (`key=value; key2=value2`) for HTTP requests
	 * - **setCookiesString**: `string[]` - Array of Set-Cookie header strings
	 *
	 * @returns A Cookies object with cookies in multiple formats
	 *
	 * @example
	 * ```typescript
	 * const cookies = rezo.getCookies();
	 *
	 * // Access as Cookie instances for programmatic use
	 * for (const cookie of cookies.array) {
	 *   console.log(`${cookie.key}=${cookie.value} (expires: ${cookie.expires})`);
	 * }
	 *
	 * // Get cookie header string for manual HTTP requests
	 * console.log(cookies.string); // "session=abc123; user=john"
	 *
	 * // Save to Netscape cookie file
	 * fs.writeFileSync('cookies.txt', cookies.netscape);
	 *
	 * // Serialize to JSON for storage
	 * const json = JSON.stringify(cookies.serialized);
	 * localStorage.setItem('cookies', json);
	 *
	 * // Get Set-Cookie headers (useful for proxying responses)
	 * for (const setCookie of cookies.setCookiesString) {
	 *   console.log(setCookie); // "session=abc123; Domain=example.com; Path=/; HttpOnly"
	 * }
	 *
	 * // Check cookie count
	 * console.log(`Total cookies: ${cookies.array.length}`);
	 *
	 * // Find specific cookie
	 * const sessionCookie = cookies.array.find(c => c.key === 'session');
	 * ```
	 *
	 * @see {@link setCookies} - Set cookies in the jar
	 * @see {@link clearCookies} - Remove all cookies from the jar
	 * @see {@link cookieJar} - Access the underlying RezoCookieJar for more methods
	 */
	getCookies(): Cookies;
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
}
/**
 * Extended Rezo instance with Axios-compatible static helpers.
 * Provides drop-in replacement API surface for Axios users.
 */
export interface RezoInstance extends Rezo {
	/** Create a new Rezo instance with custom configuration */
	create(config?: RezoDefaultOptions): Rezo;
	/** Type guard to check if an error is a RezoError instance */
	isRezoError: typeof RezoError.isRezoError;
	/** Check if an error is a cancellation error */
	isCancel: (error: unknown) => boolean;
	/** Alias for RezoError (Axios compatibility) */
	Cancel: typeof RezoError;
	/** AbortController for request cancellation (Axios compatibility) */
	CancelToken: typeof AbortController;
	/** Promise.all wrapper (Axios compatibility) */
	all: typeof Promise.all;
	/** Spread array arguments to callback function (Axios compatibility) */
	spread: <T extends unknown[], R>(callback: (...args: T) => R) => (array: T) => R;
}
export declare const isRezoError: typeof RezoError.isRezoError;
export declare const Cancel: typeof RezoError;
export declare const CancelToken: {
	new (): AbortController;
	prototype: AbortController;
};
export declare const isCancel: (error: unknown) => boolean;
export declare const all: {
	<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>[]>;
	<T extends readonly unknown[] | [
	]>(values: T): Promise<{
		-readonly [P in keyof T]: Awaited<T[P]>;
	}>;
};
export declare const spread: <T extends unknown[], R>(callback: (...args: T) => R) => (array: T) => R;
export declare const VERSION: string;
declare const rezo: RezoInstance;

export {
	ResponseType$1 as ResponseType,
	rezo as default,
};

export {};
