const DEFAULT_WORKLET_URL = new URL('./worklets/wasm-engine.worklet.js', import.meta.url);
const DEFAULT_WASM_URL = new URL('./dsp-core/pkg/dsp_core_bg.wasm', import.meta.url);

export class WasmAudioManager {
    constructor() {
        this.ctx = null;
        this.ownsContext = false;
        this.node = null;
        this.outputGain = null;
        this.ready = false;
        this.defaultVoiceId = 0;
        this._addVoiceQueue = [];

        this.paramIds = {
            RPM: 0,
            BLADES: 1,
            GAIN: 2,
            ENGINE_MIX: 3,
            CAV_MIX: 4,
            BIO_MIX: 5,
        };
    }

    async init({
        ctx = null,
        outputNode = null,
        workletPath = DEFAULT_WORKLET_URL,
        wasmPath = DEFAULT_WASM_URL,
        maxFrames = 128,
        maxVoices = 8,
        autoAddVoice = true,
    } = {}) {
        if (this.ctx) {
            return;
        }

        this.ready = false;
        this.defaultVoiceId = 0;
        this.ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        this.ownsContext = !ctx;

        const workletUrl = workletPath instanceof URL ? workletPath : new URL(workletPath, import.meta.url);
        await this.ctx.audioWorklet.addModule(workletUrl.href);

        this.node = new AudioWorkletNode(this.ctx, 'wasm-engine-processor', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
        });

        this.outputGain = this.ctx.createGain();
        this.outputGain.gain.value = 1.0;
        this.node.connect(this.outputGain);

        if (outputNode) {
            this.outputGain.connect(outputNode);
        } else {
            this.outputGain.connect(this.ctx.destination);
        }

        this.node.port.onmessage = (event) => {
            this.handleProcessorMessage(event.data);
        };

        const wasmUrl = wasmPath instanceof URL ? wasmPath : new URL(wasmPath, import.meta.url);
        const response = await fetch(wasmUrl);
        if (!response.ok) {
            throw new Error(`Failed to load wasm module (${response.status} ${response.statusText}) from ${wasmUrl.href}`);
        }
        const bytes = await response.arrayBuffer();
        const wasmModule = await WebAssembly.compile(bytes);

        this.node.port.postMessage({
            type: 'INIT_WASM',
            wasmModule,
            maxFrames,
            maxVoices,
            autoAddVoice,
        });

        await this.waitUntilReady();
    }

    handleProcessorMessage(data) {
        if (!data || typeof data !== 'object') {
            return;
        }

        if (data.type === 'READY') {
            this.ready = true;
            this.defaultVoiceId = data.defaultVoiceId ?? this.defaultVoiceId;
            return;
        }

        if (data.type === 'VOICE_ADDED') {
            const resolver = this._addVoiceQueue.shift();
            if (resolver) {
                resolver(data.voiceId);
            }
            return;
        }

        if (data.type === 'ERROR') {
            console.error('WasmEngineProcessor error:', data.error);
            const resolver = this._addVoiceQueue.shift();
            if (resolver) {
                resolver(-1);
            }
            return;
        }

        if (data.type === 'SET_PARAM_FAILED') {
            console.warn('SET_PARAM failed:', data);
        }
    }

    waitUntilReady(timeoutMs = 5000) {
        const start = performance.now();
        return new Promise((resolve, reject) => {
            const tick = () => {
                if (this.ready) {
                    resolve();
                    return;
                }
                if (performance.now() - start > timeoutMs) {
                    reject(new Error('Timed out waiting for wasm-engine-processor to initialize.'));
                    return;
                }
                setTimeout(tick, 10);
            };
            tick();
        });
    }

    async resume() {
        if (this.ctx && this.ctx.state !== 'running') {
            await this.ctx.resume();
        }
    }

    setParam(paramId, value, voiceId = this.defaultVoiceId) {
        if (!this.node) {
            return;
        }
        this.node.port.postMessage({
            type: 'SET_PARAM',
            voiceId,
            paramId,
            value,
        });
    }

    setRpm(value, voiceId = this.defaultVoiceId) {
        this.setParam(this.paramIds.RPM, value, voiceId);
    }

    setBlades(value, voiceId = this.defaultVoiceId) {
        this.setParam(this.paramIds.BLADES, value, voiceId);
    }

    setGain(value, voiceId = this.defaultVoiceId) {
        this.setParam(this.paramIds.GAIN, value, voiceId);
    }

    setEngineMix(value, voiceId = this.defaultVoiceId) {
        this.setParam(this.paramIds.ENGINE_MIX, value, voiceId);
    }

    setCavMix(value, voiceId = this.defaultVoiceId) {
        this.setParam(this.paramIds.CAV_MIX, value, voiceId);
    }

    setBioMix(value, voiceId = this.defaultVoiceId) {
        this.setParam(this.paramIds.BIO_MIX, value, voiceId);
    }

    addVoice() {
        if (!this.node) {
            return Promise.resolve(-1);
        }
        return new Promise((resolve) => {
            this._addVoiceQueue.push(resolve);
            this.node.port.postMessage({ type: 'ADD_VOICE' });
        });
    }

    removeVoice(voiceId) {
        if (!this.node) {
            return;
        }
        this.node.port.postMessage({ type: 'REMOVE_VOICE', voiceId });
    }

    setMasterGain(value) {
        if (!this.outputGain || !this.ctx) {
            return;
        }
        this.outputGain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
    }

    getContext() {
        return this.ctx;
    }

    dispose() {
        if (this.node) {
            this.node.disconnect();
            this.node = null;
        }

        if (this.outputGain) {
            this.outputGain.disconnect();
            this.outputGain = null;
        }

        if (this.ctx && this.ownsContext) {
            this.ctx.close();
        }
        this.ctx = null;
        this.ownsContext = false;

        this.ready = false;
    }
}
