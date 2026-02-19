import { TrackState } from './simulation.js';

export class Tactical2DRenderer {
    constructor(getTerrainHeight) {
        this.container = null;
        this.canvas = null;
        this.ctx = null;
        this.scanRadius = 0;
        this.scanActive = false;
        this.getTerrainHeight = typeof getTerrainHeight === 'function' ? getTerrainHeight : (() => 0);
        this.contourCache = new Map();
    }

    init(container) {
        if (this.canvas || !container) return;
        this.container = container;
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.pointerEvents = 'none';
        this.canvas.style.display = 'none';
        container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');
    }

    dispose() {
        if (this.canvas && this.canvas.parentElement) {
            this.canvas.parentElement.removeChild(this.canvas);
        }
        this.container = null;
        this.canvas = null;
        this.ctx = null;
        this.contourCache.clear();
    }

    setVisible(visible) {
        if (!this.canvas) return;
        this.canvas.style.display = visible ? 'block' : 'none';
    }

    resize(width, height) {
        if (!this.canvas || !this.ctx) return;
        const safeWidth = Math.max(1, Math.floor(width || 0));
        const safeHeight = Math.max(1, Math.floor(height || 0));
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = safeWidth * dpr;
        this.canvas.height = safeHeight * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.contourCache.clear();
    }

    setScanState(radius, active) {
        this.scanRadius = radius;
        this.scanActive = active;
    }

    render(mode, targets, options = {}) {
        if (!this.ctx || !this.container) return;
        if (mode === 'radial') {
            this.renderRadial(targets, options);
        } else if (mode === 'grid') {
            this.renderGrid(targets, options);
        }
    }

    // Coordinate System Note (Global):
    // +Z is North (Course 0)
    // +X is East (Course 90)
    // Course increases clockwise.

    pickTargetAtPoint(mode, x, y, rect, targets, options = {}) {
        if (!Array.isArray(targets)) return null;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const scale = 1.5;
        const ownShipPose = options.ownShipPose || { x: 0, z: 0, course: 0 };

        let hitId = null;
        targets.forEach((t) => {
            if (t.state !== TrackState.TRACKED) return;

            let dx;
            let dy;

            if (mode === 'radial') {
                // Radial View: Ship Up (+Y on screen is Forward)
                // World Coords: +Z is Forward (North).
                // We need to rotate the world so that Ship's Heading points Up (-Y screen? No, Usually Up is -Y in Grid, but +Y in math?)
                // Let's assume Screen Up is -Y pixel coords.
                // We want Ship Forward (+Z relative or Heading Vector) to point to Screen Up.

                // World Relative Pos:
                const relX = t.x - ownShipPose.x;
                const relZ = t.z - ownShipPose.z;

                // Rotate by -Heading to align Forward with +Z (North axis in local frame)
                // If ship heading is 90 (East), we rotate by -90. East becomes North (+Z).
                // x' = x cos(-c) - z sin(-c)
                // z' = x sin(-c) + z cos(-c)
                const c = Math.cos(-ownShipPose.course);
                const s = Math.sin(-ownShipPose.course);
                const localX = relX * c - relZ * s;
                const localZ = relX * s + relZ * c;

                // Now localZ is "Forward", localX is "Right".
                // Map to Screen:
                // Screen X = centerX + localX * scale
                // Screen Y = centerY - localZ * scale (Invert Z because screen Y is down)
                dx = centerX + localX * scale;
                dy = centerY - localZ * scale;

            } else {
                // Grid View: North Up (+Z is Up on screen? or -Z?)
                // Maritime charts: North is Up.
                // Our World: +Z is North.
                // So Screen Up (-Y) should correspond to World +Z.
                // Screen Right (+X) should correspond to World +X (East).

                const relX = t.x - ownShipPose.x;
                const relZ = t.z - ownShipPose.z;

                dx = centerX + relX * scale;
                dy = centerY - relZ * scale;
            }

            const dist = Math.sqrt((x - dx) ** 2 + (y - dy) ** 2);
            if (dist < 25) hitId = t.id;
        });

        return hitId;
    }

