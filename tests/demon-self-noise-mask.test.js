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

function createDemonHarness() {
    const visuals = new SonarVisuals();
    visuals.dCanvas = { width: 420, height: 180 };
    visuals.dCtx = createNoopContext();
    return visuals;
}

function runSelfNoiseDominatedFrames({ visuals, selectedTarget, sampleRate = 48000, frames = 120, frameSize = 2048, ownBpfHz = 5, modulation = 0.95, carrierHz = 360 }) {
    let phaseCarrier = 0;
    let phaseMod = 0;
    const dt = 1 / sampleRate;

    for (let frame = 0; frame < frames; frame++) {
        const buf = new Float32Array(frameSize);
        for (let i = 0; i < frameSize; i++) {
            const carrier = Math.sin(phaseCarrier);
            const envelope = 1 + modulation * Math.sin(phaseMod);
            // Strong own-ship-like modulation with deterministic texture.
            const clutter = 0.02 * Math.sin(phaseCarrier * 0.29);
            buf[i] = envelope * carrier + clutter;
            phaseCarrier += 2 * Math.PI * carrierHz * dt;
            phaseMod += 2 * Math.PI * ownBpfHz * dt;
        }

        visuals._updateDemonSpectrum(buf, sampleRate, selectedTarget);
        visuals.drawDEMON(new Uint8Array(128), selectedTarget?.rpm ?? 0, selectedTarget, sampleRate);
    }
}

describe('DEMON self-noise masking', () => {
    it('keeps confidence below lock threshold in own-noise dominated case', () => {
        const visuals = createDemonHarness();
        visuals.setSelfNoiseSuppressionEnabled(true);
        visuals._ownShipSignature = {
            rpm: 60,
            bladeCount: 5,
            bpfHz: 5
        };

        const selectedTarget = {
            id: 'target-02',
            type: 'SHIP',
            rpm: 216,
            bladeCount: 5,
            classification: null
        };

        runSelfNoiseDominatedFrames({
            visuals,
            selectedTarget,
            ownBpfHz: 5,
            frames: 140
        });

        const lock = visuals._demonLocks.get(selectedTarget.id);
        expect(lock).toBeDefined();
        expect(lock.confidence).toBeLessThan(0.68);
        expect(lock.state).not.toBe('LOCKED');
    });
});
