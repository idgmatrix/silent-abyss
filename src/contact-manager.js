function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function toDegrees(radians) {
    return (radians * 180) / Math.PI;
}

function normalizeAngle(angle) {
    return ((angle % 360) + 360) % 360;
}

function circularDifference(a, b) {
    const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
    return Math.min(diff, 360 - diff);
}

function formatLabel(counter) {
    return `S${counter}`;
}

function calculateThreatScore(contact) {
    const snrScore = Number.isFinite(contact.snr) ? contact.snr : 0;
    const rangeScore = Number.isFinite(contact.rangeMeters)
        ? clamp((3000 - contact.rangeMeters) / 30, 0, 100)
        : 0;
    const statusBonus = contact.status === 'AMBIGUOUS' ? 15 : contact.status === 'TRACKED' ? 10 : 0;
    const pinBonus = contact.pinned ? 25 : 0;
    return snrScore + rangeScore + statusBonus + pinBonus;
}

function toTargetSnapshot(target) {
    return {
        id: target.id,
        type: target.type,
        x: target.x,
        z: target.z,
        bearing: target.bearing,
        distance: target.distance,
        course: target.course,
        velocity: target.velocity,
        state: target.state,
        snr: target.snr
    };
}

function solutionConfidence(solution, targetSnapshot) {
    if (!targetSnapshot) return 0;

    const actualBearing = targetSnapshot.bearing;
    const actualRange = targetSnapshot.distance * 50;
    const actualCourse = normalizeAngle(toDegrees(targetSnapshot.course));
    const actualSpeed = Math.abs(targetSnapshot.velocity * 20);

    const bearingScore = 1 - clamp(circularDifference(solution.bearing, actualBearing) / 180, 0, 1);
    const rangeScore = 1 - clamp(Math.abs(solution.range - actualRange) / 3000, 0, 1);
    const courseScore = 1 - clamp(circularDifference(solution.course, actualCourse) / 180, 0, 1);
    const speedScore = 1 - clamp(Math.abs(solution.speed - actualSpeed) / 40, 0, 1);

    return Math.round(((bearingScore + rangeScore + courseScore + speedScore) / 4) * 100);
}

export class ContactManager {
    constructor(options = {}) {
        this.contacts = new Map();
        this.nextLabelNumber = 1;
        this.selectedTargetId = null;
        this.lostTimeout = Number.isFinite(options.lostTimeout) ? options.lostTimeout : 10;
        this.filterMode = 'ALL';
        this.sortMode = 'THREAT';
    }

    update(targets, elapsedTime) {
        const targetMap = new Map();
        for (const target of targets) {
            targetMap.set(target.id, target);
            const existing = this.contacts.get(target.id);
            const detected = target.state === 'TRACKED';

            if (!existing && !detected) {
                continue;
            }

            const contact = existing || this._createContact(target, elapsedTime);
            this._refreshContact(contact, target, elapsedTime, detected);
        }

        this._promoteLostContacts(elapsedTime);
        this._markAmbiguousGroups(targetMap);
    }

    _createContact(target, elapsedTime) {
        const contact = {
            targetId: target.id,
            label: formatLabel(this.nextLabelNumber++),
            alias: '',
            pinned: false,
            status: 'TRACKED',
            lastSeenAt: elapsedTime,
            rangeMeters: target.distance * 50,
            bearing: target.bearing,
            snr: target.snr ?? 0,
            type: target.type,
            mergedGroupId: null,
            reacquireCount: 0,
            manualSolution: null,
            manualConfidence: 0,
            threatScore: 0
        };

        this.contacts.set(target.id, contact);
        return contact;
    }

    _refreshContact(contact, target, elapsedTime, detected) {
        contact.type = target.type;
        contact.rangeMeters = target.distance * 50;
        contact.bearing = target.bearing;
        contact.snr = target.snr ?? contact.snr;

        if (detected) {
            if (contact.status === 'LOST') {
                contact.reacquireCount += 1;
            }
            contact.status = 'TRACKED';
            contact.lastSeenAt = elapsedTime;
        }

        if (contact.manualSolution) {
            contact.manualConfidence = solutionConfidence(contact.manualSolution, toTargetSnapshot(target));
        }

        contact.threatScore = calculateThreatScore(contact);
    }

    _promoteLostContacts(elapsedTime) {
        this.contacts.forEach((contact) => {
            if (contact.status === 'TRACKED' || contact.status === 'AMBIGUOUS') {
                if (elapsedTime - contact.lastSeenAt > this.lostTimeout) {
                    contact.status = 'LOST';
                    contact.mergedGroupId = null;
                }
            }
        });
    }

