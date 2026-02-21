import { WasmAudioManager } from './audio/wasm-audio-manager.js';

const BIO_TYPE_TO_PARAM = {
    chirp: 0,
    snapping_shrimp: 1,
    whale_moan: 2,
    dolphin_whistle: 3,
    echolocation_click: 4,
    humpback_song: 5
};

export class AudioSystem {
    constructor() {
        this.ctx = null;
        this.wasmManager = new WasmAudioManager();
        this.analysisWasmManager = new WasmAudioManager();
        this.analysisOwnShipWasmManager = new WasmAudioManager();
        this.ownVoiceId = 0;
        this.analysisOwnShipVoiceId = -1;
        this.ownShipBladeCount = 5;
        this.ownShipRpm = 0;
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
        this.outputGain = null;

        // Internal analysis buses for DEMON/LOFAR.
        this.analysisOwnShipGain = null;
        this.analysisContactsGain = null;
        this.analysisSelectedGain = null;
        this.analysisMixGain = null;
        this.analysisCompositeAnalyser = null;
        this.analysisSelectedAnalyser = null;
        this.analysisCompositeDataArray = null;
        this.analysisSelectedDataArray = null;
        this.analysisCompositeTimeDomainArray = null;
        this.analysisSelectedTimeDomainArray = null;

        this.startupFadeDelay = 0.12;
        this.startupFadeDuration = 0.28;
        this.focusSettings = {
            gainFloor: 0.005,
            distanceMax: 150,
            distanceScale: 300,
            baseDistanceGainMultiplier: 0.5,
            focusedTargetBoost: 4.0, // Significant boost
            backgroundDuck: 0.05, // More aggressive ducking
            ownShipDuck: 0.08,
            gainAttack: 0.05,
            gainRelease: 0.2,
            mixAttack: 0.08,
            mixRelease: 0.25,
            focusedEngineFactor: 1.2,
            focusedCavFactor: 1.2,
            focusedBioFactor: 1.0,
            backgroundEngineFactor: 0.4, // Muffle background
            backgroundCavFactor: 0.05,
            backgroundBioFactor: 0.1, // Near-mute background biologicals
        };

        this.analysisFocusSettings = {
            focusedTargetBoost: 6.0,
            backgroundDuck: 0.12,
            gainAttack: 0.04,
            gainRelease: 0.25,
            focusedEngineFactor: 1.1,
            focusedCavFactor: 1.1,
            focusedBioFactor: 1.0,
            backgroundEngineFactor: 0.35,
            backgroundCavFactor: 0.1,
            backgroundBioFactor: 0.2
        };

        this.analysisOwnShipSettings = {
            baseGain: 1.0,
            focusedDuck: 0.32,
            attack: 0.05,
            release: 0.22
        };
        this.currentAnalysisOwnShipGain = this.analysisOwnShipSettings.baseGain;
    }

    _configureAnalyser(analyser) {
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.85;
        analyser.minDecibels = -120;
        analyser.maxDecibels = -30;
    }

    _initAnalysisBuses() {
        if (!this.ctx) return;

        this.analysisOwnShipGain = this.ctx.createGain();
        this.analysisContactsGain = this.ctx.createGain();
        this.analysisSelectedGain = this.ctx.createGain();
        this.analysisMixGain = this.ctx.createGain();

        this.analysisOwnShipGain.gain.value = 1.0;
        this.analysisContactsGain.gain.value = 1.0;
        this.analysisSelectedGain.gain.value = 1.0;
        this.analysisMixGain.gain.value = 1.0;

        this.analysisCompositeAnalyser = this.ctx.createAnalyser();
        this.analysisSelectedAnalyser = this.ctx.createAnalyser();
        this._configureAnalyser(this.analysisCompositeAnalyser);
        this._configureAnalyser(this.analysisSelectedAnalyser);

        this.analysisCompositeDataArray = new Uint8Array(this.analysisCompositeAnalyser.frequencyBinCount);
        this.analysisSelectedDataArray = new Uint8Array(this.analysisSelectedAnalyser.frequencyBinCount);
        this.analysisCompositeTimeDomainArray = new Float32Array(this.analysisCompositeAnalyser.fftSize);
        this.analysisSelectedTimeDomainArray = new Float32Array(this.analysisSelectedAnalyser.fftSize);

        // Composite bus: own-ship + all contacts (used when no target is selected).
        this.analysisContactsGain.connect(this.analysisMixGain);
        this.analysisOwnShipGain.connect(this.analysisMixGain);
        this.analysisMixGain.connect(this.analysisCompositeAnalyser);

        // Selected bus: contacts only, own-ship excluded.
        // The focus system boosts the selected target and ducks all others,
        // so this bus is dominated by the focused contact when one is active.
        this.analysisContactsGain.connect(this.analysisSelectedGain);
        this.analysisSelectedGain.connect(this.analysisSelectedAnalyser);
    }

