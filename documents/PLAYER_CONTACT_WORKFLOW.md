# Player Contact Workflow

This is the intended operator flow for contact management and mission progression.

## 1. Build Initial Tracks
- Stay in passive mode.
- Observe LOFAR/BTR/Waterfall and acquire contacts.
- Use tactical view (3D/RADAR/GRID) to select contacts.

## 2. Manage Contact Registry
Use the Contact Registry panel to:
- filter and sort contacts
- pin priority tracks
- relabel tracks for tactical shorthand
- clear stale LOST tracks

Track labels (`S1`, `S2`, ...) remain stable as contacts update.

## 3. Enter Manual Solutions
For selected contacts:
- enter bearing/range/course/speed estimates
- save solution
- monitor confidence score

Higher confidence supports mission objectives and fire-control readiness.

## 4. Read Environmental Context
Use Water Column and tactical cues to interpret detection quality:
- depth profile shows thermocline, duct region, own/target depth
- 2D tactical views show terrain isolines and depth cues
- environmental bonus/penalty affects detection and active echo response

## 5. Complete Campaign Objectives
Campaign panel shows:
- active mission
- briefing
- objective checklist

Finishing all objectives completes mission and unlocks the next mission.
Progress is persisted locally.
