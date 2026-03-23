function preset(id, config) {
    return {
        id,
        ...config,
    };
}

const SURFACE = 'SHIP';
const SUB = 'SUBMARINE';
const BIO = 'BIOLOGICAL';
const AIR = 'AIRCRAFT';
const ENV = 'ENVIRONMENTAL';

export const ACOUSTIC_SOURCE_PRESETS = {
    // Aircraft
    'propeller-aircraft': preset('propeller-aircraft', {
        type: AIR,
        bioType: 'fixed_wing_aircraft',
        bioRate: 0.48,
        speed: 2.8,
        rpm: 160,
        bladeCount: 3,
        shaftRate: 2.7,
        load: 0.54,
        rpmJitter: 0.12,
        cavitationLevel: 0.0,
        classProfile: 0
    }),
    'turboprop-aircraft': preset('turboprop-aircraft', {
        type: AIR,
        bioType: 'fixed_wing_aircraft',
        bioRate: 0.72,
        speed: 3.3,
        rpm: 220,
        bladeCount: 4,
        shaftRate: 3.5,
        load: 0.66,
        rpmJitter: 0.09,
        cavitationLevel: 0.0,
        classProfile: 0
    }),
    'jet-aircraft-subsonic': preset('jet-aircraft-subsonic', {
        type: AIR,
        bioType: 'jet_aircraft',
        bioRate: 0.48,
        speed: 4.5
    }),
    'jet-aircraft-supersonic': preset('jet-aircraft-supersonic', {
        type: AIR,
        bioType: 'jet_aircraft',
        bioRate: 0.92,
        speed: 6.5
    }),
    'maritime-patrol-p3': preset('maritime-patrol-p3', {
        type: AIR,
        bioType: 'fixed_wing_aircraft',
        bioRate: 0.64,
        speed: 3.4,
        rpm: 210,
        bladeCount: 4,
        shaftRate: 3.4,
        load: 0.62
    }),
    'maritime-patrol-p8': preset('maritime-patrol-p8', {
        type: AIR,
        bioType: 'jet_aircraft',
        bioRate: 0.58,
        speed: 4.8
    }),
    'helicopter-single-rotor': preset('helicopter-single-rotor', {
        type: AIR,
        bioType: 'helicopter_rotor',
        bioRate: 0.52,
        speed: 1.8
    }),
    'helicopter-hover': preset('helicopter-hover', {
        type: AIR,
        bioType: 'helicopter_rotor',
        bioRate: 0.18,
        speed: 0.1
    }),
    'helicopter-tandem-rotor': preset('helicopter-tandem-rotor', {
        type: AIR,
        bioType: 'helicopter_rotor',
        bioRate: 0.82,
        speed: 2.0
    }),

    // Surface vessels
    'merchant-surface-vessel': preset('merchant-surface-vessel', {
        type: SURFACE,
        classId: 'cargo-vessel'
    }),
    'aircraft-carrier': preset('aircraft-carrier', {
        type: SURFACE,
        classId: 'aircraft-carrier'
    }),
    destroyer: preset('destroyer', {
        type: SURFACE,
        classId: 'destroyer'
    }),
    frigate: preset('frigate', {
        type: SURFACE,
        classId: 'frigate'
    }),
    cruiser: preset('cruiser', {
        type: SURFACE,
        classId: 'cruiser'
    }),
    'submarine-tender': preset('submarine-tender', {
        type: SURFACE,
        classId: 'submarine-tender'
    }),
    'replenishment-vessel': preset('replenishment-vessel', {
        type: SURFACE,
        classId: 'replenishment-vessel'
    }),
    'bulk-carrier': preset('bulk-carrier', {
        type: SURFACE,
        classId: 'bulk-carrier'
    }),
    tanker: preset('tanker', {
        type: SURFACE,
        classId: 'oil-tanker'
    }),
    'container-ship': preset('container-ship', {
        type: SURFACE,
        classId: 'container-ship'
    }),
    'fishing-vessel': preset('fishing-vessel', {
        type: SURFACE,
        classId: 'fishery-trawler'
    }),
    tugboat: preset('tugboat', {
        type: SURFACE,
        classId: 'tugboat'
    }),
    icebreaker: preset('icebreaker', {
        type: SURFACE,
        classId: 'icebreaker'
    }),

    // Submarines
    'diesel-electric-submarine-battery': preset('diesel-electric-submarine-battery', {
        type: SUB,
        classId: 'diesel-electric-battery-submarine'
    }),
    'diesel-electric-submarine-snorkeling': preset('diesel-electric-submarine-snorkeling', {
        type: SUB,
        classId: 'diesel-electric-snorkeling-submarine'
    }),
    'nuclear-submarine': preset('nuclear-submarine', {
        type: SUB,
        classId: 'triumph-class'
    }),
    'nuclear-submarine-natural-circulation': preset('nuclear-submarine-natural-circulation', {
        type: SUB,
        classId: 'nuclear-natural-circulation-submarine'
    }),
    'pump-jet-submarine': preset('pump-jet-submarine', {
        type: SUB,
        classId: 'pump-jet-submarine'
    }),

    // Marine life
    'blue-whale': preset('blue-whale', {
        type: BIO,
        bioType: 'blue_whale',
        bioRate: 0.18,
        speed: 0.12
    }),
    'fin-whale': preset('fin-whale', {
        type: BIO,
        bioType: 'fin_whale',
        bioRate: 0.34,
        speed: 0.14
    }),
    'humpback-whale': preset('humpback-whale', {
        type: BIO,
        bioType: 'humpback_song',
        bioRate: 0.46,
        speed: 0.16
    }),
    'minke-whale': preset('minke-whale', {
        type: BIO,
        bioType: 'minke_pulse',
        bioRate: 0.62,
        speed: 0.18
    }),
    'sperm-whale': preset('sperm-whale', {
        type: BIO,
        bioType: 'sperm_whale_click',
        bioRate: 0.64,
        speed: 0.22
    }),
    orca: preset('orca', {
        type: BIO,
        bioType: 'orca_call',
        bioRate: 0.58,
        speed: 0.45
    }),
    beluga: preset('beluga', {
        type: BIO,
        bioType: 'beluga_call',
        bioRate: 0.74,
        speed: 0.32
    }),
    'common-dolphin': preset('common-dolphin', {
        type: BIO,
        bioType: 'dolphin_whistle',
        bioRate: 0.72,
        speed: 0.7
    }),
    'bottlenose-dolphin': preset('bottlenose-dolphin', {
        type: BIO,
        bioType: 'dolphin_whistle',
        bioRate: 0.66,
        speed: 0.6
    }),
    'dolphin-school': preset('dolphin-school', {
        type: BIO,
        bioType: 'dolphin_school',
        bioRate: 0.78,
        speed: 0.8
    }),
    'snapping-shrimp-field': preset('snapping-shrimp-field', {
        type: BIO,
        bioType: 'snapping_shrimp',
        bioRate: 0.86
    }),
    drumfish: preset('drumfish', {
        type: BIO,
        bioType: 'fish_chorus',
        bioRate: 0.44
    }),
    croaker: preset('croaker', {
        type: BIO,
        bioType: 'fish_chorus',
        bioRate: 0.52
    }),
    'herring-school': preset('herring-school', {
        type: BIO,
        bioType: 'herring_school',
        bioRate: 0.48
    }),
    'mackerel-school': preset('mackerel-school', {
        type: BIO,
        bioType: 'herring_school',
        bioRate: 0.58
    }),

    // Environmental
    'ocean-ambient-sea-state': preset('ocean-ambient-sea-state', {
        type: ENV,
        bioType: 'ambient_ocean',
        bioRate: 0.36
    }),
    'distant-shipping-noise': preset('distant-shipping-noise', {
        type: ENV,
        bioType: 'ambient_ocean',
        bioRate: 0.58
    }),
    'seismic-microtremor': preset('seismic-microtremor', {
        type: ENV,
        bioType: 'geological_noise',
        bioRate: 0.12
    }),
    rain: preset('rain', {
        type: ENV,
        bioType: 'precipitation',
        bioRate: 0.42
    }),
    hail: preset('hail', {
        type: ENV,
        bioType: 'precipitation',
        bioRate: 0.86
    }),
    'breaking-waves': preset('breaking-waves', {
        type: ENV,
        bioType: 'ambient_ocean',
        bioRate: 0.92
    }),
    'ice-cracking': preset('ice-cracking', {
        type: ENV,
        bioType: 'ice_noise',
        bioRate: 0.34
    }),
    'ice-collision': preset('ice-collision', {
        type: ENV,
        bioType: 'ice_noise',
        bioRate: 0.56
    }),
    'ice-keel-scraping': preset('ice-keel-scraping', {
        type: ENV,
        bioType: 'ice_noise',
        bioRate: 0.74
    }),
    'iceberg-calving': preset('iceberg-calving', {
        type: ENV,
        bioType: 'ice_noise',
        bioRate: 0.94
    }),
    'underwater-volcano': preset('underwater-volcano', {
        type: ENV,
        bioType: 'geological_noise',
        bioRate: 0.58
    }),
    'hydrothermal-vent': preset('hydrothermal-vent', {
        type: ENV,
        bioType: 'geological_noise',
        bioRate: 0.42
    }),
    earthquake: preset('earthquake', {
        type: ENV,
        bioType: 'geological_noise',
        bioRate: 0.9
    })
};

export const ACOUSTIC_SOURCE_PRESET_IDS = Object.freeze(Object.keys(ACOUSTIC_SOURCE_PRESETS));

export function getAcousticSourcePreset(id) {
    if (typeof id !== 'string') {
        return null;
    }
    return ACOUSTIC_SOURCE_PRESETS[id.trim().toLowerCase()] || null;
}

export function listAcousticSourcePresets() {
    return ACOUSTIC_SOURCE_PRESET_IDS.slice();
}
