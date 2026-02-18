import { describe, expect, it } from 'vitest';
import { SonarVisuals } from '../src/sonar-visuals.js';

function createNoopContext() {
    const ctx = {
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

describe('DEMON lock tracker', () => {
    it('acquires lock near expected BPF in bounded frames', () => {
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
});
