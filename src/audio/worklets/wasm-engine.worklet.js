import './worklet-polyfill.js';
import { DspGraph, initSync } from '../dsp-core/pkg/dsp_core.js';

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

    handleMessage(data) {
        if (!data || typeof data !== 'object') {
            return;
        }

        try {
            switch (data.type) {
                case 'INIT_WASM':
                    this.initializeWasm(data);
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
                default:
                    break;
            }
        } catch (error) {
            this.port.postMessage({
                type: 'ERROR',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    initializeWasm(data) {
        if (this.ready) {
            return;
        }

        if (data.wasmModule instanceof WebAssembly.Module) {
            this.wasm = initSync({ module: data.wasmModule });
        } else {
            throw new Error('INIT_WASM message must include wasmModule.');
        }

        const maxFrames =
            Number.isFinite(data.maxFrames) && data.maxFrames > 0
                ? Math.floor(data.maxFrames)
                : this.fallbackMaxFrames;
        const maxVoices =
            Number.isFinite(data.maxVoices) && data.maxVoices > 0
                ? Math.floor(data.maxVoices)
                : 8;

        this.graph = new DspGraph(sampleRate, maxFrames, maxVoices);

        if (data.autoAddVoice !== false) {
            const voiceId = this.graph.add_voice();
            if (voiceId >= 0) {
                this.defaultVoiceId = voiceId;
            }
        }

        this.ready = true;
        this.port.postMessage({ type: 'READY', defaultVoiceId: this.defaultVoiceId });
    }

    handleSetParam(data) {
        if (!this.graph) {
            return;
        }

        const voiceId =
            Number.isFinite(data.voiceId) && data.voiceId >= 0
                ? Math.floor(data.voiceId)
                : this.defaultVoiceId;
        const paramId = Math.floor(data.paramId);
        const value = Number(data.value);

        const ok = this.graph.set_param(voiceId, paramId, value);
        if (!ok) {
            this.port.postMessage({ type: 'SET_PARAM_FAILED', voiceId, paramId, value });
        }
    }

    handleAddVoice() {
        if (!this.graph) {
            return;
        }

        const voiceId = this.graph.add_voice();
        this.port.postMessage({ type: 'VOICE_ADDED', voiceId });
    }

    handleRemoveVoice(data) {
        if (!this.graph) {
            return;
        }

        const voiceId = Math.floor(data.voiceId);
        const ok = this.graph.remove_voice(voiceId);
        this.port.postMessage({ type: 'VOICE_REMOVED', voiceId, ok });
    }

    process(inputs, outputs) {
        const outputChannels = outputs[0];
        if (!outputChannels || outputChannels.length === 0) {
            return true;
        }

        const channel0 = outputChannels[0];
        const frames = channel0.length;

        if (!this.ready || !this.graph || !this.wasm) {
            for (let ch = 0; ch < outputChannels.length; ch += 1) {
                outputChannels[ch].fill(0);
            }
            return true;
        }

        this.graph.process(frames);
        const len = this.graph.output_len();
        const ptr = this.graph.output_ptr();
        const memory = this.wasm && this.wasm.memory && this.wasm.memory.buffer;

        if (!(memory instanceof ArrayBuffer)) {
            if (!this.failedMemoryAccess) {
                this.failedMemoryAccess = true;
                this.port.postMessage({
                    type: 'ERROR',
                    error: 'Wasm memory is not initialized on processor.',
                });
            }
            for (let ch = 0; ch < outputChannels.length; ch += 1) {
                outputChannels[ch].fill(0);
            }
            return true;
        }

        const safeLen = Math.min(frames, len);
        const samples = new Float32Array(memory, ptr, safeLen);

        for (let ch = 0; ch < outputChannels.length; ch += 1) {
            const out = outputChannels[ch];
            out.fill(0);
            out.set(samples.subarray(0, Math.min(out.length, safeLen)));
        }

        return true;
    }
}

registerProcessor('wasm-engine-processor', WasmEngineProcessor);
