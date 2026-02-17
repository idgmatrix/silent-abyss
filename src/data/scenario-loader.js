import { getClassProfile } from './ship-signatures.js';
import { DEFAULT_SCENARIO } from './scenarios/default-scenario.js';

const TARGET_TYPE_DEFAULTS = {
    SHIP: { type: 'SHIP', isPatrolling: true },
    SUBMARINE: { type: 'SUBMARINE', isPatrolling: true },
    BIOLOGICAL: { type: 'BIOLOGICAL', isPatrolling: true },
    STATIC: { type: 'STATIC', isPatrolling: false }
};

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

    return {
        ...typeDefaults,
        ...(classProfile?.defaults ?? {}),
        ...target,
        type: inferredType
    };
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

    assert(isObject(procedural.subSpeedRange), 'procedural.subSpeedRange is required');
    assert(isObject(procedural.subRpmRange), 'procedural.subRpmRange is required');
    assert(Number.isInteger(procedural.subBladeCount), 'procedural.subBladeCount must be an integer');
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
        } else if (type === 'SUBMARINE') {
            target.classId = procedural.subClasses[Math.floor(random() * procedural.subClasses.length)];
            target.speed = randomInRange(random, procedural.subSpeedRange.min, procedural.subSpeedRange.max);
            target.rpm = randomInRange(random, procedural.subRpmRange.min, procedural.subRpmRange.max);
            target.bladeCount = procedural.subBladeCount;
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