    async init() {
        if (this.ctx) return;

        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();

            this.analyser = this.ctx.createAnalyser();
            this._configureAnalyser(this.analyser);
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.timeDomainArray = new Float32Array(this.analyser.fftSize);

            this.outputGain = this.ctx.createGain();
            const now = this.ctx.currentTime;
            this.outputGain.gain.setValueAtTime(0, now);
            this.outputGain.gain.linearRampToValueAtTime(0, now + this.startupFadeDelay);
            this.outputGain.gain.linearRampToValueAtTime(1, now + this.startupFadeDelay + this.startupFadeDuration);
            this.outputGain.connect(this.analyser);
            this.analyser.connect(this.ctx.destination);

            // Initialize Wasm Manager with existing context and connect to analyser
            await this.wasmManager.init({
                ctx: this.ctx,
                outputNode: this.outputGain,
                maxVoices: 32 // Increase to support many targets
            });

            this._initAnalysisBuses();

            await this.analysisWasmManager.init({
                ctx: this.ctx,
                outputNode: this.analysisContactsGain,
                maxVoices: 32,
                autoAddVoice: false
            });

            await this.analysisOwnShipWasmManager.init({
                ctx: this.ctx,
                outputNode: this.analysisOwnShipGain,
                maxVoices: 2,
                autoAddVoice: true
            });

            this.ownVoiceId = this.wasmManager.defaultVoiceId;
            this.analysisOwnShipVoiceId = this.analysisOwnShipWasmManager.defaultVoiceId;
            this.ownCurrentGain = this.ownBaseGain;
            this.currentAnalysisOwnShipGain = this.analysisOwnShipSettings.baseGain;
            this.lastOwnGainUpdateTime = this.ctx.currentTime;
            this.wasmManager.setGain(this.ownBaseGain, this.ownVoiceId);
            this.wasmManager.setEngineMix(1.0, this.ownVoiceId);
            this.wasmManager.setCavMix(0.3, this.ownVoiceId);
            this.wasmManager.setBioMix(0.0, this.ownVoiceId); // Own ship shouldn't chirp like a dolphin
            this.wasmManager.setBlades(this.ownShipBladeCount, this.ownVoiceId);
            this.analysisOwnShipWasmManager.setGain(this.currentAnalysisOwnShipGain, this.analysisOwnShipVoiceId);
            this.analysisOwnShipWasmManager.setEngineMix(1.0, this.analysisOwnShipVoiceId);
            this.analysisOwnShipWasmManager.setCavMix(0.3, this.analysisOwnShipVoiceId);
            this.analysisOwnShipWasmManager.setBioMix(0.0, this.analysisOwnShipVoiceId);
            this.analysisOwnShipWasmManager.setBlades(this.ownShipBladeCount, this.analysisOwnShipVoiceId);
            this.analysisOwnShipWasmManager.setRpm(this.ownShipRpm, this.analysisOwnShipVoiceId);

        } catch (e) {
            console.error('Audio initialization failed:', e);
        }
    }

    setRpm(value) {
        if (this.wasmManager && this.wasmManager.ready) {
            this.wasmManager.setRpm(value, this.ownVoiceId);
        }
        this.ownShipRpm = Number.isFinite(value) ? Math.max(0, value) : 0;
        if (this.analysisOwnShipWasmManager && this.analysisOwnShipWasmManager.ready && this.analysisOwnShipVoiceId >= 0) {
            this.analysisOwnShipWasmManager.setRpm(this.ownShipRpm, this.analysisOwnShipVoiceId);
        }
    }

    getOwnShipSignature() {
        const rpm = Number.isFinite(this.ownShipRpm) ? this.ownShipRpm : 0;
        const bladeCount = Number.isFinite(this.ownShipBladeCount) ? this.ownShipBladeCount : 0;
        return {
            rpm,
            bladeCount,
            bpfHz: rpm > 0 && bladeCount > 0 ? (rpm / 60) * bladeCount : 0
        };
    }

    setComputeProcessor(processor) {
        this.computeProcessor = processor || null;
    }

    async createTargetAudio(target) {
        if (!this.ctx || !this.wasmManager.ready) return;
        const targetId = target.id;
        const type = target.type || 'SHIP';
        const now = this.ctx.currentTime;

        // Request a new voice from speaker path Wasm.
        const speakerVoiceId = await this.wasmManager.addVoice();
        if (speakerVoiceId === -1) {
            console.warn('Max audio voices reached');
            return;
        }

        // Mirror target voice into the analysis path.
        let analysisVoiceId = -1;
        if (this.analysisWasmManager?.ready) {
            analysisVoiceId = await this.analysisWasmManager.addVoice();
            if (analysisVoiceId === -1) {
                console.warn('Max analysis voices reached');
            }
        }

        // Configure voice based on target
        const initialGain = 0.01;
        this.wasmManager.setGain(initialGain, speakerVoiceId);
        this.wasmManager.setBlades(target.bladeCount || 5, speakerVoiceId);
        this.wasmManager.setRpm(target.rpm || 0, speakerVoiceId);
        let baseEngineMix = 1.0;
        let baseCavMix = 0.6;
        let baseBioMix = 0.0;
        let baseBioType = 0; // Chirp
        let baseBioRate = 0.35;

        if (type === 'BIOLOGICAL') {
            baseEngineMix = 0.0;
            baseCavMix = 0.0;
            baseBioMix = 1.0;
            baseBioType = 1; // Snapping shrimp (Phase 1)
            baseBioRate = 0.8;
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

        if (typeof target.bioType === 'string') {
            const mappedBioType = BIO_TYPE_TO_PARAM[target.bioType.trim().toLowerCase()];
            if (Number.isInteger(mappedBioType)) {
                baseBioType = mappedBioType;
            }
        }
        if (Number.isFinite(target.bioRate)) {
            baseBioRate = Math.max(0, Math.min(1, target.bioRate));
        }

        this.wasmManager.setEngineMix(baseEngineMix, speakerVoiceId);
        this.wasmManager.setCavMix(baseCavMix, speakerVoiceId);
        this.wasmManager.setBioMix(baseBioMix, speakerVoiceId);
        this.wasmManager.setBioType(baseBioType, speakerVoiceId);
        this.wasmManager.setBioRate(baseBioRate, speakerVoiceId);

        if (analysisVoiceId >= 0) {
            this.analysisWasmManager.setGain(initialGain, analysisVoiceId);
            this.analysisWasmManager.setBlades(target.bladeCount || 5, analysisVoiceId);
            this.analysisWasmManager.setRpm(target.rpm || 0, analysisVoiceId);
            this.analysisWasmManager.setEngineMix(baseEngineMix, analysisVoiceId);
            this.analysisWasmManager.setCavMix(baseCavMix, analysisVoiceId);
            this.analysisWasmManager.setBioMix(baseBioMix, analysisVoiceId);
            this.analysisWasmManager.setBioType(baseBioType, analysisVoiceId);
            this.analysisWasmManager.setBioRate(baseBioRate, analysisVoiceId);
        }

        this.targetNodes.set(targetId, {
            voiceId: speakerVoiceId,
            analysisVoiceId,
            type,
            baseEngineMix,
            baseCavMix,
            baseBioMix,
            currentGain: initialGain,
            currentAnalysisGain: initialGain,
            currentEngineMix: baseEngineMix,
            currentCavMix: baseCavMix,
            currentBioMix: baseBioMix,
            currentAnalysisEngineMix: baseEngineMix,
            currentAnalysisCavMix: baseCavMix,
            currentAnalysisBioMix: baseBioMix,
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
            const baseGain = Math.max(cfg.gainFloor, (cfg.distanceMax - distance) / cfg.distanceScale) * cfg.baseDistanceGainMultiplier;
            let targetGain = baseGain;

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

            if (node.analysisVoiceId >= 0 && this.analysisWasmManager?.ready) {
                const acfg = this.analysisFocusSettings;
                const analysisTargetGain = hasFocus
                    ? (isFocused ? baseGain * acfg.focusedTargetBoost : baseGain * acfg.backgroundDuck)
                    : baseGain;
                const analysisRising = analysisTargetGain > node.currentAnalysisGain;
                const analysisTau = analysisRising ? acfg.gainAttack : acfg.gainRelease;
                const analysisAlpha = 1 - Math.exp(-dt / Math.max(0.001, analysisTau));
                node.currentAnalysisGain += (analysisTargetGain - node.currentAnalysisGain) * analysisAlpha;
                this.analysisWasmManager.setGain(node.currentAnalysisGain, node.analysisVoiceId);

                const analysisEngineFactor = isFocused
                    ? acfg.focusedEngineFactor
                    : hasFocus
                        ? acfg.backgroundEngineFactor
                        : 1.0;
                const analysisCavFactor = isFocused
                    ? acfg.focusedCavFactor
                    : hasFocus
                        ? acfg.backgroundCavFactor
                        : 1.0;
                const analysisBioFactor = isFocused
                    ? acfg.focusedBioFactor
                    : hasFocus
                        ? acfg.backgroundBioFactor
                        : 1.0;

                const analysisTargetEngineMix = Math.min(1, Math.max(0, node.baseEngineMix * analysisEngineFactor));
                const analysisTargetCavMix = Math.min(1, Math.max(0, node.baseCavMix * analysisCavFactor));
                const analysisTargetBioMix = Math.min(1, Math.max(0, node.baseBioMix * analysisBioFactor));
                const analysisMixRising = analysisTargetEngineMix > node.currentAnalysisEngineMix ||
                    analysisTargetCavMix > node.currentAnalysisCavMix ||
                    analysisTargetBioMix > node.currentAnalysisBioMix;
                const analysisMixTau = analysisMixRising ? acfg.gainAttack : acfg.gainRelease;
                const analysisMixAlpha = 1 - Math.exp(-dt / Math.max(0.001, analysisMixTau));

                node.currentAnalysisEngineMix += (analysisTargetEngineMix - node.currentAnalysisEngineMix) * analysisMixAlpha;
                node.currentAnalysisCavMix += (analysisTargetCavMix - node.currentAnalysisCavMix) * analysisMixAlpha;
                node.currentAnalysisBioMix += (analysisTargetBioMix - node.currentAnalysisBioMix) * analysisMixAlpha;

                this.analysisWasmManager.setEngineMix(node.currentAnalysisEngineMix, node.analysisVoiceId);
                this.analysisWasmManager.setCavMix(node.currentAnalysisCavMix, node.analysisVoiceId);
                this.analysisWasmManager.setBioMix(node.currentAnalysisBioMix, node.analysisVoiceId);
            }
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

        if (this.analysisOwnShipWasmManager && this.analysisOwnShipWasmManager.ready && this.analysisOwnShipVoiceId >= 0) {
            const analysisTargetGain = focusActive
                ? this.analysisOwnShipSettings.baseGain * this.analysisOwnShipSettings.focusedDuck
                : this.analysisOwnShipSettings.baseGain;
            const analysisRising = analysisTargetGain > this.currentAnalysisOwnShipGain;
            const analysisTau = analysisRising ? this.analysisOwnShipSettings.attack : this.analysisOwnShipSettings.release;
            const analysisAlpha = 1 - Math.exp(-dt / Math.max(0.001, analysisTau));
            this.currentAnalysisOwnShipGain += (analysisTargetGain - this.currentAnalysisOwnShipGain) * analysisAlpha;
            this.analysisOwnShipWasmManager.setGain(this.currentAnalysisOwnShipGain, this.analysisOwnShipVoiceId);
        }
    }

    createPingTap(vol = 0.5, startFreq = 1200, endFreq = 900) {
        if (!this.ctx) return;
        const time = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();

        osc.frequency.setValueAtTime(startFreq, time);
        osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.1);

        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(vol, time + 0.02);
        g.gain.linearRampToValueAtTime(0, time + 1.2);

        osc.connect(g);
        g.connect(this.outputGain);

        // Feed into analysis bus so the ping appears on the waterfall
        if (this.analysisMixGain) {
            g.connect(this.analysisMixGain);
        }

        osc.start(time);
        osc.stop(time + 1.3);
    }

    createPingEcho(vol = 0.3) {
        if (!this.ctx) return;
        const time = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();

        // Sharper sweep for echo: 1100Hz -> 850Hz
        osc.frequency.setValueAtTime(1100, time);
        osc.frequency.exponentialRampToValueAtTime(850, time + 0.08);

        g.gain.setValueAtTime(0, time);
        g.gain.linearRampToValueAtTime(vol, time + 0.01);
        g.gain.linearRampToValueAtTime(0, time + 0.6);

        osc.connect(g);
        g.connect(this.outputGain);

        // Feed into analysis bus so the echo appears on the waterfall
        if (this.analysisMixGain) {
            g.connect(this.analysisMixGain);
        }

        osc.start(time);
        osc.stop(time + 0.7);
    }

    getAnalysisFrequencyData(mode = 'composite') {
        const useSelected = mode === 'selected';
        const analyser = useSelected ? this.analysisSelectedAnalyser : this.analysisCompositeAnalyser;
        const buffer = useSelected ? this.analysisSelectedDataArray : this.analysisCompositeDataArray;
        if (analyser && buffer) {
            analyser.getByteFrequencyData(buffer);
            return buffer;
        }
        return new Uint8Array(0);
    }

    getAnalysisTimeDomainData(mode = 'composite') {
        const useSelected = mode === 'selected';
        const analyser = useSelected ? this.analysisSelectedAnalyser : this.analysisCompositeAnalyser;
        const buffer = useSelected ? this.analysisSelectedTimeDomainArray : this.analysisCompositeTimeDomainArray;
        if (analyser && buffer) {
            analyser.getFloatTimeDomainData(buffer);
            return buffer;
        }
        return null;
    }

    getFrequencyData() {
        return this.getAnalysisFrequencyData('composite');
    }

    getContext() {
        return this.ctx;
    }

    getTimeDomainData() {
        return this.getAnalysisTimeDomainData('composite');
    }

    dispose() {
        if (this.wasmManager) {
            this.wasmManager.dispose();
        }
        if (this.analysisWasmManager) {
            this.analysisWasmManager.dispose();
        }
        if (this.analysisOwnShipWasmManager) {
            this.analysisOwnShipWasmManager.dispose();
        }
        if (this.ctx) {
            this.bioTimeouts.forEach(id => clearTimeout(id));
            this.bioTimeouts.clear();

            this.targetNodes.clear();

            if (this.analysisOwnShipGain) {
                this.analysisOwnShipGain.disconnect();
                this.analysisOwnShipGain = null;
            }
            if (this.analysisContactsGain) {
                this.analysisContactsGain.disconnect();
                this.analysisContactsGain = null;
            }
            if (this.analysisSelectedGain) {
                this.analysisSelectedGain.disconnect();
                this.analysisSelectedGain = null;
            }
            if (this.analysisMixGain) {
                this.analysisMixGain.disconnect();
                this.analysisMixGain = null;
            }
            if (this.analysisCompositeAnalyser) {
                this.analysisCompositeAnalyser.disconnect();
                this.analysisCompositeAnalyser = null;
            }
            if (this.analysisSelectedAnalyser) {
                this.analysisSelectedAnalyser.disconnect();
                this.analysisSelectedAnalyser = null;
            }

            this.analysisCompositeDataArray = null;
            this.analysisSelectedDataArray = null;
            this.analysisCompositeTimeDomainArray = null;
            this.analysisSelectedTimeDomainArray = null;

            if (this.analyser) {
                this.analyser.disconnect();
                this.analyser = null;
            }
            if (this.outputGain) {
                this.outputGain.disconnect();
                this.outputGain = null;
            }

            this.dataArray = null;
            this.timeDomainArray = null;
            this.computeProcessor = null;
            this.analysisOwnShipVoiceId = -1;
            this.ctx.close();
            this.ctx = null;
        }
    }
}
