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

function trackedTarget(overrides = {}) {
    return {
        id: 't1',
        type: 'SHIP',
        state: 'TRACKED',
        classification: { confirmed: false },
        ...overrides
    };
}

describe('Campaign smoke flow', () => {
    it('completes both campaign missions through one sequential playthrough', () => {
        const storage = makeStorage();
        const campaign = new CampaignManager(CAMPAIGN_MISSIONS, { storage });
        campaign.load();

        campaign.evaluate({
            targets: [trackedTarget({ id: 'a', type: 'SHIP' })],
            contacts: []
        });

        const m1 = campaign.evaluate({
            targets: [trackedTarget({ id: 'b', type: 'SUBMARINE', classification: { confirmed: true } })],
            contacts: []
        });

        expect(m1.missionCompleted).toBe(true);
        expect(campaign.isMissionCompleted('mission-01')).toBe(true);

        expect(campaign.setActiveMission('mission-02')).toBe(true);

        const m2 = campaign.evaluate({
            targets: [
                trackedTarget({ id: 'a', state: 'TRACKED' }),
                trackedTarget({ id: 'b', state: 'TRACKED' }),
                trackedTarget({ id: 'c', state: 'TRACKED' })
            ],
            contacts: [{ targetId: 'a', manualConfidence: 75 }],
            selectedAcousticContext: { modifiers: { snrModifierDb: 2.4 } }
        });

        expect(m2.missionCompleted).toBe(true);
        expect(campaign.isMissionCompleted('mission-02')).toBe(true);

        const reloaded = new CampaignManager(CAMPAIGN_MISSIONS, { storage });
        reloaded.load();
        expect(reloaded.isMissionCompleted('mission-01')).toBe(true);
        expect(reloaded.isMissionCompleted('mission-02')).toBe(true);
    });
});
