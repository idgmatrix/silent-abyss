import { getClassProfile } from './ship-signatures.js';
import { DEFAULT_SCENARIO } from './scenarios/default-scenario.js';

const TARGET_TYPE_DEFAULTS = {
    SHIP: { type: 'SHIP', isPatrolling: true },
    SUBMARINE: { type: 'SUBMARINE', isPatrolling: true },
    BIOLOGICAL: { type: 'BIOLOGICAL', isPatrolling: true },
    STATIC: { type: 'STATIC', isPatrolling: false },
    TORPEDO: { type: 'TORPEDO', isPatrolling: true }
};

const ACOUSTIC_DEFAULTS_BY_TYPE = {
    SHIP: { rpm: 120, bladeCount: 3 },
    SUBMARINE: { rpm: 90, bladeCount: 7 },
    BIOLOGICAL: { rpm: undefined, bladeCount: undefined },
    STATIC: { rpm: undefined, bladeCount: undefined },
    TORPEDO: { rpm: 600, bladeCount: 4 }
};

const ACOUSTIC_LIMITS = {
    rpm: { min: 0, max: 2000 },
    bladeCount: { min: 0, max: 12 },
    shaftRate: { min: 0, max: 120 }
};

const BIO_SOUND_TYPES = ['chirp', 'snapping_shrimp', 'whale_moan', 'dolphin_whistle', 'echolocation_click', 'humpback_song'];
const BIO_RATE_LIMITS = { min: 0, max: 1 };

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`Scenario validation error: ${message}`);
    }
}

function randomInRange(random, min, max) {
    return min + random() * (max - min);
}

function randomIntInRangeInclusive(random, min, max) {
    return min + Math.floor(random() * (max - min + 1));
}

function normalizeTargetConfig(target) {
    const classProfile = target.classId ? getClassProfile(target.classId) : null;
    const inferredType = target.type ?? classProfile?.type ?? 'SHIP';
    const typeDefaults = TARGET_TYPE_DEFAULTS[inferredType] ?? TARGET_TYPE_DEFAULTS.SHIP;

    const merged = {
        ...typeDefaults,
        ...(classProfile?.defaults ?? {}),
        ...target,
        type: inferredType
    };

    return normalizeAcousticTargetConfig(merged);
}

function normalizeAcousticTargetConfig(target) {
    const type = target.type ?? 'SHIP';
    const defaults = ACOUSTIC_DEFAULTS_BY_TYPE[type] ?? ACOUSTIC_DEFAULTS_BY_TYPE.SHIP;
    const isPropulsionTarget = type === 'SHIP' || type === 'SUBMARINE' || type === 'TORPEDO';
    const rpmRaw = Number.isFinite(target.rpm) ? target.rpm : defaults.rpm;
    const bladeRaw = Number.isFinite(target.bladeCount) ? target.bladeCount : defaults.bladeCount;

    const normalized = { ...target };
    if (typeof target.bioType === 'string') {
        const normalizedBioType = target.bioType.trim().toLowerCase();
        if (BIO_SOUND_TYPES.includes(normalizedBioType)) {
            normalized.bioType = normalizedBioType;
        }
    }

    if (Number.isFinite(target.bioRate)) {
        normalized.bioRate = Math.max(BIO_RATE_LIMITS.min, Math.min(BIO_RATE_LIMITS.max, target.bioRate));
    }

    if (isPropulsionTarget) {
        const rpm = Math.max(ACOUSTIC_LIMITS.rpm.min, Math.min(ACOUSTIC_LIMITS.rpm.max, rpmRaw));
        const bladeCount = Math.max(
            ACOUSTIC_LIMITS.bladeCount.min,
            Math.min(ACOUSTIC_LIMITS.bladeCount.max, Math.round(bladeRaw))
        );
        const shaftRateInput = Number.isFinite(target.shaftRate) ? target.shaftRate : rpm / 60;
        const shaftRate = Math.max(
            ACOUSTIC_LIMITS.shaftRate.min,
            Math.min(ACOUSTIC_LIMITS.shaftRate.max, shaftRateInput)
        );
        normalized.rpm = rpm;
        normalized.bladeCount = bladeCount;
        normalized.shaftRate = shaftRate;
    } else {
        if (Number.isFinite(target.rpm)) {
            normalized.rpm = Math.max(ACOUSTIC_LIMITS.rpm.min, Math.min(ACOUSTIC_LIMITS.rpm.max, target.rpm));
        }
        if (Number.isFinite(target.bladeCount)) {
            normalized.bladeCount = Math.max(
                ACOUSTIC_LIMITS.bladeCount.min,
                Math.min(ACOUSTIC_LIMITS.bladeCount.max, Math.round(target.bladeCount))
            );
        }
        if (Number.isFinite(target.shaftRate)) {
            normalized.shaftRate = Math.max(
                ACOUSTIC_LIMITS.shaftRate.min,
                Math.min(ACOUSTIC_LIMITS.shaftRate.max, target.shaftRate)
            );
        }
    }

    return normalized;
}