    _markAmbiguousGroups(targetMap) {
        const tracked = [];
        this.contacts.forEach((contact) => {
            if (contact.status === 'TRACKED' || contact.status === 'AMBIGUOUS') {
                const target = targetMap.get(contact.targetId);
                if (target) {
                    tracked.push({ contact, target });
                }
            }
        });

        tracked.forEach(({ contact }) => {
            contact.mergedGroupId = null;
            if (contact.status === 'AMBIGUOUS') {
                contact.status = 'TRACKED';
            }
        });

        let groupCounter = 1;
        for (let i = 0; i < tracked.length; i++) {
            const group = [tracked[i]];
            for (let j = i + 1; j < tracked.length; j++) {
                const a = tracked[i].target;
                const b = tracked[j].target;
                const bearingGap = circularDifference(a.bearing, b.bearing);
                const rangeGap = Math.abs(a.distance - b.distance) * 50;
                if (bearingGap <= 8 && rangeGap <= 250) {
                    group.push(tracked[j]);
                }
            }

            if (group.length > 1) {
                const groupId = `M${groupCounter++}`;
                group.forEach(({ contact }) => {
                    contact.status = 'AMBIGUOUS';
                    contact.mergedGroupId = groupId;
                    contact.threatScore = calculateThreatScore(contact);
                });
            }
        }
    }

    setSelectedTarget(targetId) {
        this.selectedTargetId = targetId || null;
    }

    getSelectedContact() {
        if (!this.selectedTargetId) return null;
        return this.contacts.get(this.selectedTargetId) || null;
    }

    togglePin(targetId) {
        const contact = this.contacts.get(targetId);
        if (!contact) return false;
        contact.pinned = !contact.pinned;
        contact.threatScore = calculateThreatScore(contact);
        return true;
    }

    relabel(targetId, alias) {
        const contact = this.contacts.get(targetId);
        if (!contact) return { ok: false, reason: 'not-found' };

        const normalized = String(alias || '').trim().toUpperCase();
        if (!normalized) return { ok: false, reason: 'empty' };
        if (normalized.length > 12) return { ok: false, reason: 'too-long' };

        for (const c of this.contacts.values()) {
            if (c.targetId !== targetId && c.alias === normalized) {
                return { ok: false, reason: 'duplicate' };
            }
        }

        contact.alias = normalized;
        return { ok: true };
    }

    clearLostContacts() {
        const removed = [];
        this.contacts.forEach((contact, targetId) => {
            if (contact.status === 'LOST') {
                removed.push(targetId);
                this.contacts.delete(targetId);
            }
        });

        if (this.selectedTargetId && !this.contacts.has(this.selectedTargetId)) {
            this.selectedTargetId = null;
        }

        return removed;
    }

    setManualSolution(targetId, solution, targetSnapshot) {
        const contact = this.contacts.get(targetId);
        if (!contact) return null;

        const normalized = {
            bearing: Number(solution.bearing),
            range: Number(solution.range),
            course: Number(solution.course),
            speed: Number(solution.speed)
        };

        const allFinite = Object.values(normalized).every((value) => Number.isFinite(value));
        if (!allFinite) return null;

        normalized.bearing = normalizeAngle(normalized.bearing);
        normalized.course = normalizeAngle(normalized.course);

        contact.manualSolution = normalized;
        contact.manualConfidence = solutionConfidence(normalized, targetSnapshot || null);
        return contact.manualConfidence;
    }

    reset() {
        this.contacts.clear();
        this.nextLabelNumber = 1;
        this.selectedTargetId = null;
    }

    getContacts(options = {}) {
        const filterMode = options.filterMode || this.filterMode;
        const sortMode = options.sortMode || this.sortMode;

        const filtered = [...this.contacts.values()].filter((contact) => {
            switch (filterMode) {
                case 'TRACKED':
                    return contact.status === 'TRACKED';
                case 'AMBIGUOUS':
                    return contact.status === 'AMBIGUOUS';
                case 'LOST':
                    return contact.status === 'LOST';
                case 'PINNED':
                    return contact.pinned;
                case 'ALL':
                default:
                    return true;
            }
        });

        filtered.sort((a, b) => {
            if (sortMode === 'RANGE') {
                return a.rangeMeters - b.rangeMeters;
            }
            if (sortMode === 'LABEL') {
                return a.label.localeCompare(b.label);
            }
            if (sortMode === 'CONFIDENCE') {
                return b.manualConfidence - a.manualConfidence;
            }

            if (b.threatScore !== a.threatScore) {
                return b.threatScore - a.threatScore;
            }
            return a.label.localeCompare(b.label);
        });

        return filtered;
    }
}
