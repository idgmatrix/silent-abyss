import { describe, expect, it } from 'vitest';
import { SonarVisuals } from '../src/sonar-visuals.js';

function createNoopContext() {
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

function createHarness() {
    const visuals = new SonarVisuals({ useWasmDemon: false });
    visuals.dCanvas = { width: 420, height: 180 };
    visuals.dCtx = createNoopContext();
    visuals.setDemonResponsiveness(1.0);
    visuals.setDemonFocusWidth(1.2);
    return visuals;
}

function createTargetSignalFrame({
    frameSize = 1024,
    sampleRate = 4096,
    bpfHz = 18,
    carrierHz = 420,
    noise = 0.002,
    phases
}) {
    const buf = new Float32Array(frameSize);
    const dt = 1 / sampleRate;
    let phaseCarrier = phases.phaseCarrier;
    let phaseMod = phases.phaseMod;

    for (let i = 0; i < frameSize; i++) {
        const carrier = Math.sin(phaseCarrier) + 0.35 * Math.sin(phaseCarrier * 1.57);
        const envelope = Math.sin(phaseMod) >= 0 ? 1.6 : 0.05;
        const n = noise * Math.sin(phaseCarrier * 0.23);
        buf[i] = envelope * carrier + n;
        phaseCarrier += 2 * Math.PI * carrierHz * dt;
        phaseMod += 2 * Math.PI * bpfHz * dt;
    }

    phases.phaseCarrier = phaseCarrier;
    phases.phaseMod = phaseMod;
    return buf;
}

describe('DEMON phase-0 correctness fixes', () => {
    it('resets sample history when switching selected target', () => {
        const visuals = createHarness();
        const targetA = { id: 'target-a', rpm: 200, bladeCount: 5, type: 'SHIP', classification: null };
        const targetB = { id: 'target-b', rpm: 120, bladeCount: 4, type: 'SHIP', classification: null };
        const frame = new Float32Array(1024).fill(0.12);

        visuals._syncDemonTargetCache(targetA);
        visuals._updateDemonSpectrum(frame, 4096, targetA);
        expect(visuals._demonSampleCount).toBeGreaterThan(0);

        visuals._syncDemonTargetCache(targetB);
        expect(visuals._demonSampleCount).toBe(0);
        expect(visuals._demonSampleWriteIndex).toBe(0);
        for (let i = 0; i < 16; i++) {
            expect(visuals._demonSampleBuffer[i]).toBe(0);
        }
    });

    it('applies ping suppression only in composite mode', () => {
        const visuals = createHarness();
        const td = new Float32Array(1024).fill(0.1);
        const selectedTarget = { id: 'target-01', rpm: 216, bladeCount: 5, type: 'SHIP', classification: null };

        visuals._demonSmoothedSpectrum = new Float32Array(16).fill(1);
        visuals._demonPeakTracks = [{ hz: 10, strength: 1, age: 0, seen: true }];
        visuals._demonSignalQuality = 1;
        visuals._demonSourceMode = 'SELECTED';
        visuals._demonPingTransient = { active: true, recent: true, sinceLastPing: 0.1 };
        visuals._updateDemonSpectrum(td, 4096, selectedTarget);
        expect(visuals._demonSmoothedSpectrum[1]).toBeCloseTo(1, 5);

        visuals._demonSmoothedSpectrum = new Float32Array(16).fill(1);
        visuals._demonPeakTracks = [{ hz: 10, strength: 1, age: 0, seen: true }];
        visuals._demonSignalQuality = 1;
        visuals._demonSourceMode = 'COMPOSITE';
        visuals._demonPingTransient = { active: true, recent: true, sinceLastPing: 0.1 };
        visuals._updateDemonSpectrum(td, 4096, null);
        expect(visuals._demonSmoothedSpectrum[1]).toBeCloseTo(0.92, 5);
    });

    it('derives auto-mode BPF confidence/readout from comb evidence', () => {
        const visuals = createHarness();
        const phases = { phaseCarrier: 0, phaseMod: 0 };
        const sampleRate = 4096;
        const frameSize = 1024;
        const fftSize = 1024;
        const dataArray = new Uint8Array(256);
        const expectedBpf = 18;

        for (let frame = 0; frame < 120; frame++) {
            const timeDomainData = createTargetSignalFrame({
                frameSize,
                sampleRate,
                bpfHz: expectedBpf,
                phases
            });
            visuals.draw(
                dataArray,
                [],
                0,
                0,
                sampleRate,
                fftSize,
                null,
                timeDomainData,
                { sourceMode: 'COMPOSITE' }
            );
        }

        expect(visuals._demonAutoBpfHz).toBeGreaterThan(0);
        expect(Math.abs(visuals._demonAutoBpfHz - expectedBpf)).toBeLessThanOrEqual(expectedBpf * 0.2);
        expect(visuals._demonDisplayHarmonicScore).toBeGreaterThan(0.45);
    });
});
