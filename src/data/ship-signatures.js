/**
 * Ship Signature Database
 * Defines baseline acoustic and propulsion characteristics for vessel classes.
 */

function signature(config) {
    return config;
}

export const SHIP_SIGNATURES = {
    'triumph-class': signature({
        name: 'Triumph-class SSN',
        type: 'Submarine',
        targetType: 'SUBMARINE',
        baseRpmFreqRatio: 0.25,
        blades: 7,
        defaults: {
            speed: 0.3,
            rpm: 80,
            bladeCount: 7,
            shaftRate: 80 / 60,
            isPatrolling: true,
            patrolRadius: 60
        },
        acousticPreset: {
            classProfile: 1,
            loadBase: 0.24,
            loadScale: 0.58,
            jitterBase: 0.05,
            jitterScale: 0.45,
            cavitationBase: 0.08,
            cavitationScale: 0.3
        },
        harmonics: [
            { freq: 50, label: 'Electrical Hum (50Hz)', intensity: 0.4 },
            { freq: 120, label: 'Cooling Pump', intensity: 0.3 },
            { freq: 440, label: 'Turbine Whine', intensity: 0.25 }
        ],
        description: 'Advanced nuclear attack submarine with a 7-blade skewed propeller.'
    }),
    'kilo-class': signature({
        name: 'Kilo-class SSK',
        type: 'Submarine',
        targetType: 'SUBMARINE',
        baseRpmFreqRatio: 0.22,
        blades: 7,
        defaults: {
            speed: 0.25,
            rpm: 70,
            bladeCount: 7,
            shaftRate: 70 / 60,
            isPatrolling: true,
            patrolRadius: 70
        },
        acousticPreset: {
            classProfile: 1,
            loadBase: 0.22,
            loadScale: 0.52,
            jitterBase: 0.04,
            jitterScale: 0.42,
            cavitationBase: 0.05,
            cavitationScale: 0.22
        },
        harmonics: [
            { freq: 45, label: 'Generator Hum', intensity: 0.35 },
            { freq: 105, label: 'Cooling Pump', intensity: 0.25 },
            { freq: 380, label: 'Machinery Whine', intensity: 0.2 }
        ],
        description: 'Diesel-electric submarine with a low-speed acoustic profile.'
    }),
    'diesel-electric-battery-submarine': signature({
        name: 'Diesel-electric submarine (battery)',
        type: 'Submarine',
        targetType: 'SUBMARINE',
        baseRpmFreqRatio: 0.2,
        blades: 7,
        defaults: {
            speed: 0.18,
            rpm: 48,
            bladeCount: 7,
            shaftRate: 0.8,
            isPatrolling: true,
            patrolRadius: 55
        },
        acousticPreset: {
            classProfile: 1,
            loadBase: 0.12,
            loadScale: 0.28,
            jitterBase: 0.02,
            jitterScale: 0.18,
            cavitationBase: 0.02,
            cavitationScale: 0.08
        },
        harmonics: [
            { freq: 45, label: 'Motor Rotation Line', intensity: 0.24 },
            { freq: 95, label: 'Cooling Pump Burst', intensity: 0.16 },
            { freq: 22, label: 'Hull Creak', intensity: 0.1 }
        ],
        description: 'Battery propulsion profile with minimal cavitation and low machinery noise.'
    }),
    'diesel-electric-snorkeling-submarine': signature({
        name: 'Diesel-electric submarine (snorkeling)',
        type: 'Submarine',
        targetType: 'SUBMARINE',
        baseRpmFreqRatio: 0.24,
        blades: 7,
        defaults: {
            speed: 0.28,
            rpm: 110,
            bladeCount: 7,
            shaftRate: 1.8,
            isPatrolling: true,
            patrolRadius: 55
        },
        acousticPreset: {
            classProfile: 1,
            loadBase: 0.34,
            loadScale: 0.62,
            jitterBase: 0.06,
            jitterScale: 0.38,
            cavitationBase: 0.1,
            cavitationScale: 0.24
        },
        harmonics: [
            { freq: 55, label: 'Diesel Harmonic', intensity: 0.38 },
            { freq: 120, label: 'Snorkel Exhaust Bubble Noise', intensity: 0.22 },
            { freq: 210, label: 'Generator Set', intensity: 0.18 }
        ],
        description: 'Snorkeling diesel-electric profile with elevated detectability.'
    }),
    'nuclear-natural-circulation-submarine': signature({
        name: 'Nuclear submarine (natural circulation)',
        type: 'Submarine',
        targetType: 'SUBMARINE',
        baseRpmFreqRatio: 0.2,
        blades: 7,
        defaults: {
            speed: 0.16,
            rpm: 55,
            bladeCount: 7,
            shaftRate: 0.92,
            isPatrolling: true,
            patrolRadius: 60
        },
        acousticPreset: {
            classProfile: 1,
            loadBase: 0.18,
            loadScale: 0.3,
            jitterBase: 0.03,
            jitterScale: 0.2,
            cavitationBase: 0.03,
            cavitationScale: 0.1
        },
        harmonics: [
            { freq: 60, label: 'Residual Turbine Line', intensity: 0.2 },
            { freq: 135, label: 'Convective Flow', intensity: 0.12 }
        ],
        description: 'Low-speed natural circulation mode with subdued coolant-pump contribution.'
    }),
    'pump-jet-submarine': signature({
        name: 'Pump-jet submarine',
        type: 'Submarine',
        targetType: 'SUBMARINE',
        baseRpmFreqRatio: 0.21,
        blades: 9,
        defaults: {
            speed: 0.34,
            rpm: 95,
            bladeCount: 9,
            shaftRate: 1.5,
            isPatrolling: true,
            patrolRadius: 65
        },
        acousticPreset: {
            classProfile: 1,
            loadBase: 0.28,
            loadScale: 0.48,
            jitterBase: 0.04,
            jitterScale: 0.26,
            cavitationBase: 0.04,
            cavitationScale: 0.12
        },
        harmonics: [
            { freq: 38, label: 'Pump-jet Flow Noise', intensity: 0.3 },
            { freq: 110, label: 'Coolant Pump', intensity: 0.24 },
            { freq: 310, label: 'Turbogenerator', intensity: 0.22 }
        ],
        description: 'Suppressed blade-rate signature with stronger flow-noise component.'
    }),
    'cargo-vessel': signature({
        name: 'Cargo Vessel',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.15,
        blades: 4,
        defaults: {
            speed: 0.8,
            rpm: 120,
            bladeCount: 4,
            shaftRate: 120 / 60,
            isPatrolling: true,
            patrolRadius: 90
        },
        acousticPreset: {
            classProfile: 2,
            loadBase: 0.32,
            loadScale: 0.72,
            jitterBase: 0.08,
            jitterScale: 0.62,
            cavitationBase: 0.24,
            cavitationScale: 0.66
        },
        harmonics: [
            { freq: 60, label: 'Electrical Hum (60Hz)', intensity: 0.5 },
            { freq: 90, label: 'Diesel Auxiliary', intensity: 0.45 }
        ],
        description: 'Large commercial cargo vessel with a 4-blade propeller and heavy diesel signature.'
    }),
    'bulk-carrier': signature({
        name: 'Bulk Carrier',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.11,
        blades: 5,
        defaults: {
            speed: 0.55,
            rpm: 85,
            bladeCount: 5,
            shaftRate: 1.42,
            isPatrolling: true,
            patrolRadius: 110
        },
        acousticPreset: {
            classProfile: 2,
            loadBase: 0.28,
            loadScale: 0.56,
            jitterBase: 0.05,
            jitterScale: 0.36,
            cavitationBase: 0.14,
            cavitationScale: 0.34
        },
        harmonics: [
            { freq: 42, label: 'Slow Propeller Line', intensity: 0.5 },
            { freq: 60, label: 'Generator Bank', intensity: 0.34 }
        ],
        description: 'Slow merchant profile dominated by strong low-frequency propulsion.'
    }),
    'oil-tanker': signature({
        name: 'Oil Tanker',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.1,
        blades: 5,
        defaults: {
            speed: 0.55,
            rpm: 95,
            bladeCount: 5,
            shaftRate: 95 / 60,
            isPatrolling: true,
            patrolRadius: 110
        },
        acousticPreset: {
            classProfile: 2,
            loadBase: 0.3,
            loadScale: 0.64,
            jitterBase: 0.06,
            jitterScale: 0.48,
            cavitationBase: 0.16,
            cavitationScale: 0.48
        },
        harmonics: [
            { freq: 50, label: 'Power Turbine', intensity: 0.45 },
            { freq: 75, label: 'Auxiliary Pump', intensity: 0.35 }
        ],
        description: 'Heavy displacement tanker with low-rpm machinery noise.'
    }),
    'container-ship': signature({
        name: 'Container Ship',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.14,
        blades: 5,
        defaults: {
            speed: 0.92,
            rpm: 130,
            bladeCount: 5,
            shaftRate: 2.16,
            isPatrolling: true,
            patrolRadius: 100
        },
        acousticPreset: {
            classProfile: 2,
            loadBase: 0.34,
            loadScale: 0.7,
            jitterBase: 0.08,
            jitterScale: 0.54,
            cavitationBase: 0.2,
            cavitationScale: 0.58
        },
        harmonics: [
            { freq: 60, label: 'Generator Line', intensity: 0.42 },
            { freq: 120, label: 'Generator Harmonic', intensity: 0.28 },
            { freq: 95, label: 'Main Diesel', intensity: 0.31 }
        ],
        description: 'Medium-fast merchant profile with prominent generator-line content.'
    }),
    'fishery-trawler': signature({
        name: 'Fishing Trawler',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.35,
        blades: 3,
        defaults: {
            speed: 1.2,
            rpm: 180,
            bladeCount: 3,
            shaftRate: 180 / 60,
            isPatrolling: true,
            patrolRadius: 80
        },
        acousticPreset: {
            classProfile: 3,
            loadBase: 0.38,
            loadScale: 0.86,
            jitterBase: 0.11,
            jitterScale: 0.82,
            cavitationBase: 0.34,
            cavitationScale: 0.82
        },
        harmonics: [
            { freq: 150, label: 'Hydraulic Winch', intensity: 0.35 }
        ],
        description: 'Small fishing vessel with a high-RPM 3-blade propeller.'
    }),
    tugboat: signature({
        name: 'Tugboat',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.18,
        blades: 4,
        defaults: {
            speed: 0.45,
            rpm: 100,
            bladeCount: 4,
            shaftRate: 1.66,
            isPatrolling: true,
            patrolRadius: 60
        },
        acousticPreset: {
            classProfile: 3,
            loadBase: 0.46,
            loadScale: 0.7,
            jitterBase: 0.08,
            jitterScale: 0.44,
            cavitationBase: 0.28,
            cavitationScale: 0.46
        },
        harmonics: [
            { freq: 36, label: 'Strong Shaft Rate', intensity: 0.42 },
            { freq: 96, label: 'High Torque Gearbox', intensity: 0.26 }
        ],
        description: 'High-torque harbor tug with pronounced shaft-rate dominance.'
    }),
    'submarine-tender': signature({
        name: 'Submarine Tender',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.12,
        blades: 5,
        defaults: {
            speed: 0.4,
            rpm: 78,
            bladeCount: 5,
            shaftRate: 1.3,
            isPatrolling: true,
            patrolRadius: 85
        },
        acousticPreset: {
            classProfile: 2,
            loadBase: 0.24,
            loadScale: 0.42,
            jitterBase: 0.05,
            jitterScale: 0.28,
            cavitationBase: 0.08,
            cavitationScale: 0.18
        },
        harmonics: [
            { freq: 60, label: 'Auxiliary Generator Bank', intensity: 0.36 },
            { freq: 86, label: 'Machinery Dominant Low Speed', intensity: 0.28 }
        ],
        description: 'Low-speed auxiliary-heavy support vessel.'
    }),
    'replenishment-vessel': signature({
        name: 'Replenishment Vessel',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.13,
        blades: 5,
        defaults: {
            speed: 0.55,
            rpm: 98,
            bladeCount: 5,
            shaftRate: 1.62,
            isPatrolling: true,
            patrolRadius: 90
        },
        acousticPreset: {
            classProfile: 2,
            loadBase: 0.28,
            loadScale: 0.5,
            jitterBase: 0.06,
            jitterScale: 0.3,
            cavitationBase: 0.12,
            cavitationScale: 0.24
        },
        harmonics: [
            { freq: 60, label: 'Generator Line', intensity: 0.34 },
            { freq: 92, label: 'Machinery Tone', intensity: 0.26 }
        ],
        description: 'Support ship with moderate propulsion noise and strong auxiliaries.'
    }),
    'aircraft-carrier': signature({
        name: 'Aircraft Carrier',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.12,
        blades: 5,
        defaults: {
            speed: 1.0,
            rpm: 125,
            bladeCount: 5,
            shaftRate: 2.1,
            isPatrolling: true,
            patrolRadius: 140
        },
        acousticPreset: {
            classProfile: 2,
            loadBase: 0.4,
            loadScale: 0.82,
            jitterBase: 0.06,
            jitterScale: 0.38,
            cavitationBase: 0.2,
            cavitationScale: 0.54
        },
        harmonics: [
            { freq: 60, label: 'Generator Bank', intensity: 0.55 },
            { freq: 120, label: 'Generator Harmonic', intensity: 0.34 },
            { freq: 28, label: 'Multi-shaft Propeller', intensity: 0.4 }
        ],
        description: 'Large multi-shaft capital ship with strong generator-line content.'
    }),
    destroyer: signature({
        name: 'Destroyer',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.22,
        blades: 5,
        defaults: {
            speed: 1.45,
            rpm: 180,
            bladeCount: 5,
            shaftRate: 3,
            isPatrolling: true,
            patrolRadius: 120
        },
        acousticPreset: {
            classProfile: 2,
            loadBase: 0.5,
            loadScale: 0.9,
            jitterBase: 0.08,
            jitterScale: 0.52,
            cavitationBase: 0.34,
            cavitationScale: 0.86
        },
        harmonics: [
            { freq: 70, label: 'Gas Turbine Generator', intensity: 0.42 },
            { freq: 180, label: 'Active Sonar Transient', intensity: 0.2 }
        ],
        description: 'High-speed warship with rapid cavitation onset.'
    }),
    frigate: signature({
        name: 'Frigate',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.2,
        blades: 5,
        defaults: {
            speed: 1.2,
            rpm: 155,
            bladeCount: 5,
            shaftRate: 2.58,
            isPatrolling: true,
            patrolRadius: 110
        },
        acousticPreset: {
            classProfile: 2,
            loadBase: 0.42,
            loadScale: 0.82,
            jitterBase: 0.07,
            jitterScale: 0.46,
            cavitationBase: 0.28,
            cavitationScale: 0.72
        },
        harmonics: [
            { freq: 64, label: 'Gas Turbine Line', intensity: 0.36 },
            { freq: 118, label: 'Auxiliary Pump', intensity: 0.2 }
        ],
        description: 'Escort warship profile between merchant and destroyer regimes.'
    }),
    cruiser: signature({
        name: 'Cruiser',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.18,
        blades: 5,
        defaults: {
            speed: 1.15,
            rpm: 145,
            bladeCount: 5,
            shaftRate: 2.42,
            isPatrolling: true,
            patrolRadius: 115
        },
        acousticPreset: {
            classProfile: 2,
            loadBase: 0.4,
            loadScale: 0.76,
            jitterBase: 0.07,
            jitterScale: 0.42,
            cavitationBase: 0.24,
            cavitationScale: 0.64
        },
        harmonics: [
            { freq: 60, label: 'Generator Line', intensity: 0.38 },
            { freq: 102, label: 'Machinery Tone', intensity: 0.22 }
        ],
        description: 'Intermediate large combatant acoustic profile.'
    }),
    icebreaker: signature({
        name: 'Icebreaker',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.16,
        blades: 4,
        defaults: {
            speed: 0.5,
            rpm: 115,
            bladeCount: 4,
            shaftRate: 1.9,
            isPatrolling: true,
            patrolRadius: 80
        },
        acousticPreset: {
            classProfile: 3,
            loadBase: 0.5,
            loadScale: 0.7,
            jitterBase: 0.12,
            jitterScale: 0.72,
            cavitationBase: 0.24,
            cavitationScale: 0.52
        },
        harmonics: [
            { freq: 55, label: 'Hull-Ice Contact', intensity: 0.38 },
            { freq: 95, label: 'Irregular Broadband Bursts', intensity: 0.3 }
        ],
        description: 'Heavy hull interaction and irregular burst-dominated profile for ice transit.'
    })
};

/**
 * Gets a signature by class ID or returns a default.
 */
export function getSignature(classId) {
    return SHIP_SIGNATURES[classId] || SHIP_SIGNATURES['cargo-vessel'];
}

/**
 * Returns class profile used by runtime target config normalization.
 */
export function getClassProfile(classId) {
    const signature = getSignature(classId);
    return {
        classId,
        type: signature.targetType || 'SHIP',
        defaults: signature.defaults || {},
        acousticPreset: signature.acousticPreset || null
    };
}

export function getAcousticPreset(classId) {
    return getSignature(classId).acousticPreset || null;
}
