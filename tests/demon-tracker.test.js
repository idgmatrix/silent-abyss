import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SonarVisuals } from '../src/sonar-visuals.js';
import { DspGraph, compute_demon_spectrum, initSync } from '../src/audio/dsp-core/pkg/dsp_core.js';

function createNoopContext() {
    const ctx = {
        fillStyle: '#000',
        strokeStyle: '#000',
        lineWidth: 1,
        font: '10px monospace',
        textAlign: 'left',
        textBaseline: 'alphabetic',
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fillRect() {},
        fillText() {},
        createImageData(width, height) {
            return { data: new Uint8ClampedArray(width * height * 4), width, height };
        },
        putImageData() {},
        save() {},
        restore() {},
        setLineDash() {},
        measureText(text) {
            return { width: String(text || '').length * 6 };
        }
    };
    return ctx;
}

function createDemonHarness() {
    const visuals = new SonarVisuals();
    visuals.dCanvas = { width: 420, height: 180 };
    visuals.dCtx = createNoopContext();
    visuals.setDemonResponsiveness(1.0);
    visuals.setDemonFocusWidth(1.0);
    return visuals;
}

function runDemonFrames({
    visuals,
    selectedTarget,
    sampleRate = 4096,
    frames = 120,
    frameSize = 1024,
    bpfHz,
    carrierHz = 420,
    noise = 0.002
}) {
    let phaseCarrier = 0;
    let phaseMod = 0;
    const dt = 1 / sampleRate;

    let lockFrame = null;
    for (let frame = 0; frame < frames; frame++) {
        const buf = new Float32Array(frameSize);
        for (let i = 0; i < frameSize; i++) {
            const carrier = Math.sin(phaseCarrier) + 0.35 * Math.sin(phaseCarrier * 1.57);
            // Gated blade-rate modulation yields clear harmonic comb lines.
            const envelope = Math.sin(phaseMod) >= 0 ? 1.6 : 0.05;
            const n = noise * Math.sin(phaseCarrier * 0.23);
            buf[i] = envelope * carrier + n;
            phaseCarrier += 2 * Math.PI * carrierHz * dt;
            phaseMod += 2 * Math.PI * bpfHz * dt;
        }

        visuals._updateDemonSpectrum(buf, sampleRate, selectedTarget);
        visuals.drawDEMON(new Uint8Array(128), selectedTarget?.rpm ?? 0, selectedTarget, sampleRate);

        if (visuals._demonTrackState === 'LOCKED' && lockFrame === null) {
            lockFrame = frame + 1;
        }
    }

    return { lockFrame };
}

let wasmReady = false;

function ensureDspCoreReady() {
    if (wasmReady) return;
    const wasmBytes = readFileSync(new URL('../src/audio/dsp-core/pkg/dsp_core_bg.wasm', import.meta.url));
    initSync({ module: wasmBytes });
    wasmReady = true;
}

