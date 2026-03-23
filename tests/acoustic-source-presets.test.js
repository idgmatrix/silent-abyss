import { describe, expect, it } from 'vitest';
import {
    getAcousticSourcePreset,
    listAcousticSourcePresets
} from '../src/data/acoustic-source-presets.js';
import { buildScenarioTargets } from '../src/data/scenario-loader.js';

function emptyProcedural() {
    return {
        idStart: 2,
        count: 0,
        types: ['SHIP'],
        distanceRange: { min: 30, max: 40 },
        angleRange: { min: 0, max: 1 },
        shipClasses: ['cargo-vessel'],
        subClasses: ['kilo-class'],
        shipSpeedRange: { min: 0.5, max: 0.6 },
        shipRpmRange: { min: 100, max: 110 },
        shipBladeCount: { min: 3, max: 3 },
        subSpeedRange: { min: 0.2, max: 0.3 },
        subRpmRange: { min: 60, max: 70 },
        subBladeCount: 7
    };
}

describe('acoustic source presets', () => {
    it('covers representative contact families across the inventory', () => {
        const ids = listAcousticSourcePresets();

        expect(ids).toContain('merchant-surface-vessel');
        expect(ids).toContain('helicopter-hover');
        expect(ids).toContain('blue-whale');
        expect(ids).toContain('ocean-ambient-sea-state');
        expect(ids).toContain('iceberg-calving');
        expect(ids).toContain('earthquake');
    });

    it('resolves presets into scenario target defaults', () => {
        const scenario = {
            id: 'preset-resolution-test',
            coreTargets: [
                {
                    id: 'air-01',
                    distance: 60,
                    angle: 0.2,
                    soundPreset: 'helicopter-hover'
                },
                {
                    id: 'env-01',
                    distance: 85,
                    angle: 1.1,
                    soundPreset: 'earthquake'
                },
                {
                    id: 'bio-01',
                    distance: 45,
                    angle: 2.0,
                    soundPreset: 'blue-whale'
                }
            ],
            procedural: emptyProcedural()
        };

        const [aircraft, environmental, biological] = buildScenarioTargets(scenario, () => 0.5);

        expect(aircraft.type).toBe('AIRCRAFT');
        expect(aircraft.bioType).toBe('helicopter_rotor');
        expect(environmental.type).toBe('ENVIRONMENTAL');
        expect(environmental.bioType).toBe('geological_noise');
        expect(biological.type).toBe('BIOLOGICAL');
        expect(biological.bioType).toBe('blue_whale');
    });

    it('returns null for unknown presets', () => {
        expect(getAcousticSourcePreset('not-a-real-source')).toBeNull();
    });
});