    renderRadial(targets, options = {}) {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        const ctx = this.ctx;
        const centerX = w / 2;
        const centerY = h / 2;
        const scale = 1.5;
        const pulse = options.pulse || 0;
        const selectedTargetId = options.selectedTargetId || null;
        const ownShipPose = options.ownShipPose || { x: 0, z: 0, course: 0 };

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 1;
        for (let r = 50; r <= 200; r += 50) {
            ctx.beginPath();
            ctx.arc(centerX, centerY, r * scale, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#004444';
            ctx.fillText(`${r}m`, centerX + 5, centerY - r * scale - 5);
        }

        // Bearing Lines (Relative to Ship Heading)
        ctx.strokeStyle = '#002222';
        const angleOffset = -Math.PI / 2; // Up on screen
        [0, 90, 180, 270].forEach((deg) => {
            const rad = (deg * Math.PI / 180) + angleOffset;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(centerX + Math.cos(rad) * 300, centerY + Math.sin(rad) * 300);
            ctx.stroke();
        });

        // Contours in Head-Up Mode
        this.drawTerrainContours(ctx, w, h, scale, ownShipPose, true);

        ctx.font = '10px monospace';
        if (Array.isArray(targets)) {
            targets.forEach((t) => {
                if (t.state !== TrackState.TRACKED) return;

                // Calculate screen position matching picking logic
                const relX = t.x - ownShipPose.x;
                const relZ = t.z - ownShipPose.z;
                const c = Math.cos(-ownShipPose.course);
                const s = Math.sin(-ownShipPose.course);
                const localX = relX * c - relZ * s;
                const localZ = relX * s + relZ * c;

                const dx = centerX + localX * scale;
                const dy = centerY - localZ * scale;

                const isSelected = selectedTargetId === t.id;

                ctx.globalAlpha = isSelected ? 1.0 : 0.7;
                this.drawTrackUncertainty(ctx, dx, dy, t.snr, this.getTypeColor(t.type));

                if (isSelected) {
                    this.drawSelectionHUD(ctx, dx, dy, 12, pulse);
                }

                this.drawTargetGlyph(ctx, t.type, dx, dy, true);
                this.drawDepthCue(ctx, t, dx, dy);

                ctx.fillStyle = '#ffffff';
                ctx.globalAlpha = 1.0;
                ctx.fillText(t.id.replace('target-', 'T'), dx + 10, dy);
            });
        }

        if (this.scanActive) {
            const outerRadius = Math.max(0, this.scanRadius * scale);
            const innerRadius = Math.max(0, (this.scanRadius - 5) * scale);

            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 2;
            if (outerRadius > 0) {
                ctx.beginPath();
                ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2);
                ctx.stroke();
            }

            if (innerRadius > 0) {
                ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)';
                ctx.beginPath();
                ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // Own Ship Glyph (Center, Pointing Up)
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(5, 5);
        ctx.lineTo(-5, 5);
        ctx.closePath();
        ctx.fillStyle = '#00ff00';
        ctx.fill();
        ctx.restore();
    }

    renderGrid(targets, options = {}) {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        const ctx = this.ctx;
        const centerX = w / 2;
        const centerY = h / 2;
        const scale = 1.5;
        const pulse = options.pulse || 0;
        const selectedTargetId = options.selectedTargetId || null;
        const ownShipPose = options.ownShipPose || { x: 0, z: 0, course: 0 };

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = '#004444';
        ctx.lineWidth = 1;
        ctx.fillStyle = '#00ffff';
        for (let i = -5; i <= 5; i++) {
            ctx.beginPath();
            ctx.moveTo(0, centerY + i * 50);
            ctx.lineTo(w, centerY + i * 50);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(centerX + i * 50, 0);
            ctx.lineTo(centerX + i * 50, h);
            ctx.stroke();
        }

        ctx.strokeStyle = '#006666';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(w, centerY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(centerX, 0);
        ctx.lineTo(centerX, h);
        ctx.stroke();

        this.drawTerrainContours(ctx, w, h, scale, ownShipPose, false);

        if (Array.isArray(targets)) {
            targets.forEach((t) => {
                if (t.state !== TrackState.TRACKED) return;

                // North Up Mode: +Z is Up on screen (Screen -Y)
                // +X is Right on screen (Screen +X)
                const relX = t.x - ownShipPose.x;
                const relZ = t.z - ownShipPose.z;

                const dx = centerX + relX * scale;
                const dy = centerY - relZ * scale;

                const isSelected = selectedTargetId === t.id;

                ctx.globalAlpha = isSelected ? 1.0 : 0.7;
                this.drawTrackUncertainty(ctx, dx, dy, t.snr, this.getTypeColor(t.type));

                if (isSelected) {
                    this.drawSelectionHUD(ctx, dx, dy, 10, pulse);
                }

                this.drawTargetGlyph(ctx, t.type, dx, dy, false);
                this.drawDepthCue(ctx, t, dx, dy);

                ctx.fillStyle = '#ffffff';
                ctx.font = '8px monospace';
                ctx.globalAlpha = 1.0;
                ctx.fillText(t.id.replace('target-', 'T'), dx + 8, dy);
            });
        }

        if (this.scanActive) {
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(centerX, centerY, this.scanRadius * scale, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Own Ship Glyph (Center, Rotating)
        ctx.save();
        ctx.translate(centerX, centerY);
        // Heading 0 (North) should point Up (Screen -Y).
        // Standard canvas rotation 0 is Right (+X).
        // So we need rotation = Course - 90deg (in radians)
        // Course 0 -> -PI/2 (Up).
        // Course 90 -> 0 (Right).
        const rotation = ownShipPose.course - Math.PI / 2;
        ctx.rotate(rotation);

        ctx.fillStyle = '#00ff00';
        ctx.beginPath();
        ctx.moveTo(8, 0); // Tip points local +X (which is rot 0)
        ctx.lineTo(-6, -6);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    drawTrackUncertainty(ctx, x, y, snr, color) {
        const safeSnr = Math.max(0, snr || 0);
        const radius = 15 / Math.log(safeSnr + 1.1);
        const rx = Math.max(8, Math.min(80, radius));
        const ry = rx * 0.65;

        ctx.save();
        ctx.strokeStyle = color || '#00ffff';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    drawTargetGlyph(ctx, type, dx, dy, radialMode) {
        ctx.fillStyle = this.getTypeColor(type);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;

        if (type === 'SUBMARINE') {
            const s = radialMode ? 8 : 7;
            ctx.beginPath();
            ctx.moveTo(dx, dy - s);
            ctx.lineTo(dx + s, dy);
            ctx.lineTo(dx, dy + s);
            ctx.lineTo(dx - s, dy);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            return;
        }

        if (type === 'TORPEDO') {
            const up = radialMode ? 8 : 7;
            const side = radialMode ? 5 : 4;
            ctx.beginPath();
            ctx.moveTo(dx, dy - up);
            ctx.lineTo(dx + side, dy + side);
            ctx.lineTo(dx - side, dy + side);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            return;
        }

        if (type === 'BIOLOGICAL') {
            ctx.beginPath();
            ctx.arc(dx, dy, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            return;
        }

        if (type === 'STATIC') {
            const size = radialMode ? 12 : 10;
            ctx.fillRect(dx - size / 2, dy - size / 2, size, size);
            return;
        }

        if (radialMode) {
            ctx.beginPath();
            ctx.arc(dx, dy, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            return;
        }

        ctx.fillRect(dx - 5, dy - 5, 10, 10);
    }

    drawDepthCue(ctx, target, dx, dy) {
        if (!target) return;

        const terrainY = this.getTerrainHeight(target.x, target.z);
        const depth = Math.max(1, -terrainY - 2);
        const normalized = Math.max(0, Math.min(1, depth / 200));
        const hue = 190 + normalized * 40;
        const lightness = 60 - normalized * 20;

        ctx.save();
        ctx.strokeStyle = `hsl(${hue}, 100%, ${lightness}%)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(dx + 8, dy - 8);
        ctx.lineTo(dx + 8, dy + 8);
        ctx.stroke();
        ctx.restore();
    }

    drawTerrainContours(ctx, width, height, scale, angleOffset, radialMode, ownShipPose, headUp) {
        const layers = this.getContourLayers(width, height, scale, angleOffset, radialMode, ownShipPose, headUp);
        for (const layer of layers) {
            ctx.strokeStyle = layer.strokeStyle;
            ctx.lineWidth = layer.lineWidth;
            ctx.stroke(layer.path);
        }
    }

    getContourLayers(width, height, scale, angleOffset, radialMode, ownShipPose = { x: 0, z: 0, course: 0 }, headUp = false) {
        const px = Math.round((ownShipPose.x || 0) * 2) / 2;
        const pz = Math.round((ownShipPose.z || 0) * 2) / 2;
        const pc = Math.round((ownShipPose.course || 0) * 20) / 20;
        const key = `${radialMode ? 'radial' : 'grid'}:${width}:${height}:${scale}:${angleOffset}:${px}:${pz}:${pc}:${headUp ? 1 : 0}`;
        const cached = this.contourCache.get(key);
        if (cached) return cached;

        const centerX = width / 2;
        const centerY = height / 2;
        const worldSpan = Math.min(width, height) / scale;
        const maxWorld = worldSpan / 2;
        const contourLevels = [-18, -14, -10, -6, -2, 2, 6];
        const gridStep = 8;
        const layers = [];

        contourLevels.forEach((level, levelIndex) => {
            const major = levelIndex % 2 === 0;
            const path = new Path2D();

            for (let wx = -maxWorld; wx < maxWorld; wx += gridStep) {
                for (let wz = -maxWorld; wz < maxWorld; wz += gridStep) {
                    const s00 = this.localToWorld(wx, wz, ownShipPose, headUp);
                    const s10 = this.localToWorld(wx + gridStep, wz, ownShipPose, headUp);
                    const s11 = this.localToWorld(wx + gridStep, wz + gridStep, ownShipPose, headUp);
                    const s01 = this.localToWorld(wx, wz + gridStep, ownShipPose, headUp);

                    const p00 = { x: wx, y: wz, h: this.getTerrainHeight(s00.x, s00.z) };
                    const p10 = { x: wx + gridStep, y: wz, h: this.getTerrainHeight(s10.x, s10.z) };
                    const p11 = { x: wx + gridStep, y: wz + gridStep, h: this.getTerrainHeight(s11.x, s11.z) };
                    const p01 = { x: wx, y: wz + gridStep, h: this.getTerrainHeight(s01.x, s01.z) };

                    const caseCode =
                        (p00.h >= level ? 1 : 0) |
                        (p10.h >= level ? 2 : 0) |
                        (p11.h >= level ? 4 : 0) |
                        (p01.h >= level ? 8 : 0);

                    if (caseCode === 0 || caseCode === 15) continue;

                    const e0 = this.interpolateEdgePoint(p00, p10, level);
                    const e1 = this.interpolateEdgePoint(p10, p11, level);
                    const e2 = this.interpolateEdgePoint(p11, p01, level);
                    const e3 = this.interpolateEdgePoint(p01, p00, level);

                    const segments = this.getContourSegments(caseCode, e0, e1, e2, e3);
                    segments.forEach(([a, b]) => {
                        const sa = this.mapWorldToScreen(a.x, a.y, centerX, centerY, scale, angleOffset, radialMode);
                        const sb = this.mapWorldToScreen(b.x, b.y, centerX, centerY, scale, angleOffset, radialMode);
                        path.moveTo(sa.x, sa.y);
                        path.lineTo(sb.x, sb.y);
                    });
                }
            }

            layers.push({
                path,
                strokeStyle: major ? 'rgba(0, 180, 190, 0.7)' : 'rgba(0, 150, 160, 0.5)',
                lineWidth: major ? 1 : 0.6
            });
        });

        this.contourCache.set(key, layers);
        return layers;
    }

    interpolateEdgePoint(a, b, level) {
        const da = level - a.h;
        const db = b.h - a.h;
        let t = db === 0 ? 0.5 : da / db;
        if (!Number.isFinite(t)) t = 0.5;
        t = Math.max(0, Math.min(1, t));
        return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t
        };
    }

    getContourSegments(caseCode, e0, e1, e2, e3) {
        switch (caseCode) {
            case 1:
            case 14:
                return [[e3, e0]];
            case 2:
            case 13:
                return [[e0, e1]];
            case 3:
            case 12:
                return [[e3, e1]];
            case 4:
            case 11:
                return [[e1, e2]];
            case 5:
                return [[e3, e2], [e0, e1]];
            case 6:
            case 9:
                return [[e0, e2]];
            case 7:
            case 8:
                return [[e3, e2]];
            case 10:
                return [[e0, e3], [e1, e2]];
            default:
                return [];
        }
    }

    mapWorldToScreen(wx, wz, centerX, centerY, scale, angleOffset, radialMode) {
        if (radialMode) {
            const rotX = wx * Math.cos(angleOffset) - wz * Math.sin(angleOffset);
            const rotZ = wx * Math.sin(angleOffset) + wz * Math.cos(angleOffset);
            return {
                x: centerX + rotX * scale,
                y: centerY + rotZ * scale
            };
        }

        return {
            x: centerX + wx * scale,
            y: centerY + wz * scale
        };
    }

    toLocalFrame(worldX, worldZ, ownShipPose = { x: 0, z: 0, course: 0 }, headUp = false) {
        const dx = worldX - (ownShipPose.x || 0);
        const dz = worldZ - (ownShipPose.z || 0);
        if (!headUp) {
            // North Up Mode: +Z is World North. +X is World East.
            // On screen mapping (renderGrid):
            // dx = centerX + local.x * scale
            // dy = centerY + local.z * scale
            // If we want North to be UP (Screen -Y), then local.z should be -dz.
            // (When dz is positive, local.z is negative, so dy is centerY - val => Up).
            // If we want East to be RIGHT (Screen +X), then local.x should be dx.
            return { x: dx, z: -dz };
        }

        // Head Up Mode (Radial):
        // Ship Forward should be Screen Up (-Y).
        // Standard rotation matrix for clockwise active rotation:
        // x' = x cos(c) + z sin(c)
        // z' = -x sin(c) + z cos(c)
        // Wait, Ship Heading is 'course'.
        // If course=0 (North, +Z), we want +Z to be "Up".
        // If course=90 (East, +X), we want +X to be "Up".
        // This is a coordinate transform into the Ship's Frame.
        // Ship Frame: Forward is +Z_local, Right is +X_local.
        // World Vector: V = (dx, dz).
        // Rotate V by -course.
        // x_local = right-cross-track distance.
        // z_local = forward-along-track distance.

        // R(-theta):
        // x' = x cos(-c) - z sin(-c) = x cos + z sin
        // z' = x sin(-c) + z cos(-c) = -x sin + z cos

        const c = Math.cos(ownShipPose.course);
        const s = Math.sin(ownShipPose.course);

        const x_local = dx * c + dz * s; // Right component?
        const z_local = -dx * s + dz * c; // Forward component?

        // Let's test. Course=0 (N). c=1, s=0.
        // x_local = dx. z_local = dz.
        // If target is North of ship (+dz), z_local is positive.
        // We want Screen Up.
        // renderRadial uses: dy = centerY - local.z * scale.
        // So positive z_local becomes Screen Up. Correct.

        // Test Course=90 (E). c=0, s=1.
        // Target is East of ship (+dx).
        // x_local = dx*0 + dz*1 = dz? (If dz=0, x_local=0).
        // z_local = -dx*1 + dz*0 = -dx.
        // If target is East (Forward of ship), dz=0, dx>0.
        // z_local = -positive. Negative.
        // dy = centerY - (-pos) = centerY + pos (Screen Down).
        // INCORRECT. Target ahead should be Screen Up.

        // Let's try standard maritime headings:
        // C=0 -> North (+Z). C=90 -> East (+X).
        // Vector (sin(c), cos(c)) is Forward.
        // Vector (cos(c), -sin(c)) is Right.

        // Project (dx, dz) onto Forward:
        // forward_dist = dx * sin(c) + dz * cos(c)
        // Project (dx, dz) onto Right:
        // right_dist = dx * cos(c) + dz * (-sin(c))

        // forward_dist should map to Screen Up (-Y).
        // right_dist should map to Screen Right (+X).

        // If renderRadial uses: dx = center + local.x, dy = center - local.z.
        // Then local.x should be right_dist.
        // local.z should be forward_dist.

        const right_dist = dx * c - dz * s;
        const forward_dist = dx * s + dz * c;

        return {
            x: right_dist,
            z: forward_dist
        };
    }

    localToWorld(screenOffsetX, screenOffsetY, ownShipPose = { x: 0, z: 0, course: 0 }, headUp = false) {
        // screenOffsetX = local.x (right_dist)
        // screenOffsetY = mapped from local.z?
        // Note: pickTarget passes (x - centerX, y - centerY) usually?
        // Wait, render passes x, z from toLocalFrame.
        // renderGrid: dx = center + local.x, dy = center + local.z (if !headUp, but I changed it to -dz above)
        // renderRadial: dx = center + local.x, dy = center - local.z.

        // Let's standardize localToWorld input to match toLocalFrame output format.
        // localX = right_dist (or Easting if !headUp)
        // localZ = forward_dist (or Northing if !headUp, but sign flipped?)

        // If !headUp:
        // local.x = dx.
        // local.z = -dz.
        // So dx = localX. dz = -localZ.

        if (!headUp) {
            return {
                x: (ownShipPose.x || 0) + screenOffsetX,
                z: (ownShipPose.z || 0) - screenOffsetY // because we returned -dz
            };
        }

        // If headUp:
        // localX = right_dist
        // localZ = forward_dist
        // dx = right * RightVec.x + forward * ForwardVec.x
        // dz = right * RightVec.z + forward * ForwardVec.z

        // ForwardVec = (sin, cos)
        // RightVec = (cos, -sin)

        const c = Math.cos(ownShipPose.course);
        const s = Math.sin(ownShipPose.course);

        const r = screenOffsetX;
        const f = screenOffsetY; // Assuming caller passes forward_dist here

        const dx = r * c + f * s;
        const dz = r * (-s) + f * c;

        return {
            x: (ownShipPose.x || 0) + dx,
            z: (ownShipPose.z || 0) + dz
        };
    }

    getTypeColor(type) {
        switch (type) {
            case 'SUBMARINE': return '#00ffff';
            case 'TORPEDO': return '#ff0000';
            case 'BIOLOGICAL': return '#00ff00';
            case 'STATIC': return '#888888';
            default: return '#ff8800';
        }
    }

    drawSelectionHUD(ctx, x, y, size, pulse) {
        ctx.save();
        ctx.translate(x, y);

        const glowAlpha = 0.2 + Math.sin(pulse * Math.PI * 2) * 0.1;
        ctx.strokeStyle = `rgba(255, 0, 0, ${glowAlpha})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, size * (1.1 + Math.sin(pulse * Math.PI * 2) * 0.05), 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 2;
        const cornerLen = size * 0.4;
        const offset = size * 1.2;

        for (let i = 0; i < 4; i++) {
            ctx.rotate(Math.PI / 2);
            ctx.beginPath();
            ctx.moveTo(offset - cornerLen, -offset);
            ctx.lineTo(offset, -offset);
            ctx.lineTo(offset, -offset + cornerLen);
            ctx.stroke();
        }

        ctx.restore();
    }
}
