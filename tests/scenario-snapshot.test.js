import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/simulation.js';
import { buildScenarioTargets, getDefaultScenario } from '../src/data/scenario-loader.js';

function round(value) {
    return Number.isFinite(value) ? Number(value.toFixed(3)) : value;
}

describe('Scenario snapshot', () => {
    it('matches deterministic default scenario seed snapshot', () => {
        const engine = new SimulationEngine(12345);
        const targets = buildScenarioTargets(getDefaultScenario(), () => engine.random());

        const snapshot = targets.map((target) => ({
            id: target.id,
            type: target.type,
            classId: target.classId || null,
            isPatrolling: target.isPatrolling,
            patrolRadius: target.patrolRadius ?? null,
            x: round(target.x),
            z: round(target.z),
            distance: round(target.distance),
            angle: round(target.angle),
            speed: round(target.speed),
            rpm: round(target.rpm),
            bladeCount: target.bladeCount ?? null
        }));

        expect(snapshot).toMatchSnapshot();
    });
});
