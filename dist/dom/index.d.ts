/**
 * Rezo DOM Module
 *
 * Re-exports all linkedom utilities for HTML parsing and DOM manipulation.
 * Import from 'rezo/dom' to access these exports.
 *
 * @module rezo/dom
 * @author Rezo HTTP Client Library
 *
 * @example
 * ```typescript
 * import { parseHTML, DOMParser } from 'rezo/dom';
 *
 * const { document } = parseHTML('<html><body>Hello</body></html>');
 * console.log(document.body.textContent); // 'Hello'
 *
 * const parser = new DOMParser();
 * const doc = parser.parseFromString('<div>Content</div>', 'text/html');
 * ```
 */
export * from "linkedom";

export {};
