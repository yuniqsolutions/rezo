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
/**
 * HTTP/2 SETTINGS a browser sends on its connection preface. Every field is optional: a field that is absent is
 * NOT sent (browsers omit most of them — Chrome sends 1/2/4/6 only, Firefox 1/2/4/5, Safari 2/4/3), so presence
 * is part of the fingerprint. `connectionWindowSize` is the connection-level WINDOW_UPDATE increment sent right
 * after SETTINGS (absent = no WINDOW_UPDATE).
 */
export interface Http2Settings {
	/** SETTINGS_HEADER_TABLE_SIZE (0x01) */
	headerTableSize?: number;
	/** SETTINGS_ENABLE_PUSH (0x02) */
	enablePush?: boolean;
	/** SETTINGS_MAX_CONCURRENT_STREAMS (0x03) */
	maxConcurrentStreams?: number;
	/** SETTINGS_INITIAL_WINDOW_SIZE (0x04) */
	initialWindowSize?: number;
	/** SETTINGS_MAX_FRAME_SIZE (0x05) */
	maxFrameSize?: number;
	/** SETTINGS_MAX_HEADER_LIST_SIZE (0x06) */
	maxHeaderListSize?: number;
	/** Connection-level WINDOW_UPDATE increment sent after SETTINGS */
	connectionWindowSize?: number;
}
/** Headers a browser adds only on one HTTP version (e.g. Chrome's `priority` and Firefox's `te: trailers` on HTTP/2). */
export interface AdapterSpecificHeaders {
	/** Sent on HTTP/1.1 requests only */
	h1?: Record<string, string>;
	/** Sent on HTTP/2 requests only */
	h2?: Record<string, string>;
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
	/** Headers this browser adds only on one HTTP version; when absent the family default applies */
	extraHeaders?: AdapterSpecificHeaders;
	/** Extended-support release: stays in the random pools even when older than the family's current major − 2 */
	esr?: boolean;
}
/**
 * What the current runtime could and could not express of the profile's TLS material. Recorded on every
 * resolved profile so that "stealth is configured" is never mistaken for "stealth is on the wire".
 */
export interface TlsBoundary {
	/** The runtime that resolved the profile and whether its TLS stack honours cipher/group/sigalg shaping */
	runtime: {
		name: "node" | "bun" | "deno" | "browser" | "unknown";
		tlsShaping: "available" | "unavailable";
	};
	/** Post-quantum hybrid group: expressible, rejected by the TLS stack (fallback list used), or not part of the profile */
	hybridGroup: "supported" | "unsupported" | "not-requested";
	/** The supported-group list actually configured after probing (OpenSSL names, key-share groups first) */
	groups: string[];
	/** ClientHello dimensions this runtime cannot express at all (documented, never hidden) */
	notExpressible: string[];
}
/**
 * Union type of all built-in browser profile IDs.
 * Provides full autocomplete in IDEs.
 */
export type BrowserProfileName = "chrome-120" | "chrome-124" | "chrome-128" | "chrome-131" | "chrome-151" | "chrome-131-android" | "chrome-151-android" | "firefox-115" | "firefox-121" | "firefox-128" | "firefox-133" | "firefox-140-esr" | "firefox-154" | "safari-16.6" | "safari-17.4" | "safari-18.2" | "safari-26.6" | "safari-17-ios" | "safari-18-ios" | "safari-26-ios" | "edge-120" | "edge-131" | "edge-151" | "opera-115" | "opera-135" | "brave-1.73" | "brave-1.93";
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
	/** Headers added only on one HTTP version (Chrome `priority` on H2, Firefox `te: trailers` on H2, …) */
	extraHeaders: AdapterSpecificHeaders;
	/** Navigator properties for JS environment emulation */
	navigator: BrowserProfile["navigator"];
	/** What this runtime could express of the TLS material (probe results, fallbacks, boundaries) */
	tlsBoundary: TlsBoundary;
	/**
	 * Deterministic digest of the transport fingerprint material (TLS ciphers, sigalgs, groups, versions, ALPN,
	 * HTTP/2 settings and window). Two profiles with equal material share HTTP/2 sessions; different material never does.
	 */
	transportDigest: string;
}
export declare class RezoStealth {
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
/** Node-only capability: on this runtime the call refuses with `REZ_UNSUPPORTED_CAPABILITY`. */
export declare function createSecureContext(_fingerprint: TlsFingerprint): never;
/** Node-only capability: on this runtime the call refuses with `REZ_UNSUPPORTED_CAPABILITY`. */
export declare function buildTlsOptions(_fingerprint: TlsFingerprint): never;
/**
 * Resolve a profile input into a full ResolvedStealthProfile.
 *
 * @param input Profile name string, BrowserProfile object, or RezoStealthOptions
 * @returns Fully resolved profile ready for adapter consumption
 */
export declare function resolveProfile(input: BrowserProfileName | BrowserProfile | RezoStealthOptions): ResolvedStealthProfile;
/**
 * Auto-detect a browser profile from a User-Agent string.
 *
 * Uses ua-parser-js to parse the UA and find the best matching profile.
 * Falls back to latest Chrome if no match is found.
 *
 * @param userAgent The User-Agent string to match
 * @returns The best matching BrowserProfile, or undefined if no match
 */
export declare function detectProfileFromUserAgent(userAgent: string): BrowserProfile | undefined;
/** Master registry of all browser profiles keyed by profile ID (immutable; values are deep-frozen). */
export declare const PROFILE_REGISTRY: ReadonlyMap<string, BrowserProfile>;
/** Get a profile by its ID. Returns undefined if not found. */
export declare function getProfile(id: string): BrowserProfile | undefined;
/** Get all profiles for a given browser family. */
export declare function getProfilesByFamily(family: BrowserProfile["family"]): BrowserProfile[];
/** Get all profiles for a given device type. */
export declare function getProfilesByDevice(device: BrowserProfile["device"]): BrowserProfile[];
/** List all available profile IDs. */
export declare function listProfiles(): string[];
/** List all available profile IDs for a given family. */
export declare function listProfilesByFamily(family: BrowserProfile["family"]): string[];
/** Get a random profile from the registry (retired identities excluded). */
export declare function getRandomProfile(): BrowserProfile;
/** Get a random profile from a specific family (retired identities excluded). */
export declare function getRandomProfileByFamily(family: BrowserProfile["family"]): BrowserProfile;

export {};
