export const TargetType = {
    SHIP: 'SHIP',
    SUBMARINE: 'SUBMARINE',
    BIOLOGICAL: 'BIOLOGICAL',
    STATIC: 'STATIC'
};

export class SimulationTarget {
    constructor(id, config = {}) {
        this.id = id;
        this.type = config.type ?? TargetType.SHIP;

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

        // Adjust default physics based on type
        let defaultTurnRate = 0.1;
        if (this.type === TargetType.SUBMARINE) defaultTurnRate = 0.05;
        if (this.type === TargetType.BIOLOGICAL) defaultTurnRate = 0.3;

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
        this.detected = config.detected ?? false;
        this.rpm = config.rpm ?? 120;
        if (this.type === TargetType.SUBMARINE) this.rpm = config.rpm ?? 90;
        if (this.type === TargetType.BIOLOGICAL || this.type === TargetType.STATIC) this.rpm = 0;

        this.bladeCount = config.bladeCount ?? 3;
        if (this.type === TargetType.SUBMARINE) this.bladeCount = config.bladeCount ?? 7;

        // AI / Patrol Logic
        this.patrolRadius = config.patrolRadius ?? 90;
        this.isPatrolling = config.isPatrolling ?? (this.type !== TargetType.STATIC);
        this.lastTurnTime = 0;
        this.patrolCenter = { x: this.x, z: this.z }; // Patrol around start position
        this.timeSinceLastTurn = 0;
        this.nextTurnInterval = 10 + Math.random() * 20; // 10-30s initial leg
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
        // Base noise depends on type
        let base = 0;
        switch (this.type) {
            case 'SHIP': base = 50; break;
            case 'SUBMARINE': base = 25; break;
            case 'BIOLOGICAL': base = 15; break;
            case 'STATIC': base = 5; break;
            default: base = 10;
        }

        // RPM contribution
        const rpmFactor = this.rpm / 60; // normalized around 60rpm

        // Speed contribution (cavitation/flow noise)
        const speedFactor = Math.pow(this.speed * 5, 1.5);

        return base * (1 + rpmFactor * 0.5 + speedFactor);
    }

    set velocity(val) {
        // Legacy support: if setting negative velocity, try to turn around?
        // Better to just update speed magnitude
        this.speed = Math.abs(val);
    }

    update(dt) {
        // 1. AI Logic: Patrol / Collision Avoidance
        if (this.isPatrolling) {
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
                        this.targetCourse += (Math.random() - 0.5) * Math.PI; // +/- 90 degrees
                        this.speed = 0.05 + Math.random() * 0.25; // Variable speed
                        this.nextTurnInterval = 2 + Math.random() * 8; // Very frequent turns
                    } else {
                        this.targetCourse += (Math.random() - 0.5) * 2.0; // +/- 1 radian
                        this.nextTurnInterval = 20 + Math.random() * 40; // 20-60s per leg
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
    constructor() {
        this.targets = [];
        this.onTick = null;
        this.lastUpdateTime = 0;
        this.intervalId = null;
    }

    addTarget(target) {
        this.targets.push(target);
    }

    start(tickRate = 100) {
        if (this.intervalId) return;

        this.lastUpdateTime = performance.now();
        this.intervalId = setInterval(() => {
            const now = performance.now();
            const dt = (now - this.lastUpdateTime) / 1000;
            this.lastUpdateTime = now;
            this.tick(dt);
        }, tickRate);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    tick(dt) {
        for (const target of this.targets) {
            target.update(dt);
        }

        if (this.onTick) {
            this.onTick(this.targets, dt);
        }
    }
}
