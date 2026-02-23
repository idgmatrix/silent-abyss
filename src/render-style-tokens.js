export const VISUAL_MODES = {
    STEALTH: 'stealth',
    ENGAGEMENT: 'engagement',
    ALARM: 'alarm'
};

export const RENDER_STYLE_TOKENS = {
    tactical2d: {
        fontFamily: '"Share Tech Mono", monospace',
        modes: {
            [VISUAL_MODES.STEALTH]: {
                backgroundTop: '#04131a',
                backgroundBottom: '#01080d',
                gridMajor: 'rgba(70, 185, 205, 0.42)',
                gridMinor: 'rgba(46, 120, 138, 0.24)',
                labels: 'rgba(190, 245, 255, 0.9)',
                scan: '#39f6ff',
                ownShip: '#33ff8d',
                contourMajor: 'rgba(0, 182, 194, 0.7)',
                contourMinor: 'rgba(0, 150, 160, 0.5)',
                pingFlash: 'rgba(130, 245, 255, 0.26)'
            },
            [VISUAL_MODES.ENGAGEMENT]: {
                backgroundTop: '#180f08',
                backgroundBottom: '#090402',
                gridMajor: 'rgba(255, 160, 88, 0.44)',
                gridMinor: 'rgba(140, 86, 48, 0.26)',
                labels: 'rgba(255, 224, 178, 0.92)',
                scan: '#ff9c4d',
                ownShip: '#ffcb6b',
                contourMajor: 'rgba(222, 126, 58, 0.76)',
                contourMinor: 'rgba(160, 92, 44, 0.56)',
                pingFlash: 'rgba(255, 186, 122, 0.24)'
            },
            [VISUAL_MODES.ALARM]: {
                backgroundTop: '#170809',
                backgroundBottom: '#070203',
                gridMajor: 'rgba(255, 72, 86, 0.46)',
                gridMinor: 'rgba(162, 38, 52, 0.3)',
                labels: 'rgba(255, 215, 220, 0.95)',
                scan: '#ff4f67',
                ownShip: '#ffb3bf',
                contourMajor: 'rgba(208, 65, 82, 0.76)',
                contourMinor: 'rgba(145, 45, 58, 0.58)',
                pingFlash: 'rgba(255, 96, 118, 0.22)'
            }
        },
        track: {
            trailMs: 16000,
            maxTrailPoints: 26,
            minPredictionMeters: 35,
            maxPredictionMeters: 160,
            selectionBracketPulse: 0.05,
            threatRingAlpha: 0.22
        }
    },
    sonar2d: {
        btr: {
            scanLineNoiseChance: 0.06,
            scanLineNoiseStepPx: 4,
            scanLineNoiseWidthPx: 2,
            pingWashAlpha: 0.18,
            pingFlashAlpha: 0.3,
            echoAlpha: 0.22
        },
        waterfall: {
            displayGain: 2.15,
            noiseFloor: 0.004,
            logNormalizer: Math.log1p(40)
        }
    }
};

export function resolveVisualMode(mode) {
    if (mode === VISUAL_MODES.ENGAGEMENT) return VISUAL_MODES.ENGAGEMENT;
    if (mode === VISUAL_MODES.ALARM) return VISUAL_MODES.ALARM;
    return VISUAL_MODES.STEALTH;
}

