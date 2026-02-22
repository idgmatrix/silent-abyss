export const DEFAULT_SCENARIO = {
    id: 'default-ocean',
    name: 'Default Ocean Contacts',
    coreTargets: [
        { id: 'target-01', x: -60, z: 20, course: 0.2, speed: 0.8, type: 'SHIP', classId: 'cargo-vessel', rpm: 120, bladeCount: 3, isPatrolling: false },
        { id: 'target-02', distance: 45, angle: Math.PI * 0.75, speed: 0.3, type: 'SUBMARINE', classId: 'triumph-class', rpm: 80, bladeCount: 7, isPatrolling: true, patrolRadius: 60 },
        { id: 'target-03', distance: 30, angle: -Math.PI * 0.25, type: 'BIOLOGICAL', isPatrolling: true, patrolRadius: 30, bioType: 'humpback_song', bioRate: 0.45 },
        { id: 'target-04', x: 40, z: -50, type: 'STATIC', isPatrolling: false },
        { id: 'target-05', distance: 80, angle: Math.PI * 0.4, type: 'BIOLOGICAL', isPatrolling: true, patrolRadius: 15, bioType: 'dolphin_whistle', bioRate: 0.65 },
        { id: 'target-06', x: -90, z: -30, type: 'STATIC', isPatrolling: false },
        { id: 'target-07', distance: 90, angle: Math.PI * 1.6, type: 'SHIP', classId: 'fishery-trawler', speed: 1.2, rpm: 180, isPatrolling: true, patrolRadius: 80 },
        { id: 'target-08', distance: 55, angle: Math.PI * 0.12, type: 'BIOLOGICAL', isPatrolling: true, patrolRadius: 20, bioType: 'chirp', bioRate: 0.35 },
        { id: 'target-09', distance: 105, angle: Math.PI * 1.2, type: 'BIOLOGICAL', isPatrolling: true, patrolRadius: 25, bioType: 'snapping_shrimp', bioRate: 0.8 },
        { id: 'target-10', distance: 65, angle: Math.PI * 1.85, type: 'BIOLOGICAL', isPatrolling: true, patrolRadius: 18, bioType: 'whale_moan', bioRate: 0.28 },
        { id: 'target-11', distance: 42, angle: Math.PI * 1.42, type: 'BIOLOGICAL', isPatrolling: true, patrolRadius: 12, bioType: 'echolocation_click', bioRate: 0.92 }
    ],
    procedural: {
        idStart: 12,
        count: 4,
        types: ['SHIP', 'SUBMARINE', 'BIOLOGICAL', 'STATIC'],
        distanceRange: { min: 30, max: 150 },
        angleRange: { min: 0, max: Math.PI * 2 },
        shipClasses: ['cargo-vessel', 'fishery-trawler', 'oil-tanker'],
        subClasses: ['triumph-class', 'kilo-class'],
        shipSpeedRange: { min: 0.5, max: 1.5 },
        shipRpmRange: { min: 100, max: 250 },
        shipBladeCount: { min: 3, max: 5 },
        subSpeedRange: { min: 0.2, max: 0.6 },
        subRpmRange: { min: 60, max: 120 },
        subBladeCount: 7
    }
};