function createRealSynthFrameRunner({
    sampleRate = 4096,
    frameSize = 1024,
    rpm = 216,
    bladeCount = 5,
    shaftRate = rpm / 60,
    load = 0.62,
    rpmJitter = 0.09,
    classProfile = 2,
    cavitationLevel = 0.45
} = {}) {
    ensureDspCoreReady();

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

    const graph = new DspGraph(sampleRate, frameSize, 1);
    const voiceId = graph.add_voice();
    graph.set_param(voiceId, PARAM_RPM, rpm);
    graph.set_param(voiceId, PARAM_BLADES, bladeCount);
    graph.set_param(voiceId, PARAM_GAIN, 1.15);
    graph.set_param(voiceId, PARAM_ENGINE_MIX, 1.0);
    graph.set_param(voiceId, PARAM_CAV_MIX, 0.55);
    graph.set_param(voiceId, PARAM_BIO_MIX, 0.0);
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

function measureMeanAbsDelta(samples) {
    let sum = 0;
    for (let i = 1; i < samples.length; i++) {
        sum += Math.abs(samples[i] - samples[i - 1]);
    }
    return sum / Math.max(1, samples.length - 1);
}

function measurePeakNearHz(spectrum, targetHz, toleranceHz = 2) {
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

function measureLocalContrast(spectrum, targetHz, shoulderWidthHz = 3) {
    const peak = measurePeakNearHz(spectrum, targetHz, 1);
    let sum = 0;
    let count = 0;
    for (let hz = Math.max(1, targetHz - shoulderWidthHz); hz <= Math.min(spectrum.length - 1, targetHz + shoulderWidthHz); hz++) {
        if (Math.abs(hz - peak.hz) <= 1) continue;
        sum += spectrum[hz];
        count++;
    }
    const baseline = count > 0 ? sum / count : 1e-6;
    return peak.value / Math.max(1e-6, baseline);
}

function renderVoiceSamples(config = {}) {
    const { frames = 96, frameSize = 1024 } = config;
    const nextFrame = createRealSynthFrameRunner(config);
    const out = new Float32Array(frames * frameSize);
    for (let frame = 0; frame < frames; frame++) {
        out.set(nextFrame(), frame * frameSize);
    }
    return out;
}

function runRealSynthDemonScenario({
    selectedTarget,
    synthConfig,
    frames = 140,
    sampleRate = 4096
}) {
    const visuals = createDemonHarness();
    const nextFrame = createRealSynthFrameRunner(synthConfig);
    let lockFrame = null;
    let meanAbsDelta = 0;

    for (let frame = 0; frame < frames; frame++) {
        const buf = nextFrame();
        meanAbsDelta += measureMeanAbsDelta(buf);
        visuals._updateDemonSpectrum(buf, sampleRate, selectedTarget);
        visuals.drawDEMON(new Uint8Array(128), selectedTarget.rpm, selectedTarget, sampleRate);
        if (visuals._demonTrackState === 'LOCKED' && lockFrame === null) {
            lockFrame = frame + 1;
        }
    }

    const lock = visuals._demonLocks.get(selectedTarget.id);
    return {
        lockFrame,
        lock,
        meanAbsDelta: meanAbsDelta / frames,
        signalQuality: visuals._demonSignalQuality
    };
}

describe('DEMON lock tracker', () => {
    it('acquires lock near expected BPF in bounded frames', { timeout: 20000 }, () => {
        const visuals = createDemonHarness();
        const selectedTarget = {
            id: 'target-01',
            type: 'SHIP',
            rpm: 216,
            bladeCount: 5,
            classification: null
        };

        const expectedBpf = (selectedTarget.rpm / 60) * selectedTarget.bladeCount; // 18Hz
        const { lockFrame } = runDemonFrames({
            visuals,
            selectedTarget,
            bpfHz: expectedBpf,
            frames: 120
        });

        const lock = visuals._demonLocks.get(selectedTarget.id);
        expect(lockFrame).not.toBeNull();
        expect(lockFrame).toBeLessThanOrEqual(120);
        expect(lock).toBeDefined();
        expect(lock.state).toBe('LOCKED');
        expect(lock.confidence).toBeGreaterThan(0.6);
        expect(Math.abs(lock.bpfEstimateHz - expectedBpf)).toBeLessThanOrEqual(expectedBpf * 0.1);
    });

    it('acquires lock from real wasm propulsion synthesis', { timeout: 20000 }, () => {
        const selectedTarget = {
            id: 'target-real-01',
            type: 'SHIP',
            rpm: 216,
            bladeCount: 5,
            shaftRate: 216 / 60,
            classification: null
        };
        const expectedBpf = (selectedTarget.rpm / 60) * selectedTarget.bladeCount;
        const { lockFrame, lock } = runRealSynthDemonScenario({
            selectedTarget,
            synthConfig: {
                rpm: selectedTarget.rpm,
                bladeCount: selectedTarget.bladeCount,
                shaftRate: selectedTarget.shaftRate,
                load: 0.66,
                rpmJitter: 0.07,
                classProfile: 2,
                cavitationLevel: 0.45
            }
        });
        expect(lockFrame).not.toBeNull();
        expect(lockFrame).toBeLessThanOrEqual(140);
        expect(lock).toBeDefined();
        expect(lock.state).toBe('LOCKED');
        expect(lock.confidence).toBeGreaterThan(0.5);
        expect(Math.abs(lock.bpfEstimateHz - expectedBpf)).toBeLessThanOrEqual(expectedBpf * 0.12);
    });

    it('keeps lock state invariant when DEMON is redrawn without new analysis', { timeout: 20000 }, () => {
        const selectedTarget = {
            id: 'target-frame-invariant',
            type: 'SHIP',
            rpm: 216,
            bladeCount: 5,
            classification: null
        };
        const sampleRate = 4096;
        const frameSize = 1024;
        const expectedBpf = (selectedTarget.rpm / 60) * selectedTarget.bladeCount;

        const runScenario = (extraDrawsPerFrame) => {
            const visuals = createDemonHarness();
            let phaseCarrier = 0;
            let phaseMod = 0;
            const dt = 1 / sampleRate;

            for (let frame = 0; frame < 140; frame++) {
                const buf = new Float32Array(frameSize);
                for (let i = 0; i < frameSize; i++) {
                    const carrier = Math.sin(phaseCarrier) + 0.35 * Math.sin(phaseCarrier * 1.57);
                    const envelope = Math.sin(phaseMod) >= 0 ? 1.6 : 0.05;
                    const n = 0.002 * Math.sin(phaseCarrier * 0.23);
                    buf[i] = envelope * carrier + n;
                    phaseCarrier += 2 * Math.PI * 420 * dt;
                    phaseMod += 2 * Math.PI * expectedBpf * dt;
                }

                visuals._updateDemonSpectrum(buf, sampleRate, selectedTarget);
                visuals.drawDEMON(new Uint8Array(128), selectedTarget.rpm, selectedTarget, sampleRate);
                for (let i = 0; i < extraDrawsPerFrame; i++) {
                    visuals.drawDEMON(new Uint8Array(128), selectedTarget.rpm, selectedTarget, sampleRate);
                }
            }

            return visuals._demonLocks.get(selectedTarget.id);
        };

        const baseline = runScenario(0);
        const redrawHeavy = runScenario(4);

        expect(baseline).toBeDefined();
        expect(redrawHeavy).toBeDefined();
        expect(baseline.state).toBe('LOCKED');
        expect(redrawHeavy.state).toBe('LOCKED');
        expect(Math.abs(baseline.confidence - redrawHeavy.confidence)).toBeLessThanOrEqual(0.02);
        expect(Math.abs(baseline.bpfEstimateHz - redrawHeavy.bpfEstimateHz)).toBeLessThanOrEqual(0.2);
    });

    it('changes synth texture across cavitation regimes while preserving DEMON lock', { timeout: 20000 }, () => {
        const selectedTarget = {
            id: 'target-real-cav',
            type: 'SHIP',
            rpm: 216,
            bladeCount: 5,
            shaftRate: 216 / 60,
            classification: null
        };
        const baseConfig = {
            rpm: selectedTarget.rpm,
            bladeCount: selectedTarget.bladeCount,
            shaftRate: selectedTarget.shaftRate,
            load: 0.64,
            rpmJitter: 0.07,
            classProfile: 2
        };

        const low = runRealSynthDemonScenario({
            selectedTarget,
            frames: 110,
            synthConfig: {
                ...baseConfig,
                cavitationLevel: 0.08
            }
        });
        const high = runRealSynthDemonScenario({
            selectedTarget: { ...selectedTarget, id: 'target-real-cav-high' },
            frames: 110,
            synthConfig: {
                ...baseConfig,
                cavitationLevel: 0.92
            }
        });

        expect(low.lockFrame).not.toBeNull();
        expect(high.lockFrame).not.toBeNull();
        expect(low.lock?.state).toBe('LOCKED');
        expect(high.lock?.state).toBe('LOCKED');
        expect(high.meanAbsDelta).toBeGreaterThan(low.meanAbsDelta * 1.12);
        expect(Math.abs(high.signalQuality - low.signalQuality)).toBeGreaterThan(0.001);
    });

    it('shows blade-rate harmonics in cavitation-focused DEMON output from the wasm synth', { timeout: 20000 }, () => {
        const rpm = 216;
        const bladeCount = 5;
        const expectedBpf = (rpm / 60) * bladeCount;
        const samples = renderVoiceSamples({
            sampleRate: 4096,
            frameSize: 1024,
            frames: 120,
            rpm,
            bladeCount,
            shaftRate: rpm / 60,
            load: 0.68,
            rpmJitter: 0.06,
            classProfile: 2,
            cavitationLevel: 0.82
        });
        const spectrum = compute_demon_spectrum(samples, 4096, 60, 1500, 12000, 1.0, 500);
        const peak = measurePeakNearHz(spectrum, expectedBpf, 3);
        const contrast = measureLocalContrast(spectrum, Math.round(expectedBpf), 4);
        const h2 = measurePeakNearHz(spectrum, expectedBpf * 2, 3);
        const h3 = measurePeakNearHz(spectrum, expectedBpf * 3, 3);

        expect(Math.abs(peak.hz - expectedBpf)).toBeLessThanOrEqual(3);
        expect(contrast).toBeGreaterThan(1.25);
        expect(h2.value).toBeGreaterThan(peak.value * 0.1);
        expect(h3.value).toBeGreaterThan(peak.value * 0.015);
    });

    it('renders DEMON as a live spectrum without populating waterfall history', { timeout: 20000 }, () => {
        const visuals = createDemonHarness();
        const selectedTarget = {
            id: 'target-waterfall-ramp',
            type: 'SHIP',
            rpm: 180,
            bladeCount: 5,
            classification: null
        };
        const sampleRate = 4096;
        const frameSize = 1024;
        let phaseCarrier = 0;
        let phaseMod = 0;
        const dt = 1 / sampleRate;

        for (let frame = 0; frame < 90; frame++) {
            const bpfHz = 14 + (frame / 89) * 8;
            selectedTarget.rpm = (bpfHz / selectedTarget.bladeCount) * 60;
            const buf = new Float32Array(frameSize);
            for (let i = 0; i < frameSize; i++) {
                const carrier = Math.sin(phaseCarrier) + 0.32 * Math.sin(phaseCarrier * 1.73);
                const envelope = Math.sin(phaseMod) >= 0 ? 1.45 : 0.08;
                buf[i] = envelope * carrier;
                phaseCarrier += 2 * Math.PI * 520 * dt;
                phaseMod += 2 * Math.PI * bpfHz * dt;
            }

            visuals._updateDemonSpectrum(buf, sampleRate, selectedTarget);
            visuals.drawDEMON(new Uint8Array(128), selectedTarget.rpm, selectedTarget, sampleRate);
        }

        expect(visuals._demonSmoothedSpectrum).toBeInstanceOf(Float32Array);
        expect(visuals._demonSmoothedSpectrum.length).toBeGreaterThan(20);
        expect(visuals._demonWaterfallSpectrum).toBeNull();
    });
});
