const TWO_PI = Math.PI * 2;

export function normalizeCourseRadians(course) {
    const c = Number.isFinite(course) ? course : 0;
    return ((c % TWO_PI) + TWO_PI) % TWO_PI;
}

export function forwardFromCourse(course) {
    const c = normalizeCourseRadians(course);
    return {
        x: Math.sin(c),
        z: Math.cos(c)
    };
}

export function rightFromCourse(course) {
    const c = normalizeCourseRadians(course);
    return {
        x: Math.cos(c),
        z: -Math.sin(c)
    };
}

export function shipLocalToWorld(local, shipPosition, course) {
    const right = rightFromCourse(course);
    const forward = forwardFromCourse(course);

    const localX = Number.isFinite(local?.x) ? local.x : 0;
    const localY = Number.isFinite(local?.y) ? local.y : 0;
    const localZ = Number.isFinite(local?.z) ? local.z : 0;

    const shipX = Number.isFinite(shipPosition?.x) ? shipPosition.x : 0;
    const shipY = Number.isFinite(shipPosition?.y) ? shipPosition.y : 0;
    const shipZ = Number.isFinite(shipPosition?.z) ? shipPosition.z : 0;

    return {
        x: shipX + right.x * localX + forward.x * localZ,
        y: shipY + localY,
        z: shipZ + right.z * localX + forward.z * localZ
    };
}

export function worldToShipLocal(world, shipPosition, course) {
    const right = rightFromCourse(course);
    const forward = forwardFromCourse(course);

    const dx = (Number.isFinite(world?.x) ? world.x : 0) - (Number.isFinite(shipPosition?.x) ? shipPosition.x : 0);
    const dy = (Number.isFinite(world?.y) ? world.y : 0) - (Number.isFinite(shipPosition?.y) ? shipPosition.y : 0);
    const dz = (Number.isFinite(world?.z) ? world.z : 0) - (Number.isFinite(shipPosition?.z) ? shipPosition.z : 0);

    return {
        x: (dx * right.x) + (dz * right.z),
        y: dy,
        z: (dx * forward.x) + (dz * forward.z)
    };
}

export function bearingDegFromDelta(dx, dz) {
    const bearing = Math.atan2(dx, dz) * 180 / Math.PI;
    return ((bearing % 360) + 360) % 360;
}
