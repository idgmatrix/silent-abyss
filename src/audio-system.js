import { WasmAudioManager } from './audio/wasm-audio-manager.js';

export class AudioSystem {
    constructor() {
        this.ctx = null;
        this.wasmManager = new WasmAudioManager();
        this.ownVoiceId = 0;
        this.ownBaseGain = 0.8;
        this.ownCurrentGain = this.ownBaseGain;
        this.lastOwnGainUpdateTime = 0;
        this.analyser = null;
        this.dataArray = null;
        this.targetNodes = new Map(); // Stores voice indices for targets
        this.focusedTargetId = null;
        this.bioTimeouts = new Set();
        this.timeDomainArray = null;
        this.computeProcessor = null;
        this.focusSettings = {
            gainFloor: 0.015,
            distanceMax: 120,
            distanceScale: 250,
            baseDistanceGainMultiplier: 0.6,
            focusedTargetBoost: 2.1,
            backgroundDuck: 0.1,
            ownShipDuck: 0.15,
            gainAttack: 0.07,
            gainRelease: 0.26,
            mixAttack: 0.1,
            mixRelease: 0.32,
            focusedEngineFactor: 1.05,
            focusedCavFactor: 1.1,
            focusedBioFactor: 1.0,
            backgroundEngineFactor: 0.75,
            backgroundCavFactor: 0.1,
            backgroundBioFactor: 0.6,
        };
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
            this.ownCurrentGain = this.ownBaseGain;
            this.lastOwnGainUpdateTime = this.ctx.currentTime;
            this.wasmManager.setGain(this.ownBaseGain, this.ownVoiceId);
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
        const now = this.ctx.currentTime;

        // Request a new voice from Wasm
        const voiceId = await this.wasmManager.addVoice();
        if (voiceId === -1) {
            console.warn("Max audio voices reached");
            return;
        }

        // Configure voice based on target
        const initialGain = 0.01;
        this.wasmManager.setGain(initialGain, voiceId);
        this.wasmManager.setBlades(target.bladeCount || 5, voiceId);
        this.wasmManager.setRpm(target.rpm || 0, voiceId);
        let baseEngineMix = 1.0;
        let baseCavMix = 0.6;
        let baseBioMix = 0.0;

        if (type === 'BIOLOGICAL') {
            baseEngineMix = 0.0;
            baseCavMix = 0.0;
            baseBioMix = 1.0;
        } else if (type === 'STATIC') {
            baseEngineMix = 0.1; // Low rumble
            baseCavMix = 0.3;
            baseBioMix = 0.0;
        } else {
            // SHIP or SUBMARINE
            baseEngineMix = 1.0;
            baseCavMix = type === 'SUBMARINE' ? 0.2 : 0.6;
            baseBioMix = 0.0;
        }

        this.wasmManager.setEngineMix(baseEngineMix, voiceId);
        this.wasmManager.setCavMix(baseCavMix, voiceId);
        this.wasmManager.setBioMix(baseBioMix, voiceId);

        this.targetNodes.set(targetId, {
            voiceId,
            type,
            baseEngineMix,
            baseCavMix,
            baseBioMix,
            currentGain: initialGain,
            currentEngineMix: baseEngineMix,
            currentCavMix: baseCavMix,
            currentBioMix: baseBioMix,
            lastUpdateTime: now,
        });
    }

    setFocusedTarget(targetId) {
        const nextFocus = (targetId !== null && targetId !== undefined && this.targetNodes.has(targetId))
            ? targetId
            : null;
        if (this.focusedTargetId === nextFocus) return;

        this.focusedTargetId = nextFocus;
        this.updateOwnShipFocusGain();
    }

    updateTargetVolume(targetId, distance) {
        const node = this.targetNodes.get(targetId);
        if (node && this.wasmManager.ready) {
            const now = this.ctx ? this.ctx.currentTime : performance.now() / 1000;
            const dt = Math.max(0, Math.min(0.2, now - (node.lastUpdateTime || now)));
            node.lastUpdateTime = now;

            // Distance attenuation baseline
            const cfg = this.focusSettings;
            let targetGain = Math.max(cfg.gainFloor, (cfg.distanceMax - distance) / cfg.distanceScale) * cfg.baseDistanceGainMultiplier;

            const hasFocus = this.focusedTargetId !== null;
            const isFocused = this.focusedTargetId === targetId;
            if (isFocused) {
                targetGain *= cfg.focusedTargetBoost;
            } else if (hasFocus) {
                targetGain *= cfg.backgroundDuck;
            }

            const gainRising = targetGain > node.currentGain;
            const gainTau = gainRising ? cfg.gainAttack : cfg.gainRelease;
            const gainAlpha = 1 - Math.exp(-dt / Math.max(0.001, gainTau));
            node.currentGain += (targetGain - node.currentGain) * gainAlpha;
            this.wasmManager.setGain(node.currentGain, node.voiceId);

            // Tactical spectral focus (pseudo low-pass on background contacts)
            const engineFactor = isFocused
                ? cfg.focusedEngineFactor
                : hasFocus
                    ? cfg.backgroundEngineFactor
                    : 1.0;
            const cavFactor = isFocused
                ? cfg.focusedCavFactor
                : hasFocus
                    ? cfg.backgroundCavFactor
                    : 1.0;
            const bioFactor = isFocused
                ? cfg.focusedBioFactor
                : hasFocus
                    ? cfg.backgroundBioFactor
                    : 1.0;

            const targetEngineMix = Math.min(1, Math.max(0, node.baseEngineMix * engineFactor));
            const targetCavMix = Math.min(1, Math.max(0, node.baseCavMix * cavFactor));
            const targetBioMix = Math.min(1, Math.max(0, node.baseBioMix * bioFactor));

            const mixRising = targetEngineMix > node.currentEngineMix ||
                targetCavMix > node.currentCavMix ||
                targetBioMix > node.currentBioMix;
            const mixTau = mixRising ? cfg.mixAttack : cfg.mixRelease;
            const mixAlpha = 1 - Math.exp(-dt / Math.max(0.001, mixTau));

            node.currentEngineMix += (targetEngineMix - node.currentEngineMix) * mixAlpha;
            node.currentCavMix += (targetCavMix - node.currentCavMix) * mixAlpha;
            node.currentBioMix += (targetBioMix - node.currentBioMix) * mixAlpha;

            this.wasmManager.setEngineMix(node.currentEngineMix, node.voiceId);
            this.wasmManager.setCavMix(node.currentCavMix, node.voiceId);
            this.wasmManager.setBioMix(node.currentBioMix, node.voiceId);
        }
    }

    updateOwnShipFocusGain(now = this.ctx ? this.ctx.currentTime : performance.now() / 1000) {
        if (!this.wasmManager || !this.wasmManager.ready) return;

        const dt = Math.max(0, Math.min(0.2, now - (this.lastOwnGainUpdateTime || now)));
        this.lastOwnGainUpdateTime = now;

        const focusActive = this.focusedTargetId !== null;
        const targetOwnGain = focusActive
            ? this.ownBaseGain * this.focusSettings.ownShipDuck
            : this.ownBaseGain;
        const ownRising = targetOwnGain > this.ownCurrentGain;
        const ownTau = ownRising ? this.focusSettings.gainAttack : this.focusSettings.gainRelease;
        const ownAlpha = 1 - Math.exp(-dt / Math.max(0.001, ownTau));
        this.ownCurrentGain += (targetOwnGain - this.ownCurrentGain) * ownAlpha;

        this.wasmManager.setGain(this.ownCurrentGain, this.ownVoiceId);
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
