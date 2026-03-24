import { describe, expect, it } from 'vitest';
import { EnvironmentModel } from '../src/acoustics/environment-model.js';
import { SONAR_VALIDATION_SCENARIOS } from './fixtures/sonar-validation-scenarios.js';
import {
    computeDemonMetrics,
    computeLofarSpectrum,
    countVisibleHarmonics,
    measureBandEnergy,
    measureLocalContrast,
    measurePeakNearHz,
    measureSpectralSlope,
    renderVoiceSamples,
    runSelectedTargetDemonLock
} from './support/sonar-validation-harness.js';

describe('Sonar validation regression', () => {
    it('merchant cruise case exposes stable LOFAR tonals and DEMON lock at expected BPF', { timeout: 20000 }, () => {
        const scenario = SONAR_VALIDATION_SCENARIOS.merchantCruise;
        const expectedBpf = (scenario.target.rpm / 60) * scenario.target.bladeCount;
        const samples = renderVoiceSamples({
            ...scenario.synthConfig,
            sampleRate: scenario.sampleRate,
            frameSize: scenario.frameSize,
            frames: scenario.frames
        });
        const lofar = computeLofarSpectrum(samples, scenario.sampleRate, { maxFreqHz: 180 });
        const demon = computeDemonMetrics(samples, scenario.sampleRate);
        const lockRun = runSelectedTargetDemonLock({
            target: scenario.target,
            synthConfig: {
                ...scenario.synthConfig,
                sampleRate: scenario.sampleRate,
                frameSize: scenario.frameSize
            }
        });

        const bpfContrast = measureLocalContrast(lofar, Math.round(expectedBpf), 3);
        const harmonicCount = countVisibleHarmonics(lofar, expectedBpf, 4, 1.9);
        const demonBpf = measurePeakNearHz(demon.spectrum, Math.round(expectedBpf), 3);
        const demonContrast = measureLocalContrast(demon.spectrum, Math.round(expectedBpf), 4);

        expect(bpfContrast.ratio).toBeGreaterThan(2.0);
        expect(harmonicCount).toBeGreaterThanOrEqual(3);
        expect(Math.abs(demonBpf.hz - expectedBpf)).toBeLessThanOrEqual(3);
        expect(demonContrast.ratio).toBeGreaterThan(1.3);
        expect(lockRun.lockFrame).not.toBeNull();
        expect(lockRun.lockFrame).toBeLessThanOrEqual(120);
        expect(lockRun.lock).toBeDefined();
        expect(lockRun.lock.state).toBe('LOCKED');
        expect(Math.abs(lockRun.lock.bpfEstimateHz - expectedBpf)).toBeLessThanOrEqual(expectedBpf * 0.12);
    });

    it('heavy cavitation raises high-band LOFAR energy and keeps DEMON BPF recoverable', { timeout: 20000 }, () => {
        const baseline = SONAR_VALIDATION_SCENARIOS.cavitationBaseline;
        const heavy = SONAR_VALIDATION_SCENARIOS.cavitationHeavy;
        const expectedBpf = (heavy.target.rpm / 60) * heavy.target.bladeCount;

        const baselineSamples = renderVoiceSamples({
            ...baseline.synthConfig,
            sampleRate: baseline.sampleRate,
            frameSize: baseline.frameSize,
            frames: baseline.frames
        });
        const heavySamples = renderVoiceSamples({
            ...heavy.synthConfig,
            sampleRate: heavy.sampleRate,
            frameSize: heavy.frameSize,
            frames: heavy.frames
        });

        const baselineLofar = computeLofarSpectrum(baselineSamples, baseline.sampleRate, { maxFreqHz: 256 });
        const heavyLofar = computeLofarSpectrum(heavySamples, heavy.sampleRate, { maxFreqHz: 256 });
        const baselineDemon = computeDemonMetrics(baselineSamples, baseline.sampleRate);
        const heavyDemon = computeDemonMetrics(heavySamples, heavy.sampleRate);

        const baselineHighBand = measureBandEnergy(baselineLofar, 80, 220);
        const heavyHighBand = measureBandEnergy(heavyLofar, 80, 220);
        const baselineSlope = measureSpectralSlope(baselineLofar, 20, 220);
        const heavySlope = measureSpectralSlope(heavyLofar, 20, 220);
        const heavyBpf = measurePeakNearHz(heavyLofar, Math.round(expectedBpf), 2);
        const baselineDemonBpf = measurePeakNearHz(baselineDemon.spectrum, Math.round(expectedBpf), 4);
        const heavyDemonBpf = measurePeakNearHz(heavyDemon.spectrum, Math.round(expectedBpf), 4);

        expect(heavyHighBand).toBeGreaterThan(baselineHighBand * 1.1);
        expect(heavySlope).toBeGreaterThan(baselineSlope);
        expect(heavyBpf.value).toBeGreaterThan(0);
        expect(Math.abs(heavyDemonBpf.hz - expectedBpf)).toBeLessThanOrEqual(4);
        expect(Math.abs(baselineDemonBpf.hz - expectedBpf)).toBeLessThanOrEqual(4);
    });

    it('submarine profile stays cleaner than a matched merchant profile in the high band', () => {
        const submarine = SONAR_VALIDATION_SCENARIOS.submarineQuiet;
        const merchant = SONAR_VALIDATION_SCENARIOS.merchantMatchedSpeed;

        const submarineSamples = renderVoiceSamples({
            ...submarine.synthConfig,
            sampleRate: submarine.sampleRate,
            frameSize: submarine.frameSize,
            frames: submarine.frames
        });
        const merchantSamples = renderVoiceSamples({
            ...merchant.synthConfig,
            sampleRate: merchant.sampleRate,
            frameSize: merchant.frameSize,
            frames: merchant.frames
        });

        const submarineLofar = computeLofarSpectrum(submarineSamples, submarine.sampleRate, { maxFreqHz: 256 });
        const merchantLofar = computeLofarSpectrum(merchantSamples, merchant.sampleRate, { maxFreqHz: 256 });
        const submarineHighBand = measureBandEnergy(submarineLofar, 80, 220);
        const merchantHighBand = measureBandEnergy(merchantLofar, 80, 220);
        const submarineSlope = measureSpectralSlope(submarineLofar, 20, 220);
        const merchantSlope = measureSpectralSlope(merchantLofar, 20, 220);

        expect(submarineHighBand).toBeLessThan(merchantHighBand * 0.9);
        expect(submarineSlope).toBeLessThan(merchantSlope);
    });

    it('environment hooks expose a measurable masking budget for validation scenarios', () => {
        const env = new EnvironmentModel();
        env.seaState = 1;
        const calmNoise = env.getAmbientNoise(40, 1000);
        const calmModifiers = env.getAcousticModifiers(20, 30, 900);

        env.seaState = 6;
        const roughNoise = env.getAmbientNoise(40, 1000);
        const roughModifiers = env.getAcousticModifiers(300, 500, 5000);

        expect(roughNoise).toBeGreaterThan(calmNoise);
        expect(calmModifiers.snrModifierDb).toBeGreaterThan(roughModifiers.snrModifierDb);
        expect(calmModifiers.notes.length).toBeGreaterThan(0);
    });
});
