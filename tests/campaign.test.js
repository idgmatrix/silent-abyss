import { describe, expect, it } from 'vitest';
import { CampaignManager } from '../src/campaign-manager.js';
import { CAMPAIGN_MISSIONS } from '../src/data/missions.js';

function makeStorage() {
    const mem = new Map();
    return {
        getItem: (key) => mem.get(key) || null,
        setItem: (key, value) => mem.set(key, value),
        removeItem: (key) => mem.delete(key)
    };
}

function target(overrides = {}) {
    return {
        id: 't1',
        type: 'SHIP',
        state: 'TRACKED',
        classification: { confirmed: false },
        ...overrides
    };
}

describe('CampaignManager', () => {
    it('completes mission 1 and unlocks mission 2', () => {
        const storage = makeStorage();
        const manager = new CampaignManager(CAMPAIGN_MISSIONS, { storage });
        manager.load();

        let result = manager.evaluate({
            targets: [target({ type: 'SHIP', state: 'TRACKED' })],
            contacts: []
        });

        expect(result.newlyCompletedObjectives).toContain('track-contact');
        expect(manager.isMissionCompleted('mission-01')).toBe(false);

        result = manager.evaluate({
            targets: [target({ type: 'SUBMARINE', state: 'TRACKED', classification: { confirmed: true } })],
            contacts: []
        });

        expect(result.missionCompleted).toBe(true);
        expect(manager.isMissionCompleted('mission-01')).toBe(true);
        expect(manager.getUnlockedMissions().map((m) => m.id)).toContain('mission-02');
    });

    it('persists and reloads campaign state', () => {
        const storage = makeStorage();
        const managerA = new CampaignManager(CAMPAIGN_MISSIONS, { storage });
        managerA.load();

        managerA.evaluate({
            targets: [target({ type: 'SHIP', state: 'TRACKED' })],
            contacts: []
        });
        managerA.evaluate({
            targets: [target({ type: 'SUBMARINE', state: 'TRACKED', classification: { confirmed: true } })],
            contacts: []
        });

        const managerB = new CampaignManager(CAMPAIGN_MISSIONS, { storage });
        managerB.load();

        expect(managerB.isMissionCompleted('mission-01')).toBe(true);
        expect(managerB.getUnlockedMissions().map((m) => m.id)).toContain('mission-02');
    });

    it('completes mission 2 objectives with contacts and environment advantage', () => {
        const storage = makeStorage();
        const manager = new CampaignManager(CAMPAIGN_MISSIONS, { storage });
        manager.load();

        manager.evaluate({
            targets: [target({ state: 'TRACKED' })],
            contacts: []
        });
        manager.evaluate({
            targets: [target({ type: 'SUBMARINE', state: 'TRACKED', classification: { confirmed: true } })],
            contacts: []
        });

        manager.setActiveMission('mission-02');

        const result = manager.evaluate({
            targets: [
                target({ id: 'a', state: 'TRACKED' }),
                target({ id: 'b', state: 'TRACKED' }),
                target({ id: 'c', state: 'TRACKED' })
            ],
            contacts: [{ targetId: 'a', manualConfidence: 80 }],
            selectedAcousticContext: { modifiers: { snrModifierDb: 2 } }
        });

        expect(result.missionCompleted).toBe(true);
        expect(manager.isMissionCompleted('mission-02')).toBe(true);
    });
});
