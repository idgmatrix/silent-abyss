// Polyfill for AudioWorkletGlobalScope
try {
    if (typeof TextDecoder === 'undefined') {
        globalThis.TextDecoder = class TextDecoder {
            constructor(label, options) { this.label = label; this.options = options; }
            decode(data) {
                if (!data) return '';
                const arr = (data instanceof Uint8Array) ? data : new Uint8Array(data.buffer || data);
                let out = '';
                let i = 0;
                while (i < arr.length) {
                    const c = arr[i++];
                    if (c < 0x80) out += String.fromCharCode(c);
                    else if (c < 0xE0) out += String.fromCharCode(((c & 0x1F) << 6) | (arr[i++] & 0x3F));
                    else if (c < 0xF0) out += String.fromCharCode(((c & 0x0F) << 12) | ((arr[i++] & 0x3F) << 6) | (arr[i++] & 0x3F));
                    else i += 3;
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
                for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i) & 0xFF;
                return arr;
            }
        };
    }

    if (typeof self === 'undefined') { globalThis.self = globalThis; }
} catch (e) {
    console.error('Error in polyfills:', e);
}

// --- BEGIN INLINED dsp_core.js ---
let wasm;
let wasmModule;
let cachedUint8ArrayMemory0 = null;
let cachedTextDecoder = null;

try {
    cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
    cachedTextDecoder.decode();
} catch (e) {
    console.warn('wasm-engine.worklet: TextDecoder fatal mode not supported, falling back to loose mode', e);
    cachedTextDecoder = new TextDecoder('utf-8');
}

class DspGraph {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DspGraphFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_dspgraph_free(ptr, 0);
    }
    add_voice() {
        const ret = wasm.dspgraph_add_voice(this.__wbg_ptr);
        return ret;
    }
    max_frames() {
        const ret = wasm.dspgraph_max_frames(this.__wbg_ptr);
        return ret >>> 0;
    }
    constructor(sample_rate, max_frames, max_voices) {
        const ret = wasm.dspgraph_new(sample_rate, max_frames, max_voices);
        this.__wbg_ptr = ret >>> 0;
        DspGraphFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    output_len() {
        const ret = wasm.dspgraph_output_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    output_ptr() {
        const ret = wasm.dspgraph_output_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    process(frames) {
        const ret = wasm.dspgraph_process(this.__wbg_ptr, frames);
        return ret >>> 0;
    }
    remove_voice(voice_id) {
        const ret = wasm.dspgraph_remove_voice(this.__wbg_ptr, voice_id);
        return ret !== 0;
    }
    set_param(voice_id, param_id, value) {
        const ret = wasm.dspgraph_set_param(this.__wbg_ptr, voice_id, param_id, value);
        return ret !== 0;
    }
}
if (Symbol.dispose) DspGraph.prototype[Symbol.dispose] = DspGraph.prototype.free;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_be289d5034ed271b: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./dsp_core_bg.js": import0,
    };
}

const DspGraphFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_dspgraph_free(ptr >>> 0, 1));

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

function initSync(module) {
    if (wasm !== undefined) return wasm;
    const imports = __wbg_get_imports();
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}
// --- END INLINED dsp_core.js ---

class WasmEngineProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.wasm = null;
        this.graph = null;
        this.ready = false;
        this.defaultVoiceId = 0;
        this.fallbackMaxFrames = 128;
        this.failedMemoryAccess = false;

        this.port.onmessage = (event) => {
            this.handleMessage(event.data);
        };
    }

    async handleMessage(data) {
        if (!data || typeof data !== 'object') return;

        try {
            switch (data.type) {
                case 'INIT_WASM':
                    await this.initializeWasm(data);
                    break;
                case 'SET_PARAM':
                    this.handleSetParam(data);
                    break;
                case 'ADD_VOICE':
                    this.handleAddVoice();
                    break;
                case 'REMOVE_VOICE':
                    this.handleRemoveVoice(data);
                    break;
            }
        } catch (error) {
            console.error('wasm-engine.worklet: Error in handleMessage', error);
            this.port.postMessage({
                type: 'ERROR',
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : null
            });
        }
    }

    async initializeWasm(data) {
        if (this.ready) return;

        let module = data.wasmModule;
        if (!module && data.wasmBytes) {
            try {
                module = await WebAssembly.compile(data.wasmBytes);
            } catch (e) {
                throw new Error(`WASM compilation failed: ${e.message}`);
            }
        }

        if (!module) {
            throw new Error('INIT_WASM message missing wasmModule or wasmBytes');
        }

        try {
            this.wasm = initSync(module);
        } catch (e) {
            throw new Error(`InitSync failed: ${e.message}`);
        }

        const maxFrames = Number.isFinite(data.maxFrames) && data.maxFrames > 0
            ? Math.floor(data.maxFrames) : this.fallbackMaxFrames;
        const maxVoices = Number.isFinite(data.maxVoices) && data.maxVoices > 0
            ? Math.floor(data.maxVoices) : 8;

        // Verify sampleRate is available
        if (typeof sampleRate === 'undefined') {
            throw new Error('sampleRate is not defined in AudioWorkletGlobalScope');
        }

        this.graph = new DspGraph(sampleRate, maxFrames, maxVoices);

        if (data.autoAddVoice !== false) {
            const voiceId = this.graph.add_voice();
            if (voiceId >= 0) this.defaultVoiceId = voiceId;
        }

        this.ready = true;
        this.port.postMessage({ type: 'READY', defaultVoiceId: this.defaultVoiceId });
    }

    handleSetParam(data) {
        if (!this.graph) return;
        const voiceId = Number.isFinite(data.voiceId) && data.voiceId >= 0
            ? Math.floor(data.voiceId) : this.defaultVoiceId;
        const paramId = Math.floor(data.paramId);
        const value = Number(data.value);

        const ok = this.graph.set_param(voiceId, paramId, value);
        if (!ok) this.port.postMessage({ type: 'SET_PARAM_FAILED', voiceId, paramId, value });
    }

    handleAddVoice() {
        if (!this.graph) return;
        const voiceId = this.graph.add_voice();
        this.port.postMessage({ type: 'VOICE_ADDED', voiceId });
    }

    handleRemoveVoice(data) {
        if (!this.graph) return;
        const voiceId = Math.floor(data.voiceId);
        const ok = this.graph.remove_voice(voiceId);
        this.port.postMessage({ type: 'VOICE_REMOVED', voiceId, ok });
    }

    process(inputs, outputs) {
        const outputChannels = outputs[0];
        if (!outputChannels || outputChannels.length === 0) return true;

        const channel0 = outputChannels[0];
        const frames = channel0.length;

        if (!this.ready || !this.graph || !this.wasm) {
            // Keep alive but silent
            return true;
        }

        try {
            this.graph.process(frames);
            const len = this.graph.output_len();
            const ptr = this.graph.output_ptr();
            const memory = this.wasm.memory.buffer;

            // Simple safety checks
            if (ptr === 0 || len === 0) return true;

            // Create view with explicit error handling
            const samples = new Float32Array(memory, ptr, Math.min(len, frames));

            for (let ch = 0; ch < outputChannels.length; ch += 1) {
                const out = outputChannels[ch];
                out.set(samples);
            }
        } catch (e) {
            if (!this.failedMemoryAccess) {
                this.failedMemoryAccess = true;
                this.port.postMessage({ type: 'ERROR', error: `Process error: ${e.message}` });
            }
        }

        return true;
    }
}

registerProcessor('wasm-engine-processor', WasmEngineProcessor);