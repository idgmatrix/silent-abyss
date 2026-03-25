import { readFileSync } from 'node:fs';
import { SonarVisuals } from '../../src/sonar-visuals.js';
import {
    DspGraph,
    compute_demon_spectrum,
    initSync
} from '../../src/audio/dsp-core/pkg/dsp_core.js';

const PARAM_RPM = 0;
const PARAM_BLADES = 1;
const PARAM_GAIN = 2;
const PARAM_ENGINE_MIX = 3;
const PARAM_CAV_MIX = 4;
const PARAM_BIO_MIX = 5;
const PARAM_SHAFT_RATE = 8;
const PARAM_LOAD = 9;
const PARAM_RPM_JITTER = 10;
const PARAM_CLASS_PROFILE = 11;
const PARAM_CAVITATION_LEVEL = 12;

let wasmReady = false;

export function ensureDspCoreReady() {
    if (wasmReady) return;
    const wasmBytes = readFileSync(
        new URL('../../src/audio/dsp-core/pkg/dsp_core_bg.wasm', import.meta.url)
    );
    initSync({ module: wasmBytes });
    wasmReady = true;
}

export function createNoopContext() {
    return {
        fillStyle: '#000',
        strokeStyle: '#000',
        lineWidth: 1,
        font: '10px monospace',
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fillRect() {},
        fillText() {},
        save() {},
        restore() {},
        setLineDash() {}
    };
}

export function createDemonHarness() {
    const visuals = new SonarVisuals();
    visuals.dCanvas = { width: 420, height: 180 };
    visuals.dCtx = createNoopContext();
    visuals.setDemonResponsiveness(1.0);
    visuals.setDemonFocusWidth(1.0);
    return visuals;
}

export function createVoiceFrameRunner({
    sampleRate = 4096,
    frameSize = 1024,
    rpm = 180,
    bladeCount = 5,
    shaftRate = rpm / 60,
    gain = 1.15,
    engineMix = 1.0,
    cavMix = 0.55,
    bioMix = 0.0,
    load = 0.62,
    rpmJitter = 0.08,
    classProfile = 2,
    cavitationLevel = 0.18
} = {}) {
    ensureDspCoreReady();

    const graph = new DspGraph(sampleRate, frameSize, 1);
    const voiceId = graph.add_voice();
    graph.set_param(voiceId, PARAM_RPM, rpm);
    graph.set_param(voiceId, PARAM_BLADES, bladeCount);
    graph.set_param(voiceId, PARAM_GAIN, gain);
    graph.set_param(voiceId, PARAM_ENGINE_MIX, engineMix);
    graph.set_param(voiceId, PARAM_CAV_MIX, cavMix);
    graph.set_param(voiceId, PARAM_BIO_MIX, bioMix);
    graph.set_param(voiceId, PARAM_SHAFT_RATE, shaftRate);
    graph.set_param(voiceId, PARAM_LOAD, load);
    graph.set_param(voiceId, PARAM_RPM_JITTER, rpmJitter);
    graph.set_param(voiceId, PARAM_CLASS_PROFILE, classProfile);
    graph.set_param(voiceId, PARAM_CAVITATION_LEVEL, cavitationLevel);

    return () => {
        graph.process(frameSize);
        return graph.output_copy();
    };
}

export function renderVoiceSamples(config = {}) {
    const { frames = 96, frameSize = 1024 } = config;
    const nextFrame = createVoiceFrameRunner(config);
    const samples = new Float32Array(frames * frameSize);

    for (let frame = 0; frame < frames; frame++) {
        const out = nextFrame();
        samples.set(out, frame * frameSize);
    }

    return samples;
}

export function runSelectedTargetDemonLock({
    target,
    synthConfig,
    frames = 120,
    sampleRate = 4096
}) {
    const visuals = createDemonHarness();
    const nextFrame = createVoiceFrameRunner(synthConfig);
    let lockFrame = null;

    for (let frame = 0; frame < frames; frame++) {
        const buf = nextFrame();
        visuals._updateDemonSpectrum(buf, sampleRate, target);
        visuals.drawDEMON(new Uint8Array(128), target.rpm, target, sampleRate);
        if (visuals._demonTrackState === 'LOCKED' && lockFrame === null) {
            lockFrame = frame + 1;
        }
    }

    return {
        lockFrame,
        lock: visuals._demonLocks.get(target.id) || null,
        signalQuality: visuals._demonSignalQuality,
        harmonicScore: visuals._demonDisplayHarmonicScore
    };
}

