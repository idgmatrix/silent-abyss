import { describe, expect, it } from 'vitest';
import { DevAudioPanel } from '../src/dev-audio-panel.js';

function createStubOrchestrator() {
    return {
        worldModel: {
            ownShipPosition: { x: 0, z: 0 },
            environment: {
                seaState: 2,
                shippingLaneDensity: 0.35,
                precipitationLevel: 0,
                iceCoverage: 0,
                seismicActivity: 0.08,
                ventActivity: 0.04,
                currentProfile: {},
                profiles: { DEEP_OCEAN: {} }
            }
        },
        snapshotCurrentTargets() {
            return [];
        },
        async setActiveTargets() {},
        async addTarget() {},
        removeTarget() {},
        updateTarget() {},
        setSelectedTarget() {},
        audioSys: {
            setIsolationTarget() {}
        }
    };
}

describe('DevAudioPanel defaults', () => {
    it('inherits propulsion defaults for class-based surface vessels and submarines', () => {
        const panel = new DevAudioPanel(createStubOrchestrator());

        const merchant = panel.sourceStates.get('merchant-surface-vessel');
        const nukeSub = panel.sourceStates.get('nuclear-submarine');

        expect(merchant?.rpm).toBeGreaterThan(0);
        expect(merchant?.bladeCount).toBeGreaterThan(0);
        expect(merchant?.speedKt).toBeGreaterThan(0);

        expect(nukeSub?.rpm).toBeGreaterThan(0);
        expect(nukeSub?.bladeCount).toBeGreaterThan(0);
        expect(nukeSub?.speedKt).toBeGreaterThan(0);
    });
});
