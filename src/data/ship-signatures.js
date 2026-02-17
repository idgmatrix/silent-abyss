/**
 * Ship Signature Database
 * Defines acoustic characteristics for various vessel classes.
 */

export const SHIP_SIGNATURES = {
    'triumph-class': {
        name: 'Triumph-class SSN',
        type: 'Submarine',
        targetType: 'SUBMARINE',
        baseRpmFreqRatio: 0.25, // Frequency per RPM
        blades: 7,
        defaults: {
            speed: 0.3,
            rpm: 80,
            bladeCount: 7,
            isPatrolling: true,
            patrolRadius: 60
        },
        harmonics: [
            { freq: 50, label: 'Electrical Hum (50Hz)', intensity: 0.4 },
            { freq: 120, label: 'Cooling Pump', intensity: 0.3 },
            { freq: 440, label: 'Turbine Whine', intensity: 0.25 }
        ],
        description: 'Advanced nuclear attack submarine with a 7-blade skewed propeller.'
    },
    'kilo-class': {
        name: 'Kilo-class SSK',
        type: 'Submarine',
        targetType: 'SUBMARINE',
        baseRpmFreqRatio: 0.22,
        blades: 7,
        defaults: {
            speed: 0.25,
            rpm: 70,
            bladeCount: 7,
            isPatrolling: true,
            patrolRadius: 70
        },
        harmonics: [
            { freq: 45, label: 'Generator Hum', intensity: 0.35 },
            { freq: 105, label: 'Cooling Pump', intensity: 0.25 },
            { freq: 380, label: 'Machinery Whine', intensity: 0.2 }
        ],
        description: 'Diesel-electric submarine with a low-speed acoustic profile.'
    },
    'cargo-vessel': {
        name: 'Cargo Vessel',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.15,
        blades: 4,
        defaults: {
            speed: 0.8,
            rpm: 120,
            bladeCount: 4,
            isPatrolling: true,
            patrolRadius: 90
        },
        harmonics: [
            { freq: 60, label: 'Electrical Hum (60Hz)', intensity: 0.5 },
            { freq: 90, label: 'Diesel Auxiliary', intensity: 0.45 }
        ],
        description: 'Large commercial cargo vessel with a 4-blade propeller and heavy diesel signature.'
    },
    'fishery-trawler': {
        name: 'Fishing Trawler',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.35,
        blades: 3,
        defaults: {
            speed: 1.2,
            rpm: 180,
            bladeCount: 3,
            isPatrolling: true,
            patrolRadius: 80
        },
        harmonics: [
            { freq: 150, label: 'Hydraulic Winch', intensity: 0.35 }
        ],
        description: 'Small fishing vessel with a high-RPM 3-blade propeller.'
    },
    'oil-tanker': {
        name: 'Oil Tanker',
        type: 'Surface',
        targetType: 'SHIP',
        baseRpmFreqRatio: 0.1,
        blades: 5,
        defaults: {
            speed: 0.55,
            rpm: 95,
            bladeCount: 5,
            isPatrolling: true,
            patrolRadius: 110
        },
        harmonics: [
            { freq: 50, label: 'Power Turbine', intensity: 0.45 },
            { freq: 75, label: 'Auxiliary Pump', intensity: 0.35 }
        ],
        description: 'Heavy displacement tanker with low-rpm machinery noise.'
    }
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
        defaults: signature.defaults || {}
    };
}
