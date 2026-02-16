import { WasmAudioManager } from './audio/wasm-audio-manager.js';

export class AudioSystem {
    constructor() {
        this.ctx = null;
        this.wasmManager = new WasmAudioManager();
        this.ownVoiceId = 0;
        this.analyser = null;
        this.dataArray = null;
        this.targetNodes = new Map(); // Stores voice indices for targets
        this.focusedTargetId = null;
        this.bioTimeouts = new Set();
        this.timeDomainArray = null;
        this.computeProcessor = null;
    }

    async init() {
        if (this.ctx) return;

        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();

            this.analyser = this.ctx.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.85;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.timeDomainArray = new Float32Array(this.analyser.fftSize);
            this.analyser.connect(this.ctx.destination);

            // Initialize Wasm Manager with existing context and connect to analyser
            await this.wasmManager.init({
                ctx: this.ctx,
                outputNode: this.analyser
            });

            this.ownVoiceId = this.wasmManager.defaultVoiceId;
            this.wasmManager.setGain(0.8, this.ownVoiceId);
            this.wasmManager.setEngineMix(1.0, this.ownVoiceId);
            this.wasmManager.setCavMix(0.3, this.ownVoiceId);
            this.wasmManager.setBioMix(0.0, this.ownVoiceId); // Own ship shouldn't chirp like a dolphin
            this.wasmManager.setBlades(5.0, this.ownVoiceId);

        } catch (e) {
            console.error("Audio initialization failed:", e);
        }
    }

    setRpm(value) {
        if (this.wasmManager && this.wasmManager.ready) {
            this.wasmManager.setRpm(value, this.ownVoiceId);
        }
    }

    setComputeProcessor(processor) {
        this.computeProcessor = processor || null;
    }

    async createTargetAudio(target) {
        if (!this.ctx || !this.wasmManager.ready) return;
        const targetId = target.id;
        const type = target.type || 'SHIP';

        // Request a new voice from Wasm
        const voiceId = await this.wasmManager.addVoice();
        if (voiceId === -1) {
            console.warn("Max audio voices reached");
            return;
        }

        // Configure voice based on target
        this.wasmManager.setGain(0.01, voiceId);
        this.wasmManager.setBlades(target.bladeCount || 5, voiceId);
        this.wasmManager.setRpm(target.rpm || 0, voiceId);

        if (type === 'BIOLOGICAL') {
            this.wasmManager.setEngineMix(0.0, voiceId);
            this.wasmManager.setCavMix(0.0, voiceId);
            this.wasmManager.setBioMix(1.0, voiceId);
        } else if (type === 'STATIC') {
            this.wasmManager.setEngineMix(0.1, voiceId); // Low rumble
            this.wasmManager.setCavMix(0.3, voiceId);
            this.wasmManager.setBioMix(0.0, voiceId);
        } else {
            // SHIP or SUBMARINE
            this.wasmManager.setEngineMix(1.0, voiceId);
            this.wasmManager.setCavMix(type === 'SUBMARINE' ? 0.2 : 0.6, voiceId);
            this.wasmManager.setBioMix(0.0, voiceId);
        }

        this.targetNodes.set(targetId, { voiceId, type });
    }

    setFocusedTarget(targetId) {
        this.focusedTargetId = targetId;
    }

    updateTargetVolume(targetId, distance) {
        const node = this.targetNodes.get(targetId);
        if (node && this.wasmManager.ready) {
            // Increased base gain and scaling
            let vol = Math.max(0.015, (120 - distance) / 250) * 0.6;

            // Apply Acoustic Focus boost/ducking
            if (this.focusedTargetId === targetId) {
                vol *= 2.5; // Focus boost
            } else if (this.focusedTargetId) {
                vol *= 0.3; // Duck non-focused targets
            }

            this.wasmManager.setGain(vol, node.voiceId);
        }
    }

    createPingTap(vol = 0.5, startFreq = 1200, endFreq = 900) {
        if (!this.ctx) return;
        const time = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();

        osc.connect(g).connect(this.analyser);

        osc.frequency.setValueAtTime(startFreq, time);
        osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.1);

        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(vol, time + 0.02);
        g.gain.linearRampToValueAtTime(0, time + 1.2);

        osc.start(time);
        osc.stop(time + 1.3);
    }

    createPingEcho(vol = 0.3) {
        if (!this.ctx) return;
        const time = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();

        // Connect directly to analyser to bypass any sub-group ducking if implemented later,
        // but for now analyser is the master bus.
        osc.connect(g).connect(this.analyser);

        // Sharper sweep for echo: 1100Hz -> 850Hz
        osc.frequency.setValueAtTime(1100, time);
        osc.frequency.exponentialRampToValueAtTime(850, time + 0.08);

        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(vol, time + 0.01);
        g.gain.linearRampToValueAtTime(0, time + 0.6); // Shorter decay (0.6s)

        osc.start(time);
        osc.stop(time + 0.7);
    }

    getFrequencyData() {
        if (this.analyser && this.dataArray) {
            this.analyser.getByteFrequencyData(this.dataArray);
            return this.dataArray;
        }
        return new Uint8Array(0);
    }

    getContext() {
        return this.ctx;
    }

    getTimeDomainData() {
        if (this.analyser && this.timeDomainArray) {
            this.analyser.getFloatTimeDomainData(this.timeDomainArray);
            return this.timeDomainArray;
        }
        return null;
    }

    dispose() {
        if (this.wasmManager) {
            this.wasmManager.dispose();
        }
        if (this.ctx) {
            this.bioTimeouts.forEach(id => clearTimeout(id));
            this.bioTimeouts.clear();

            this.targetNodes.clear();

            if (this.analyser) {
                this.analyser.disconnect();
                this.analyser = null;
            }

            this.timeDomainArray = null;
            this.computeProcessor = null;
            this.ctx.close();
            this.ctx = null;
        }
    }
}