function validateTarget(target, index, context) {
    assert(isObject(target), `${context}[${index}] must be an object`);
    assert(typeof target.id === 'string' && target.id.length > 0, `${context}[${index}].id is required`);

    const hasCartesian = Number.isFinite(target.x) && Number.isFinite(target.z);
    const hasPolar = Number.isFinite(target.distance) && Number.isFinite(target.angle);
    assert(hasCartesian || hasPolar, `${context}[${index}] requires either (x,z) or (distance,angle)`);

    if (target.type !== undefined) {
        assert(Object.hasOwn(TARGET_TYPE_DEFAULTS, target.type), `${context}[${index}].type must be one of ${Object.keys(TARGET_TYPE_DEFAULTS).join(', ')}`);
    }

    if (target.rpm !== undefined) {
        assert(Number.isFinite(target.rpm), `${context}[${index}].rpm must be numeric`);
        assert(target.rpm >= ACOUSTIC_LIMITS.rpm.min && target.rpm <= ACOUSTIC_LIMITS.rpm.max, `${context}[${index}].rpm must be in ${ACOUSTIC_LIMITS.rpm.min}-${ACOUSTIC_LIMITS.rpm.max}`);
    }
    if (target.bladeCount !== undefined) {
        assert(Number.isFinite(target.bladeCount), `${context}[${index}].bladeCount must be numeric`);
        assert(target.bladeCount >= ACOUSTIC_LIMITS.bladeCount.min && target.bladeCount <= ACOUSTIC_LIMITS.bladeCount.max, `${context}[${index}].bladeCount must be in ${ACOUSTIC_LIMITS.bladeCount.min}-${ACOUSTIC_LIMITS.bladeCount.max}`);
    }
    if (target.shaftRate !== undefined) {
        assert(Number.isFinite(target.shaftRate), `${context}[${index}].shaftRate must be numeric`);
        assert(target.shaftRate >= ACOUSTIC_LIMITS.shaftRate.min && target.shaftRate <= ACOUSTIC_LIMITS.shaftRate.max, `${context}[${index}].shaftRate must be in ${ACOUSTIC_LIMITS.shaftRate.min}-${ACOUSTIC_LIMITS.shaftRate.max}`);
    }
    if (target.bioType !== undefined) {
        assert(typeof target.bioType === 'string', `${context}[${index}].bioType must be a string`);
        const normalizedBioType = target.bioType.trim().toLowerCase();
        assert(BIO_SOUND_TYPES.includes(normalizedBioType), `${context}[${index}].bioType must be one of ${BIO_SOUND_TYPES.join(', ')}`);
    }
    if (target.bioRate !== undefined) {
        assert(Number.isFinite(target.bioRate), `${context}[${index}].bioRate must be numeric`);
        assert(target.bioRate >= BIO_RATE_LIMITS.min && target.bioRate <= BIO_RATE_LIMITS.max, `${context}[${index}].bioRate must be in ${BIO_RATE_LIMITS.min}-${BIO_RATE_LIMITS.max}`);
    }
}

