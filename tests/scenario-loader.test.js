import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/simulation.js';
import {
    buildScenarioTargets,
    getDefaultScenario,
    validateScenarioDefinition
} from '../src/data/scenario-loader.js';

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

describe('Scenario loader', () => {
    it('validates the default scenario definition', () => {
        expect(validateScenarioDefinition(getDefaultScenario())).toBe(true);
    });

    it('throws on malformed target entries', () => {
        const scenario = clone(getDefaultScenario());
        scenario.coreTargets[0] = { id: 'bad-target', type: 'SHIP' };

        expect(() => validateScenarioDefinition(scenario)).toThrow(/requires either \(x,z\) or \(distance,angle\)/);
    });

    it('builds deterministic target set with the same seed', () => {
        const scenario = getDefaultScenario();
        const rngA = new SimulationEngine(12345);
        const rngB = new SimulationEngine(12345);

        const runA = buildScenarioTargets(scenario, () => rngA.random());
        const runB = buildScenarioTargets(scenario, () => rngB.random());

        expect(runA).toHaveLength(15);
        expect(runB).toHaveLength(15);

        const summaryA = runA.map((t) => ({
            id: t.id,
            type: t.type,
            classId: t.classId,
            distance: t.distance,
            angle: t.angle,
            x: t.x,
            z: t.z,
            speed: t.speed,
            rpm: t.rpm,
            bladeCount: t.bladeCount,
            seed: t.seed
        }));

        const summaryB = runB.map((t) => ({
            id: t.id,
            type: t.type,
            classId: t.classId,
            distance: t.distance,
            angle: t.angle,
            x: t.x,
            z: t.z,
            speed: t.speed,
            rpm: t.rpm,
            bladeCount: t.bladeCount,
            seed: t.seed
        }));

        expect(summaryA).toEqual(summaryB);
    });

    it('applies class defaults for class-based targets', () => {
        const scenario = {
            id: 'single-class-default-test',
            coreTargets: [
                {
                    id: 'target-01',
                    distance: 20,
                    angle: 0,
                    classId: 'kilo-class'
                }
            ],
            procedural: {
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
            }
        };

        const targets = buildScenarioTargets(scenario, () => 0.5);
        expect(targets).toHaveLength(1);

        expect(targets[0].type).toBe('SUBMARINE');
        expect(targets[0].speed).toBe(0.25);
        expect(targets[0].rpm).toBe(70);
        expect(targets[0].bladeCount).toBe(7);
        expect(targets[0].isPatrolling).toBe(true);
    });

    it('accepts and normalizes biological sound fields', () => {
        const scenario = {
            id: 'bio-fields-test',
            coreTargets: [
                {
                    id: 'target-01',
                    distance: 35,
                    angle: 0.7,
                    type: 'BIOLOGICAL',
                    bioType: 'Snapping_Shrimp',
                    bioRate: 0.8
                }
            ],
            procedural: {
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
            }
        };

        const targets = buildScenarioTargets(scenario, () => 0.5);
        expect(targets).toHaveLength(1);
        expect(targets[0].bioType).toBe('snapping_shrimp');
        expect(targets[0].bioRate).toBe(0.8);
    });

    it('rejects invalid biological sound fields', () => {
        const scenario = clone(getDefaultScenario());
        scenario.coreTargets[0] = {
            ...scenario.coreTargets[0],
            bioType: 'invalid_bio_mode'
        };

        expect(() => validateScenarioDefinition(scenario)).toThrow(/bioType must be one of/);
    });

    it('accepts phase-2 biological types', () => {
        const scenario = clone(getDefaultScenario());
        scenario.coreTargets[0] = {
            id: 'target-p2-01',
            distance: 55,
            angle: 0.3,
            type: 'BIOLOGICAL',
            bioType: 'whale_moan',
            bioRate: 0.25
        };
        scenario.coreTargets[1] = {
            id: 'target-p2-02',
            distance: 65,
            angle: 1.1,
            type: 'BIOLOGICAL',
            bioType: 'dolphin_whistle',
            bioRate: 0.6
        };
        scenario.coreTargets[2] = {
            id: 'target-p2-03',
            distance: 75,
            angle: 2.2,
            type: 'BIOLOGICAL',
            bioType: 'echolocation_click',
            bioRate: 0.9
        };

        const targets = buildScenarioTargets(scenario, () => 0.5);
        const p2Targets = targets.filter((t) => t.id.startsWith('target-p2-'));
        expect(p2Targets.map((t) => t.bioType)).toEqual(['whale_moan', 'dolphin_whistle', 'echolocation_click']);
    });

    it('accepts phase-3 humpback biological type', () => {
        const scenario = clone(getDefaultScenario());
        scenario.coreTargets[0] = {
            id: 'target-p3-01',
            distance: 70,
            angle: 1.7,
            type: 'BIOLOGICAL',
            bioType: 'humpback_song',
            bioRate: 0.45
        };

        const targets = buildScenarioTargets(scenario, () => 0.5);
        const p3Target = targets.find((t) => t.id === 'target-p3-01');
        expect(p3Target?.bioType).toBe('humpback_song');
        expect(p3Target?.bioRate).toBe(0.45);
    });
});
