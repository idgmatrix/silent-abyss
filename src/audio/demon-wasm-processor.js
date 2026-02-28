import initDspCore, { compute_demon_spectrum } from './dsp-core/pkg/dsp_core.js';

export class DemonWasmProcessor {
    constructor() {
        this.ready = false;
        this.failed = false;
        this._initPromise = null;
    }

    async init() {
        if (this.ready) return true;
        if (this.failed) return false;
        if (this._initPromise) return this._initPromise;

        this._initPromise = initDspCore()
            .then(() => {
                this.ready = true;
                return true;
            })
            .catch((error) => {
                this.failed = true;
                console.warn('DEMON wasm init failed, falling back to JS:', error);
                return false;
            });

        return this._initPromise;
    }

    computeSpectrum(inputSamples, sampleRate, maxFreqHz, config = {}) {
        if (!this.ready) return null;
        if (!(inputSamples instanceof Float32Array)) return null;
        if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
        if (!Number.isFinite(maxFreqHz) || maxFreqHz < 1) return null;

        const inputBandLowHz = Number.isFinite(config.inputBandLowHz) ? config.inputBandLowHz : 20;
        const inputBandHighHz = Number.isFinite(config.inputBandHighHz) ? config.inputBandHighHz : 1800;
        const envelopeHpHz = Number.isFinite(config.envelopeHpHz) ? config.envelopeHpHz : 1.0;
        const decimatedRateTargetHz = Number.isFinite(config.decimatedRateTargetHz)
            ? config.decimatedRateTargetHz
            : 500;

        try {
            return compute_demon_spectrum(
                inputSamples,
                sampleRate,
                Math.floor(maxFreqHz),
                inputBandLowHz,
                inputBandHighHz,
                envelopeHpHz,
                decimatedRateTargetHz
            );
        } catch (error) {
            console.warn('DEMON wasm compute failed, using JS fallback:', error);
            return null;
        }
    }
}

