import { describe, expect, it } from 'vitest';
import { ContactManager } from '../src/contact-manager.js';

function mkTarget(overrides = {}) {
    return {
        id: 'target-01',
        type: 'SHIP',
        state: 'TRACKED',
        distance: 20,
        bearing: 90,
        course: Math.PI / 2,
        velocity: 0.5,
        snr: 15,
        x: 0,
        z: 0,
        ...overrides
    };
}

describe('ContactManager', () => {
    it('assigns stable labels and keeps them across updates', () => {
        const manager = new ContactManager();

        manager.update([mkTarget({ id: 'target-01' }), mkTarget({ id: 'target-02', bearing: 120 })], 1);
        const first = manager.getContacts({ sortMode: 'LABEL' });

        expect(first[0].label).toBe('S1');
        expect(first[1].label).toBe('S2');

        manager.update([mkTarget({ id: 'target-01', bearing: 110 }), mkTarget({ id: 'target-02', bearing: 130 })], 2);
        const second = manager.getContacts({ sortMode: 'LABEL' });

        expect(second[0].label).toBe('S1');
        expect(second[1].label).toBe('S2');
    });

    it('promotes contacts to LOST and clears them', () => {
        const manager = new ContactManager({ lostTimeout: 5 });
        manager.update([mkTarget()], 0);
        manager.update([mkTarget({ state: 'LOST' })], 7);

        const before = manager.getContacts();
        expect(before[0].status).toBe('LOST');

        const removed = manager.clearLostContacts();
        expect(removed).toEqual(['target-01']);
        expect(manager.getContacts()).toHaveLength(0);
    });

    it('supports relabeling with duplicate protection', () => {
        const manager = new ContactManager();
        manager.update([mkTarget({ id: 'target-01' }), mkTarget({ id: 'target-02', bearing: 170 })], 1);

        expect(manager.relabel('target-01', 'ALPHA').ok).toBe(true);
        const dup = manager.relabel('target-02', 'ALPHA');

        expect(dup.ok).toBe(false);
        expect(dup.reason).toBe('duplicate');
    });

    it('scores manual solution confidence', () => {
        const manager = new ContactManager();
        const target = mkTarget({
            bearing: 90,
            distance: 20,
            course: Math.PI / 2,
            velocity: 0.5,
            x: 10,
            z: 0
        });

        manager.update([target], 1);

        const perfect = manager.setManualSolution('target-01', {
            bearing: 90,
            range: 1000,
            course: 90,
            speed: 10
        }, target);

        const poor = manager.setManualSolution('target-01', {
            bearing: 270,
            range: 3000,
            course: 270,
            speed: 40
        }, target);

        expect(perfect).toBeGreaterThan(poor);
        expect(perfect).toBeGreaterThanOrEqual(90);
    });
});
