import { describe, expect, it } from 'vitest';
import { getAcousticPreset, getClassProfile, getSignature } from '../src/data/ship-signatures.js';

describe('ship acoustic presets', () => {
    it('exposes acoustic presets for known classes', () => {
        const cargo = getAcousticPreset('cargo-vessel');
        const triumph = getAcousticPreset('triumph-class');
        const trawler = getAcousticPreset('fishery-trawler');

        expect(cargo).toBeTruthy();
        expect(triumph).toBeTruthy();
        expect(trawler).toBeTruthy();
        expect(cargo.classProfile).toBe(2);
        expect(triumph.classProfile).toBe(1);
        expect(trawler.classProfile).toBe(3);
    });

    it('keeps class presets distinct across representative contacts', () => {
        const cargo = getSignature('cargo-vessel').acousticPreset;
        const tanker = getSignature('oil-tanker').acousticPreset;
        const trawler = getSignature('fishery-trawler').acousticPreset;
        const kilo = getClassProfile('kilo-class').acousticPreset;

        expect(trawler.cavitationScale).toBeGreaterThan(cargo.cavitationScale);
        expect(cargo.cavitationScale).toBeGreaterThan(tanker.cavitationScale);
        expect(kilo.cavitationScale).toBeLessThan(cargo.cavitationScale);
        expect(trawler.jitterScale).toBeGreaterThan(tanker.jitterScale);
    });
});
