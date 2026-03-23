import { describe, expect, it } from 'vitest';
import { AudioSystem } from '../src/audio-system.js';

function createManagerSpy() {
    return {
        ready: true,
        calls: [],
        setGain(value, voiceId) {
            this.calls.push(['setGain', value, voiceId]);
        },
        setEngineMix(value, voiceId) {
            this.calls.push(['setEngineMix', value, voiceId]);
        },
        setCavMix(value, voiceId) {
            this.calls.push(['setCavMix', value, voiceId]);
        },
        setBioMix(value, voiceId) {
            this.calls.push(['setBioMix', value, voiceId]);
        },
        setBlades(value, voiceId) {
            this.calls.push(['setBlades', value, voiceId]);
        },
        setRpm(value, voiceId) {
            this.calls.push(['setRpm', value, voiceId]);
        },
        setBioType(value, voiceId) {
            this.calls.push(['setBioType', value, voiceId]);
        },
        setBioRate(value, voiceId) {
            this.calls.push(['setBioRate', value, voiceId]);
        },
        setShaftRate(value, voiceId) {
            this.calls.push(['setShaftRate', value, voiceId]);
        },
        setLoad(value, voiceId) {
            this.calls.push(['setLoad', value, voiceId]);
        },
        setRpmJitter(value, voiceId) {
            this.calls.push(['setRpmJitter', value, voiceId]);
        },
        setClassProfile(value, voiceId) {
            this.calls.push(['setClassProfile', value, voiceId]);
        },
        setCavitationLevel(value, voiceId) {
            this.calls.push(['setCavitationLevel', value, voiceId]);
        },
        dispose() {}
    };
}

describe('AudioSystem selected analysis path', () => {
    it('mirrors only the focused target into the selected analysis voice', () => {
        const audio = new AudioSystem();
        audio.ctx = { currentTime: 1 };
        audio.ownVoiceId = 0;
        audio.analysisOwnShipVoiceId = 0;
        audio.analysisSelectedVoiceId = 7;
        audio.wasmManager = createManagerSpy();
        audio.analysisWasmManager = createManagerSpy();
        audio.analysisOwnShipWasmManager = createManagerSpy();
        audio.analysisSelectedTargetWasmManager = createManagerSpy();

        audio.targetNodes.set('t-1', {
            voiceId: 1,
            analysisVoiceId: 11,
            rpm: 216,
            bladeCount: 5,
            baseBioType: 0,
            baseBioRate: 0.35,
            shaftRate: 216 / 60,
            load: 0.6,
            rpmJitter: 0.07,
            classProfile: 2,
            cavitationLevel: 0.35,
            currentAnalysisGain: 0.4,
            currentAnalysisEngineMix: 0.8,
            currentAnalysisCavMix: 0.5,
            currentAnalysisBioMix: 0,
            currentGain: 0.4,
            currentEngineMix: 0.8,
            currentCavMix: 0.5,
            currentBioMix: 0,
            baseEngineMix: 1,
            baseCavMix: 0.6,
            baseBioMix: 0,
            lastUpdateTime: 1
        });
        audio.targetNodes.set('t-2', {
            voiceId: 2,
            analysisVoiceId: 12,
            rpm: 140,
            bladeCount: 4,
            baseBioType: 0,
            baseBioRate: 0.35,
            shaftRate: 140 / 60,
            load: 0.4,
            rpmJitter: 0.05,
            classProfile: 1,
            cavitationLevel: 0.12,
            currentAnalysisGain: 0.2,
            currentAnalysisEngineMix: 0.6,
            currentAnalysisCavMix: 0.2,
            currentAnalysisBioMix: 0,
            currentGain: 0.2,
            currentEngineMix: 0.6,
            currentCavMix: 0.2,
            currentBioMix: 0,
            baseEngineMix: 1,
            baseCavMix: 0.2,
            baseBioMix: 0,
            lastUpdateTime: 1
        });

        audio.setFocusedTarget('t-2');

        const selectedCalls = audio.analysisSelectedTargetWasmManager.calls;
        expect(selectedCalls).toContainEqual(['setBlades', 4, 7]);
        expect(selectedCalls).toContainEqual(['setRpm', 140, 7]);
        expect(selectedCalls).toContainEqual(['setGain', 0.2, 7]);
        expect(selectedCalls).toContainEqual(['setEngineMix', 0.6, 7]);
        expect(selectedCalls).toContainEqual(['setCavMix', 0.2, 7]);
        expect(selectedCalls).not.toContainEqual(['setRpm', 216, 7]);
    });

    it('mutes the selected analysis voice when focus is cleared', () => {
        const audio = new AudioSystem();
        audio.analysisSelectedVoiceId = 3;
        audio.analysisSelectedTargetWasmManager = createManagerSpy();
        audio.focusedTargetId = null;

        audio.syncSelectedAnalysisVoice();

        expect(audio.analysisSelectedTargetWasmManager.calls).toContainEqual(['setGain', 0, 3]);
        expect(audio.analysisSelectedTargetWasmManager.calls).toContainEqual(['setEngineMix', 0, 3]);
        expect(audio.analysisSelectedTargetWasmManager.calls).toContainEqual(['setCavMix', 0, 3]);
        expect(audio.analysisSelectedTargetWasmManager.calls).toContainEqual(['setBioMix', 0, 3]);
    });
});
