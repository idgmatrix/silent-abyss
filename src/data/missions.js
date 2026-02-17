export const CAMPAIGN_MISSIONS = [
    {
        id: 'mission-01',
        name: 'Silent Identification',
        briefing: 'Establish track and confirm a hostile submarine classification using passive methods.',
        objectives: [
            {
                id: 'track-contact',
                type: 'TRACK_CONTACTS_MIN',
                description: 'Track at least one contact.',
                minCount: 1
            },
            {
                id: 'confirm-sub-class',
                type: 'CONFIRM_CLASSIFICATION',
                description: 'Confirm classification of one submarine contact.',
                targetType: 'SUBMARINE'
            }
        ]
    },
    {
        id: 'mission-02',
        name: 'Layer Hunter',
        briefing: 'Manage multiple tracks, submit a solid fire-control solution, and exploit environmental acoustics.',
        objectives: [
            {
                id: 'multi-track',
                type: 'TRACK_CONTACTS_MIN',
                description: 'Maintain at least three tracked contacts.',
                minCount: 3
            },
            {
                id: 'manual-solution',
                type: 'SAVE_MANUAL_SOLUTION',
                description: 'Record a manual solution with >= 70% confidence.',
                minConfidence: 70
            },
            {
                id: 'env-advantage',
                type: 'HAS_ENVIRONMENTAL_ADVANTAGE',
                description: 'Hold a selected contact with positive environmental acoustic gain.',
                minBonusDb: 1
            }
        ]
    }
];
