const STORAGE_KEY = 'silent-abyss-campaign-v1';

function makeDefaultState(missions) {
    return {
        activeMissionId: missions[0]?.id || null,
        unlockedMissionIds: missions[0] ? [missions[0].id] : [],
        completedMissionIds: [],
        objectiveProgress: {}
    };
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class CampaignManager {
    constructor(missions, options = {}) {
        this.missions = Array.isArray(missions) ? missions : [];
        this.missionMap = new Map(this.missions.map((mission) => [mission.id, mission]));
        this.storage = options.storage || this.resolveStorage();
        this.state = makeDefaultState(this.missions);
    }

    resolveStorage() {
        if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage;
        }

        const mem = new Map();
        return {
            getItem: (key) => mem.get(key) || null,
            setItem: (key, value) => mem.set(key, value),
            removeItem: (key) => mem.delete(key)
        };
    }

    load() {
        const raw = this.storage.getItem(STORAGE_KEY);
        if (!raw) {
            this.state = makeDefaultState(this.missions);
            return;
        }

        try {
            const parsed = JSON.parse(raw);
            if (!isObject(parsed)) throw new Error('invalid campaign payload');

            const candidate = {
                activeMissionId: typeof parsed.activeMissionId === 'string' ? parsed.activeMissionId : this.missions[0]?.id || null,
                unlockedMissionIds: Array.isArray(parsed.unlockedMissionIds) ? parsed.unlockedMissionIds : [],
                completedMissionIds: Array.isArray(parsed.completedMissionIds) ? parsed.completedMissionIds : [],
                objectiveProgress: isObject(parsed.objectiveProgress) ? parsed.objectiveProgress : {}
            };

            candidate.unlockedMissionIds = candidate.unlockedMissionIds.filter((id) => this.missionMap.has(id));
            candidate.completedMissionIds = candidate.completedMissionIds.filter((id) => this.missionMap.has(id));

            if (candidate.unlockedMissionIds.length === 0 && this.missions[0]) {
                candidate.unlockedMissionIds = [this.missions[0].id];
            }

            if (!candidate.activeMissionId || !candidate.unlockedMissionIds.includes(candidate.activeMissionId)) {
                candidate.activeMissionId = candidate.unlockedMissionIds[0] || null;
            }

            this.state = candidate;
        } catch {
            this.state = makeDefaultState(this.missions);
        }
    }

    save() {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    }

    reset() {
        this.state = makeDefaultState(this.missions);
        this.save();
    }

    getMissionById(missionId) {
        return this.missionMap.get(missionId) || null;
    }

    getActiveMission() {
        return this.getMissionById(this.state.activeMissionId);
    }

    getUnlockedMissions() {
        return this.state.unlockedMissionIds
            .map((id) => this.getMissionById(id))
            .filter(Boolean);
    }

    setActiveMission(missionId) {
        if (!this.state.unlockedMissionIds.includes(missionId)) return false;
        this.state.activeMissionId = missionId;
        this.save();
        return true;
    }

    isMissionCompleted(missionId) {
        return this.state.completedMissionIds.includes(missionId);
    }

    getObjectiveState(missionId, objectiveId) {
        return !!this.state.objectiveProgress?.[missionId]?.[objectiveId];
    }

    markObjectiveComplete(missionId, objectiveId) {
        if (!this.state.objectiveProgress[missionId]) {
            this.state.objectiveProgress[missionId] = {};
        }
        this.state.objectiveProgress[missionId][objectiveId] = true;
    }

    evaluate(context = {}) {
        const mission = this.getActiveMission();
        if (!mission) return { missionCompleted: false, newlyCompletedObjectives: [] };

        const newlyCompletedObjectives = [];

        mission.objectives.forEach((objective) => {
            if (this.getObjectiveState(mission.id, objective.id)) return;
            if (this.checkObjective(objective, context)) {
                this.markObjectiveComplete(mission.id, objective.id);
                newlyCompletedObjectives.push(objective.id);
            }
        });

        let missionCompleted = false;
        const allDone = mission.objectives.every((objective) => this.getObjectiveState(mission.id, objective.id));
        if (allDone && !this.isMissionCompleted(mission.id)) {
            this.state.completedMissionIds.push(mission.id);
            missionCompleted = true;

            const missionIndex = this.missions.findIndex((m) => m.id === mission.id);
            const nextMission = this.missions[missionIndex + 1];
            if (nextMission && !this.state.unlockedMissionIds.includes(nextMission.id)) {
                this.state.unlockedMissionIds.push(nextMission.id);
            }
        }

        if (newlyCompletedObjectives.length > 0 || missionCompleted) {
            this.save();
        }

        return { missionCompleted, newlyCompletedObjectives };
    }

    checkObjective(objective, context) {
        const targets = Array.isArray(context.targets) ? context.targets : [];
        const contacts = Array.isArray(context.contacts) ? context.contacts : [];

        switch (objective.type) {
            case 'TRACK_CONTACTS_MIN': {
                const trackedCount = targets.filter((t) => t.state === 'TRACKED').length;
                return trackedCount >= (objective.minCount || 1);
            }
            case 'CONFIRM_CLASSIFICATION': {
                return targets.some((target) => {
                    if (!target.classification?.confirmed) return false;
                    if (objective.targetType && target.type !== objective.targetType) return false;
                    if (objective.classId && target.classId !== objective.classId) return false;
                    return true;
                });
            }
            case 'SAVE_MANUAL_SOLUTION': {
                const minConfidence = objective.minConfidence || 60;
                return contacts.some((contact) => contact.manualConfidence >= minConfidence);
            }
            case 'HAS_ENVIRONMENTAL_ADVANTAGE': {
                const minBonusDb = objective.minBonusDb || 0;
                return (context.selectedAcousticContext?.modifiers?.snrModifierDb || 0) >= minBonusDb;
            }
            default:
                return false;
        }
    }
}
