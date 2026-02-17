/**
 * Ship Signature Database
 * Defines acoustic characteristics for various vessel classes.
 */

export const SHIP_SIGNATURES = {
    'triumph-class': {
        name: 'Triumph-class SSN',
        type: 'Submarine',
        baseRpmFreqRatio: 0.25, // Frequency per RPM
        blades: 7,
        harmonics: [
            { freq: 50, label: 'Electrical Hum (50Hz)', intensity: 0.4 },
            { freq: 120, label: 'Cooling Pump', intensity: 0.3 },
            { freq: 440, label: 'Turbine Whine', intensity: 0.25 }
        ],
        description: 'Advanced nuclear attack submarine with a 7-blade skewed propeller.'
    },
    'cargo-vessel': {
        name: 'Cargo Vessel',
        type: 'Surface',
        baseRpmFreqRatio: 0.15,
        blades: 4,
        harmonics: [
            { freq: 60, label: 'Electrical Hum (60Hz)', intensity: 0.5 },
            { freq: 90, label: 'Diesel Auxiliary', intensity: 0.45 }
        ],
        description: 'Large commercial cargo vessel with a 4-blade propeller and heavy diesel signature.'
    },
    'fishery-trawler': {
        name: 'Fishing Trawler',
        type: 'Surface',
        baseRpmFreqRatio: 0.35,
        blades: 3,
        harmonics: [
            { freq: 150, label: 'Hydraulic Winch', intensity: 0.35 }
        ],
        description: 'Small fishing vessel with a high-RPM 3-blade propeller.'
    }
};

/**
 * Gets a signature by class ID or returns a default.
 */
export function getSignature(classId) {
    return SHIP_SIGNATURES[classId] || SHIP_SIGNATURES['cargo-vessel'];
}
