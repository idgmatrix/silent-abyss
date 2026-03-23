export const SONAR_VALIDATION_SCENARIOS = {
    merchantCruise: {
        name: 'merchant-cruise',
        sampleRate: 4096,
        frameSize: 1024,
        frames: 96,
        synthConfig: {
            rpm: 216,
            bladeCount: 5,
            shaftRate: 216 / 60,
            load: 0.66,
            rpmJitter: 0.07,
            classProfile: 2,
            cavitationLevel: 0.18
        },
        target: {
            id: 'merchant-01',
            type: 'SHIP',
            rpm: 216,
            bladeCount: 5,
            shaftRate: 216 / 60,
            classification: null
        }
    },
    cavitationBaseline: {
        name: 'cavitation-baseline',
        sampleRate: 4096,
        frameSize: 1024,
        frames: 96,
        synthConfig: {
            rpm: 240,
            bladeCount: 5,
            shaftRate: 240 / 60,
            load: 0.68,
            rpmJitter: 0.08,
            classProfile: 2,
            cavitationLevel: 0.08
        },
        target: {
            id: 'cav-baseline',
            type: 'SHIP',
            rpm: 240,
            bladeCount: 5,
            shaftRate: 240 / 60,
            classification: null
        }
    },
    cavitationHeavy: {
        name: 'cavitation-heavy',
        sampleRate: 4096,
        frameSize: 1024,
        frames: 96,
        synthConfig: {
            rpm: 240,
            bladeCount: 5,
            shaftRate: 240 / 60,
            load: 0.74,
            rpmJitter: 0.08,
            classProfile: 2,
            cavitationLevel: 0.9
        },
        target: {
            id: 'cav-heavy',
            type: 'SHIP',
            rpm: 240,
            bladeCount: 5,
            shaftRate: 240 / 60,
            classification: null
        }
    },
    submarineQuiet: {
        name: 'submarine-quiet',
        sampleRate: 4096,
        frameSize: 1024,
        frames: 96,
        synthConfig: {
            rpm: 180,
            bladeCount: 7,
            shaftRate: 180 / 60,
            load: 0.42,
            rpmJitter: 0.05,
            classProfile: 1,
            cavitationLevel: 0.12
        },
        target: {
            id: 'sub-quiet',
            type: 'SUBMARINE',
            rpm: 180,
            bladeCount: 7,
            shaftRate: 180 / 60,
            classification: null
        }
    },
    merchantMatchedSpeed: {
        name: 'merchant-matched-speed',
        sampleRate: 4096,
        frameSize: 1024,
        frames: 96,
        synthConfig: {
            rpm: 180,
            bladeCount: 7,
            shaftRate: 180 / 60,
            load: 0.62,
            rpmJitter: 0.08,
            classProfile: 2,
            cavitationLevel: 0.12
        },
        target: {
            id: 'merchant-matched',
            type: 'SHIP',
            rpm: 180,
            bladeCount: 7,
            shaftRate: 180 / 60,
            classification: null
        }
    }
};
