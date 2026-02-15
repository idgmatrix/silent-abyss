export class SimulationTarget {
    constructor(id, config = {}) {
        this.id = id;

        // Internal State (Cartesian)
        this.x = config.x ?? 0;
        this.z = config.z ?? 0;

        // Initialize from polar if provided and x/z missing
        if ((config.x === undefined || config.z === undefined) && config.distance !== undefined && config.angle !== undefined) {
            this.x = config.distance * Math.cos(config.angle);
            this.z = config.distance * Math.sin(config.angle);
        }

        // Movement Physics
        this.speed = Math.abs(config.speed ?? (config.velocity !== undefined ? Math.abs(config.velocity) : 0.15));
        this.course = config.course ?? (config.angle ?? 0);
        this.turnRate = config.turnRate ?? 0.1; // radians per second
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
        this.bladeCount = config.bladeCount ?? 3;

        // AI / Patrol Logic
        this.patrolRadius = config.patrolRadius ?? 90;
        this.isPatrolling = config.isPatrolling ?? true;
        this.lastTurnTime = 0;
        this.patrolCenter = { x: 0, z: 0 };
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

    set velocity(val) {
        // Legacy support: if setting negative velocity, try to turn around?
        // Better to just update speed magnitude
        this.speed = Math.abs(val);
    }

    update(dt) {
        // 1. AI Logic: Patrol / Collision Avoidance
        if (this.isPatrolling) {
            const dist = this.distance;

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
                    this.targetCourse += (Math.random() - 0.5) * 2.0; // +/- 1 radian
                    this.timeSinceLastTurn = 0;
                    this.nextTurnInterval = 20 + Math.random() * 40; // 20-60s per leg
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