function validateProceduralConfig(procedural) {
    assert(isObject(procedural), 'procedural section is required');
    assert(Number.isInteger(procedural.idStart) && procedural.idStart > 0, 'procedural.idStart must be a positive integer');
    assert(Number.isInteger(procedural.count) && procedural.count >= 0, 'procedural.count must be a non-negative integer');
    assert(Array.isArray(procedural.types) && procedural.types.length > 0, 'procedural.types must be a non-empty array');

    for (const type of procedural.types) {
        assert(Object.hasOwn(TARGET_TYPE_DEFAULTS, type), `procedural.types contains invalid type: ${type}`);
    }

    assert(isObject(procedural.distanceRange), 'procedural.distanceRange is required');
    assert(Number.isFinite(procedural.distanceRange.min), 'procedural.distanceRange.min must be numeric');
    assert(Number.isFinite(procedural.distanceRange.max), 'procedural.distanceRange.max must be numeric');
    assert(procedural.distanceRange.max > procedural.distanceRange.min, 'procedural.distanceRange.max must be greater than min');

    assert(isObject(procedural.angleRange), 'procedural.angleRange is required');
    assert(Number.isFinite(procedural.angleRange.min), 'procedural.angleRange.min must be numeric');
    assert(Number.isFinite(procedural.angleRange.max), 'procedural.angleRange.max must be numeric');
    assert(procedural.angleRange.max > procedural.angleRange.min, 'procedural.angleRange.max must be greater than min');

    assert(Array.isArray(procedural.shipClasses) && procedural.shipClasses.length > 0, 'procedural.shipClasses must be a non-empty array');
    assert(Array.isArray(procedural.subClasses) && procedural.subClasses.length > 0, 'procedural.subClasses must be a non-empty array');

    assert(isObject(procedural.shipSpeedRange), 'procedural.shipSpeedRange is required');
    assert(isObject(procedural.shipRpmRange), 'procedural.shipRpmRange is required');
    assert(isObject(procedural.shipBladeCount), 'procedural.shipBladeCount is required');
    assert(Number.isFinite(procedural.shipRpmRange.min) && Number.isFinite(procedural.shipRpmRange.max), 'procedural.shipRpmRange min/max must be numeric');
    assert(procedural.shipRpmRange.max >= procedural.shipRpmRange.min, 'procedural.shipRpmRange.max must be >= min');
    assert(procedural.shipRpmRange.min >= ACOUSTIC_LIMITS.rpm.min && procedural.shipRpmRange.max <= ACOUSTIC_LIMITS.rpm.max, `procedural.shipRpmRange must be in ${ACOUSTIC_LIMITS.rpm.min}-${ACOUSTIC_LIMITS.rpm.max}`);
    assert(Number.isInteger(procedural.shipBladeCount.min) && Number.isInteger(procedural.shipBladeCount.max), 'procedural.shipBladeCount min/max must be integers');
    assert(procedural.shipBladeCount.max >= procedural.shipBladeCount.min, 'procedural.shipBladeCount.max must be >= min');
    assert(procedural.shipBladeCount.min >= ACOUSTIC_LIMITS.bladeCount.min && procedural.shipBladeCount.max <= ACOUSTIC_LIMITS.bladeCount.max, `procedural.shipBladeCount must be in ${ACOUSTIC_LIMITS.bladeCount.min}-${ACOUSTIC_LIMITS.bladeCount.max}`);

    assert(isObject(procedural.subSpeedRange), 'procedural.subSpeedRange is required');
    assert(isObject(procedural.subRpmRange), 'procedural.subRpmRange is required');
    assert(Number.isInteger(procedural.subBladeCount), 'procedural.subBladeCount must be an integer');
    assert(Number.isFinite(procedural.subRpmRange.min) && Number.isFinite(procedural.subRpmRange.max), 'procedural.subRpmRange min/max must be numeric');
    assert(procedural.subRpmRange.max >= procedural.subRpmRange.min, 'procedural.subRpmRange.max must be >= min');
    assert(procedural.subRpmRange.min >= ACOUSTIC_LIMITS.rpm.min && procedural.subRpmRange.max <= ACOUSTIC_LIMITS.rpm.max, `procedural.subRpmRange must be in ${ACOUSTIC_LIMITS.rpm.min}-${ACOUSTIC_LIMITS.rpm.max}`);
    assert(procedural.subBladeCount >= ACOUSTIC_LIMITS.bladeCount.min && procedural.subBladeCount <= ACOUSTIC_LIMITS.bladeCount.max, `procedural.subBladeCount must be in ${ACOUSTIC_LIMITS.bladeCount.min}-${ACOUSTIC_LIMITS.bladeCount.max}`);
}

export function validateScenarioDefinition(scenario) {
    assert(isObject(scenario), 'scenario must be an object');
    assert(typeof scenario.id === 'string' && scenario.id.length > 0, 'scenario.id is required');
    assert(Array.isArray(scenario.coreTargets), 'scenario.coreTargets must be an array');

    scenario.coreTargets.forEach((target, index) => {
        validateTarget(target, index, 'scenario.coreTargets');
    });

    validateProceduralConfig(scenario.procedural);

    return true;
}

function generateProceduralTargets(procedural, random) {
    const targets = [];

    for (let i = 0; i < procedural.count; i++) {
        const targetNumber = procedural.idStart + i;
        const type = procedural.types[Math.floor(random() * procedural.types.length)];
        const distance = randomInRange(random, procedural.distanceRange.min, procedural.distanceRange.max);
        const angle = randomInRange(random, procedural.angleRange.min, procedural.angleRange.max);
        const seed = random();

        const target = {
            id: `target-${targetNumber < 10 ? `0${targetNumber}` : targetNumber}`,
            type,
            distance,
            angle,
            isPatrolling: type !== 'STATIC',
            seed
        };

        if (type === 'SHIP') {
            target.classId = procedural.shipClasses[Math.floor(random() * procedural.shipClasses.length)];
            target.speed = randomInRange(random, procedural.shipSpeedRange.min, procedural.shipSpeedRange.max);
            target.rpm = randomInRange(random, procedural.shipRpmRange.min, procedural.shipRpmRange.max);
            target.bladeCount = randomIntInRangeInclusive(random, procedural.shipBladeCount.min, procedural.shipBladeCount.max);
            target.shaftRate = target.rpm / 60;
        } else if (type === 'SUBMARINE') {
            target.classId = procedural.subClasses[Math.floor(random() * procedural.subClasses.length)];
            target.speed = randomInRange(random, procedural.subSpeedRange.min, procedural.subSpeedRange.max);
            target.rpm = randomInRange(random, procedural.subRpmRange.min, procedural.subRpmRange.max);
            target.bladeCount = procedural.subBladeCount;
            target.shaftRate = target.rpm / 60;
        }

        targets.push(target);
    }

    return targets;
}

export function buildScenarioTargets(scenario, random) {
    validateScenarioDefinition(scenario);
    assert(typeof random === 'function', 'random must be a function');

    const manualTargets = scenario.coreTargets.map((target) => ({ ...target, seed: random() }));
    const proceduralTargets = generateProceduralTargets(scenario.procedural, random);

    return [...manualTargets, ...proceduralTargets].map(normalizeTargetConfig);
}

export function getDefaultScenario() {
    return DEFAULT_SCENARIO;
}
