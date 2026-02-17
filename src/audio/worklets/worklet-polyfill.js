/**
 * Polyfill for AudioWorkletGlobalScope where TextDecoder/TextEncoder might be missing.
 */

if (typeof TextDecoder === 'undefined') {
    globalThis.TextDecoder = class TextDecoder {
        constructor(label, options) {
            this.label = label;
            this.options = options;
        }
        decode(data) {
            if (!data) return '';
            const arr = (data instanceof Uint8Array) ? data : new Uint8Array(data.buffer || data);
            // Basic UTF-8 decoding support
            let out = '';
            let i = 0;
            while (i < arr.length) {
                const c = arr[i++];
                if (c < 0x80) out += String.fromCharCode(c);
                else if (c < 0xE0) out += String.fromCharCode(((c & 0x1F) << 6) | (arr[i++] & 0x3F));
                else if (c < 0xF0) out += String.fromCharCode(((c & 0x0F) << 12) | ((arr[i++] & 0x3F) << 6) | (arr[i++] & 0x3F));
                else i += 3; // Skip 4-byte sequences for simplicity if not needed
            }
            return out;
        }
    };
}

if (typeof TextEncoder === 'undefined') {
    globalThis.TextEncoder = class TextEncoder {
        constructor() {}
        encode(str) {
            const arr = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) {
                arr[i] = str.charCodeAt(i) & 0xFF;
            }
            return arr;
        }
    };
}

// Ensure self is defined (sometimes glue code looks for it)
if (typeof self === 'undefined') {
    globalThis.self = globalThis;
}
