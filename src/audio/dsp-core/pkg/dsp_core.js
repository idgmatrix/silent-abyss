/* @ts-self-types="./dsp_core.d.ts" */

export class DspGraph {
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
    /**
     * @returns {number}
     */
    add_voice() {
        const ret = wasm.dspgraph_add_voice(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    max_frames() {
        const ret = wasm.dspgraph_max_frames(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} sample_rate
     * @param {number} max_frames
     * @param {number} max_voices
     */
    constructor(sample_rate, max_frames, max_voices) {
        const ret = wasm.dspgraph_new(sample_rate, max_frames, max_voices);
        this.__wbg_ptr = ret >>> 0;
        DspGraphFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    output_len() {
        const ret = wasm.dspgraph_output_len(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    output_ptr() {
        const ret = wasm.dspgraph_output_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} frames
     * @returns {number}
     */
    process(frames) {
        const ret = wasm.dspgraph_process(this.__wbg_ptr, frames);
        return ret >>> 0;
    }
    /**
     * @param {number} voice_id
     * @returns {boolean}
     */
    remove_voice(voice_id) {
        const ret = wasm.dspgraph_remove_voice(this.__wbg_ptr, voice_id);
        return ret !== 0;
    }
    /**
     * @param {number} voice_id
     * @param {number} param_id
     * @param {number} value
     * @returns {boolean}
     */
    set_param(voice_id, param_id, value) {
        const ret = wasm.dspgraph_set_param(this.__wbg_ptr, voice_id, param_id, value);
        return ret !== 0;
    }
}
if (Symbol.dispose) DspGraph.prototype[Symbol.dispose] = DspGraph.prototype.free;

/**
 * @returns {number}
 */
export function param_bio_mix() {
    const ret = wasm.param_bio_mix();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function param_blades() {
    const ret = wasm.param_blades();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function param_cav_mix() {
    const ret = wasm.param_cav_mix();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function param_engine_mix() {
    const ret = wasm.param_engine_mix();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function param_gain() {
    const ret = wasm.param_gain();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function param_rpm() {
    const ret = wasm.param_rpm();
    return ret >>> 0;
}

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

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('dsp_core_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