export function computeDemonMetrics(samples, sampleRate, config = {}) {
    ensureDspCoreReady();

    const maxFreqHz = config.maxFreqHz ?? 120;
    const spectrum = compute_demon_spectrum(
        samples,
        sampleRate,
        Math.floor(maxFreqHz),
        config.inputBandLowHz ?? 20,
        config.inputBandHighHz ?? 1800,
        config.envelopeHpHz ?? 1.0,
        config.decimatedRateTargetHz ?? 500
    );

    let peakHz = 0;
    let peakValue = 0;
    for (let hz = 1; hz < spectrum.length; hz++) {
        if (spectrum[hz] > peakValue) {
            peakValue = spectrum[hz];
            peakHz = hz;
        }
    }

    return {
        spectrum,
        peakHz,
        peakValue
    };
}

export function computeLofarSpectrum(samples, sampleRate, options = {}) {
    const fftSize = options.fftSize ?? 8192;
    const maxFreqHz = options.maxFreqHz ?? 256;
    const start = Math.max(0, samples.length - fftSize);
    const frame = samples.subarray(start, start + fftSize);
    const out = new Float32Array(maxFreqHz + 1);
    const denom = Math.max(1, frame.length - 1);

    for (let hz = 1; hz <= maxFreqHz; hz++) {
        let re = 0;
        let im = 0;
        const omega = (2 * Math.PI * hz) / sampleRate;
        for (let i = 0; i < frame.length; i++) {
            const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
            const value = frame[i] * hann;
            const angle = omega * i;
            re += value * Math.cos(angle);
            im -= value * Math.sin(angle);
        }
        out[hz] = Math.hypot(re, im) / frame.length;
    }

    return out;
}

export function measurePeakNearHz(spectrum, targetHz, toleranceHz = 1) {
    const lo = Math.max(1, Math.floor(targetHz - toleranceHz));
    const hi = Math.min(spectrum.length - 1, Math.ceil(targetHz + toleranceHz));
    let bestHz = lo;
    let bestValue = 0;

    for (let hz = lo; hz <= hi; hz++) {
        if (spectrum[hz] > bestValue) {
            bestValue = spectrum[hz];
            bestHz = hz;
        }
    }

    return { hz: bestHz, value: bestValue };
}

export function measureLocalContrast(spectrum, targetHz, shoulderWidthHz = 3) {
    const peak = measurePeakNearHz(spectrum, targetHz, 1);
    let sum = 0;
    let count = 0;
    for (let hz = Math.max(1, targetHz - shoulderWidthHz); hz <= Math.min(spectrum.length - 1, targetHz + shoulderWidthHz); hz++) {
        if (Math.abs(hz - peak.hz) <= 1) continue;
        sum += spectrum[hz];
        count++;
    }
    const baseline = count > 0 ? sum / count : 1e-6;
    return {
        hz: peak.hz,
        value: peak.value,
        baseline,
        ratio: peak.value / Math.max(1e-6, baseline)
    };
}

export function countVisibleHarmonics(spectrum, fundamentalHz, harmonicCount = 4, minContrast = 1.8) {
    let visible = 0;
    for (let harmonic = 1; harmonic <= harmonicCount; harmonic++) {
        const contrast = measureLocalContrast(spectrum, Math.round(fundamentalHz * harmonic), 3);
        if (contrast.ratio >= minContrast) {
            visible++;
        }
    }
    return visible;
}

export function measureBandEnergy(spectrum, startHz, endHz) {
    const lo = Math.max(1, Math.floor(startHz));
    const hi = Math.min(spectrum.length - 1, Math.floor(endHz));
    let sum = 0;
    let count = 0;
    for (let hz = lo; hz <= hi; hz++) {
        sum += spectrum[hz];
        count++;
    }
    return count > 0 ? sum / count : 0;
}

export function measureSpectralSlope(spectrum, startHz, endHz) {
    const points = [];
    for (let hz = Math.max(1, Math.floor(startHz)); hz <= Math.min(spectrum.length - 1, Math.floor(endHz)); hz++) {
        const magnitude = spectrum[hz];
        if (magnitude <= 0) continue;
        points.push({
            x: Math.log(hz),
            y: Math.log(magnitude)
        });
    }

    if (points.length < 2) return 0;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (const point of points) {
        sumX += point.x;
        sumY += point.y;
        sumXY += point.x * point.y;
        sumXX += point.x * point.x;
    }

    const n = points.length;
    const numerator = n * sumXY - sumX * sumY;
    const denominator = n * sumXX - sumX * sumX;
    return Math.abs(denominator) > 1e-9 ? numerator / denominator : 0;
}
