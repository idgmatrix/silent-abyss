/**
 * Polyfill for AudioWorkletGlobalScope where TextDecoder/TextEncoder might be missing.
 */
if (typeof TextDecoder === 'undefined') {
    globalThis.TextDecoder = class TextDecoder {
        constructor() {}
        decode(data) {
            // Minimal decoding fallback (only works for ASCII if we really care,
            // but for WASM glue it's usually just for error messages or names)
            return '';
        }
    };
}

if (typeof TextEncoder === 'undefined') {
    globalThis.TextEncoder = class TextEncoder {
        constructor() {}
        encode(str) {
            return new Uint8Array(0);
        }
    };
}
