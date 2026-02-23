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

## 5. Use 2D Visual Controls
Use the header controls in `RADAR`/`GRID` to tune readability:
- `SNAP2D`: camera eases toward selected contact in `GRID` mode.
- `CMP-PRED`: draw an extra amber dashed vector (course-only) for predictor comparison.
- `ENH-2D`: toggle enhanced 2D rendering path on/off.
- `V-MODE`: switch visual palette (`STL` stealth, `ENG` engagement, `ALM` alarm).

Prediction cues in 2D:
- White dashed line = observed-motion predictor (primary, matches recent movement).
- Amber dashed line (when `CMP-PRED` is on) = course-only predictor.

Hover behavior in 2D:
- Hovering a tracked contact shows a tooltip card with bearing/range/speed/depth/confidence.
- Hover ring appears around hovered contact.

## 6. Complete Campaign Objectives
Campaign panel shows:
- active mission
- briefing
- objective checklist

Finishing all objectives completes mission and unlocks the next mission.
Progress is persisted locally.

## Operator Debug Flags (Optional)
Use query params for direct setup:
- `?enhanced2d=1|0`
- `?visualMode=stealth|engagement|alarm`
- `?snap2d=1|0`
- `?comparePred=1|0`

Persistent keys in local storage:
- `silentAbyss.enhanced2DVisuals`
- `silentAbyss.visualMode`
- `silentAbyss.snapToContact2d`
- `silentAbyss.comparePrediction2d`
