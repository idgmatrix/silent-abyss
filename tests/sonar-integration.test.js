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
    const visuals = new SonarVisuals();
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

describe('Sonar integration smoke (selection -> DEMON metadata)', () => {
    it('updates source mode and lock metadata across selection transitions', () => {
        const visuals = createHarness();
        const selectedTarget = {
            id: 'target-07',
            type: 'SHIP',
            rpm: 216,
            bladeCount: 5,
            classification: null
        };
        const expectedBpf = (selectedTarget.rpm / 60) * selectedTarget.bladeCount;
        const phases = { phaseCarrier: 0, phaseMod: 0 };
        const sampleRate = 4096;
        const frameSize = 1024;
        const fftSize = 1024;
        const dataArray = new Uint8Array(256);
        const targets = [selectedTarget];

        visuals.draw(
            dataArray,
            targets,
            0,
            0,
            sampleRate,
            fftSize,
            null,
            new Float32Array(frameSize),
            { sourceMode: 'COMPOSITE' }
        );
        expect(visuals._demonSourceMode).toBe('COMPOSITE');
        expect(visuals._demonSelectedTargetId).toBeNull();
        expect(visuals._demonTrackState).toBe('SEARCHING');

        const states = [];
        for (let frame = 0; frame < 120; frame++) {
            const timeDomainData = createTargetSignalFrame({
                frameSize,
                sampleRate,
                bpfHz: expectedBpf,
                phases
            });
            visuals.draw(
                dataArray,
                targets,
                selectedTarget.rpm,
                0,
                sampleRate,
                fftSize,
                selectedTarget,
                timeDomainData,
                { sourceMode: 'SELECTED' }
            );
            states.push(visuals._demonTrackState);
        }

        const lock = visuals._demonLocks.get(selectedTarget.id);
        expect(visuals._demonSourceMode).toBe('SELECTED');
        expect(visuals._demonSelectedTargetId).toBe(selectedTarget.id);
        expect(states).toContain('TENTATIVE');
        expect(visuals._demonTrackState).toBe('LOCKED');
        expect(lock).toBeDefined();
        expect(lock.state).toBe('LOCKED');
        expect(Math.abs(lock.bpfEstimateHz - expectedBpf)).toBeLessThanOrEqual(expectedBpf * 0.1);

        visuals.draw(
            dataArray,
            targets,
            0,
            0,
            sampleRate,
            fftSize,
            null,
            new Float32Array(frameSize),
            { sourceMode: 'COMPOSITE' }
        );
        expect(visuals._demonSourceMode).toBe('COMPOSITE');
        expect(visuals._demonSelectedTargetId).toBeNull();
        expect(visuals._demonTrackState).toBe('SEARCHING');
    });
});
