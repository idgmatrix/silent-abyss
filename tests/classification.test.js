import { describe, it, expect, beforeEach } from 'vitest';
import { WorldModel } from '../src/world-model.js';
import { SimulationEngine, SimulationTarget, TrackState } from '../src/simulation.js';

describe('Classification System', () => {
    let worldModel;
    let simEngine;

    beforeEach(() => {
        simEngine = new SimulationEngine();
        worldModel = new WorldModel(simEngine, null); // No spatial service needed
    });

    it('should initialize target with classification state', () => {
        const target = new SimulationTarget('t1', { type: 'SUBMARINE', classId: 'triumph-class' });
        expect(target.classification).toBeDefined();
        expect(target.classification.state).toBe(TrackState.UNDETECTED);
        expect(target.classification.progress).toBe(0);
    });

    it('should advance classification when target is tracked with good SNR', () => {
        const target = new SimulationTarget('t1', { distance: 10, type: 'SUBMARINE' });
        simEngine.addTarget(target);

        // Mock tracked state and high SNR
        target.state = TrackState.TRACKED;
        target.snr = 20;

        // Run several updates
        for (let i = 0; i < 200; i++) {
            worldModel.processClassification(0.1);
        }

        expect(target.classification.progress).toBeGreaterThan(0.2);
        expect(target.classification.state).toBe(TrackState.AMBIGUOUS);
    });

    it('should advance faster when target is selected', () => {
        const t1 = new SimulationTarget('t1', { distance: 10, type: 'SUBMARINE' });
        const t2 = new SimulationTarget('t2', { distance: 10, type: 'SUBMARINE' });
        simEngine.addTarget(t1);
        simEngine.addTarget(t2);

        t1.state = TrackState.TRACKED;
        t1.snr = 20;
        t2.state = TrackState.TRACKED;
        t2.snr = 20;

        worldModel.selectedTargetId = 't1';

        worldModel.processClassification(1.0);

        expect(t1.classification.progress).toBeGreaterThan(t2.classification.progress);
    });

    it('should reach CONFIRMED state at 100% progress', () => {
        const target = new SimulationTarget('t1', { distance: 10, type: 'SUBMARINE' });
        simEngine.addTarget(target);
        target.state = TrackState.TRACKED;
        target.snr = 50;

        // Force progress to near completion
        target.classification.progress = 0.99;
        worldModel.processClassification(1.0);

        expect(target.classification.state).toBe(TrackState.CONFIRMED);
        expect(target.classification.confirmed).toBe(true);
    });
});
