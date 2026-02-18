export const TargetType = {
    SHIP: 'SHIP',
    SUBMARINE: 'SUBMARINE',
    BIOLOGICAL: 'BIOLOGICAL',
    STATIC: 'STATIC',
    TORPEDO: 'TORPEDO'
};

export const TrackState = {
    UNDETECTED: 'UNDETECTED',
    AMBIGUOUS: 'AMBIGUOUS', // Detected but not classified
    CLASSIFIED: 'CLASSIFIED', // Signature match in progress
    CONFIRMED: 'CONFIRMED', // Final identification
    TRACKED: 'TRACKED',
    LOST: 'LOST'
};

export const BehaviorState = {
    NORMAL: 'NORMAL',
    EVADE: 'EVADE',
    INTERCEPT: 'INTERCEPT'
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getAcousticDefaultsForType(type) {
    switch (type) {
        case TargetType.SUBMARINE:
            return { rpm: 90, bladeCount: 7 };
        case TargetType.TORPEDO:
            return { rpm: 600, bladeCount: 4 };
        case TargetType.BIOLOGICAL:
        case TargetType.STATIC:
            return { rpm: 0, bladeCount: 0 };
        case TargetType.SHIP:
        default:
            return { rpm: 120, bladeCount: 3 };
    }
}

export class SimulationTarget {
    constructor(id, config = {}) {
        this.id = id;
        this.type = config.type ?? TargetType.SHIP;
        this.state = TrackState.UNDETECTED;
        this.lastDetectedTime = 0;

        // Internal State (Cartesian)
        this.x = config.x ?? 0;
        this.z = config.z ?? 0;

        // Initialize from polar if provided and x/z missing
        if ((config.x === undefined || config.z === undefined) && config.distance !== undefined && config.angle !== undefined) {
            this.x = config.distance * Math.cos(config.angle);
            this.z = config.distance * Math.sin(config.angle);
        }

        // Movement Physics
        this.speed = Math.abs(config.speed ?? (config.velocity !== undefined ? Math.abs(config.velocity) : (this.type === TargetType.STATIC ? 0 : 0.15)));
        if (this.type === TargetType.TORPEDO && config.speed === undefined) {
            this.speed = 2.5; // Fast
        }

        // Adjust default physics based on type
        let defaultTurnRate = 0.1;
        if (this.type === TargetType.SUBMARINE) defaultTurnRate = 0.05;
        if (this.type === TargetType.BIOLOGICAL) defaultTurnRate = 0.3;
        if (this.type === TargetType.TORPEDO) defaultTurnRate = 0.5; // Very agile

        this.course = config.course ?? (config.angle ?? 0);
        this.turnRate = config.turnRate ?? defaultTurnRate; // radians per second
        this.targetCourse = config.targetCourse ?? this.course;

        // Compatibility Initialization for legacy velocity (radial)
        if (config.velocity !== undefined && config.course === undefined && config.angle !== undefined) {
             // If velocity was negative (closing), course is opposite to angle
             if (config.velocity < 0) {
                 this.course = config.angle + Math.PI;
             } else {
                 this.course = config.angle;
             }
             this.targetCourse = this.course;
        }

        // Audio/Visual properties
        const acousticDefaults = getAcousticDefaultsForType(this.type);
        const rpmInput = Number.isFinite(config.rpm) ? config.rpm : acousticDefaults.rpm;
        const bladeInput = Number.isFinite(config.bladeCount) ? config.bladeCount : acousticDefaults.bladeCount;
        this.rpm = clamp(rpmInput, 0, 2000);
        this.bladeCount = clamp(Math.round(bladeInput), 0, 12);
        const shaftRateInput = Number.isFinite(config.shaftRate) ? config.shaftRate : this.rpm / 60;
        this.shaftRate = clamp(shaftRateInput, 0, 120);

        // AI / Patrol Logic
        this.patrolRadius = config.patrolRadius ?? 90;
        this.isPatrolling = config.isPatrolling ?? (this.type !== TargetType.STATIC);
        this.lastTurnTime = 0;
        this.patrolCenter = { x: this.x, z: this.z }; // Patrol around start position
        this.timeSinceLastTurn = 0;
        this.nextTurnInterval = 10 + (config.seed ?? 0.5) * 20; // Use provided seed or default
        this.lastPulseId = -1;
        this.behaviorState = BehaviorState.NORMAL;
        this.cruiseSpeed = this.speed;

        // Classification State
        this.classId = config.classId ?? (this.type === TargetType.SUBMARINE ? 'triumph-class' : 'cargo-vessel');
        this.classification = {
            state: TrackState.UNDETECTED,
            progress: 0, // 0.0 to 1.0
            identifiedClass: null,
            confirmed: false
        };
    }

    // Compatibility Getters
    get distance() {
        return Math.hypot(this.x, this.z);
    }

    get angle() {
        return Math.atan2(this.z, this.x);
    }

    get bearing() {
        // bearing in degrees, 0-360. 0=North, 90=East.
        // this.angle is 0 at East, PI/2 at South.
        // So Bearing = Angle + 90.
        let b = (this.angle * 180 / Math.PI) + 90;
        return (b + 360) % 360;
    }

    set bearing(val) {
        // Deprecated setter, doing nothing to avoid breaking physics
    }

    // Radial velocity component (speed * cos(course - angle))
    get velocity() {
        return this.speed * Math.cos(this.course - this.angle);
    }

    getAcousticSignature() {
        // Source Levels (SL) in dB re 1uPa @ 1m
        let sl = 0;
        switch (this.type) {
            case 'SHIP': sl = 155; break;
            case 'SUBMARINE': sl = 130; break;
            case 'BIOLOGICAL': sl = 140; break;
            case 'STATIC': sl = 110; break;
            case 'TORPEDO': sl = 170; break;
            default: sl = 120;
        }

        // Speed contribution (cavitation/flow noise)
        // 20 * log10(1 + speed * scale) provides a realistic dB increase with speed
        const speedScale = 10.0;
        const speedFactor = 20 * Math.log10(1 + this.speed * speedScale);

        // Machinery/RPM contribution
        const machineryFactor = this.rpm > 0 ? 5 * Math.log10(1 + this.rpm / 60) : 0;

        return sl + speedFactor + machineryFactor;
    }

    set velocity(val) {
        // Legacy support: if setting negative velocity, try to turn around?
        // Better to just update speed magnitude
        this.speed = Math.abs(val);
        this.cruiseSpeed = this.speed;
    }

    reactToPing() {
        if (this.type === TargetType.SUBMARINE || this.type === TargetType.SHIP) {
            this.behaviorState = BehaviorState.EVADE;
            this.alertTimer = 30;
            return;
        }

        if (this.type === TargetType.TORPEDO) {
            this.behaviorState = BehaviorState.INTERCEPT;
            this.alertTimer = 0;
            return;
        }
    }

    update(dt, random) {
        // 1. AI Logic: Reactive behavior or patrol/collision avoidance
        if (this.behaviorState === BehaviorState.EVADE) {
            this.targetCourse = Math.atan2(this.z, this.x); // Bearing away from origin (0,0)
            this.speed = this.cruiseSpeed * 1.5;
            this.alertTimer -= dt;

            if (this.alertTimer <= 0) {
                this.behaviorState = BehaviorState.NORMAL;
                this.alertTimer = 0;
                this.speed = this.cruiseSpeed;
            }
        } else if (this.behaviorState === BehaviorState.INTERCEPT) {
            this.targetCourse = Math.atan2(-this.z, -this.x); // Bearing toward origin (0,0)
            this.speed = this.cruiseSpeed;
        } else if (this.isPatrolling) {
            const dist = Math.hypot(this.x - this.patrolCenter.x, this.z - this.patrolCenter.z);

            // Check boundary
            if (dist > this.patrolRadius) {
                // If outside patrol radius, turn towards center
                // Calculate angle to center
                const angleToCenter = Math.atan2(this.patrolCenter.z - this.z, this.patrolCenter.x - this.x);

                // Adjust target course to point back to center, maybe with some variation
                // We want a smooth turn, so just setting targetCourse is enough
                // We normalize angles to avoid 360 spins when crossing PI/-PI
                this.targetCourse = angleToCenter;
            } else {
                this.timeSinceLastTurn += dt;
                // Change course after interval
                if (this.timeSinceLastTurn > this.nextTurnInterval) {
                    if (this.type === TargetType.BIOLOGICAL) {
                        // Biologicals move very erratically
                        this.targetCourse += (random() - 0.5) * Math.PI; // +/- 90 degrees
                        this.speed = 0.05 + random() * 0.25; // Variable speed
                        this.nextTurnInterval = 2 + random() * 8; // Very frequent turns
                    } else if (this.type === TargetType.TORPEDO) {
                        // Torpedoes make sharp adjustments
                        this.targetCourse += (random() - 0.5) * 0.5;
                        this.nextTurnInterval = 1 + random() * 3;
                    } else {
                        this.targetCourse += (random() - 0.5) * 2.0; // +/- 1 radian
                        this.nextTurnInterval = 20 + random() * 40; // 20-60s per leg
                    }
                    this.timeSinceLastTurn = 0;
                }
            }
        }

        // 2. Turning Physics
        // Normalize angles
        let current = this.course;
        let target = this.targetCourse;

        // Ensure angles are within -PI to PI for calculation
        // (Not strictly necessary for cos/sin but good for diff)

        let diff = target - current;
        // Normalize diff to -PI...PI
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        const turnStep = this.turnRate * dt;

        if (Math.abs(diff) < turnStep) {
            this.course = this.targetCourse;
        } else {
            this.course += Math.sign(diff) * turnStep;
        }

        // Normalize course
        this.course = (this.course + Math.PI * 2) % (Math.PI * 2);

        // 3. Movement Physics
        this.x += Math.cos(this.course) * this.speed * dt;
        this.z += Math.sin(this.course) * this.speed * dt;
    }
}

export class SimulationEngine {
    constructor(seed = 12345) {
        this.targets = [];
        this.onTick = null;
        this.lastUpdateTime = 0;
        this.seed = seed;
    }

    // Simple deterministic PRNG (Mulberry32)
    random() {
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    addTarget(target) {
        this.targets.push(target);
    }

    start(tickRate = 100) {
        this.accumulator = 0;
        this.fixedDt = tickRate / 1000;
        this.lastUpdateTime = 0;
    }

    update(now) {
        if (this.lastUpdateTime === 0) {
            this.lastUpdateTime = now;
            return;
        }

        const frameTime = (now - this.lastUpdateTime) / 1000;
        this.lastUpdateTime = now;

        this.accumulator += frameTime;

        while (this.accumulator >= this.fixedDt) {
            this.tick(this.fixedDt);
            this.accumulator -= this.fixedDt;
        }
    }

    stop() {
        this.lastUpdateTime = 0;
    }

    tick(dt) {
        const randFunc = () => this.random();
        for (const target of this.targets) {
            target.update(dt, randFunc);
        }

        if (this.onTick) {
            this.onTick(this.targets, dt);
        }
    }

    dispose() {
        this.stop();
        this.targets = [];
        this.onTick = null;
    }
}
