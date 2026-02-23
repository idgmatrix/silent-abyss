import { describe, expect, it } from 'vitest';
import { RENDER_STYLE_TOKENS, resolveVisualMode, VISUAL_MODES } from '../src/render-style-tokens.js';
import { Tactical2DRenderer } from '../src/tactical-renderer-2d.js';

describe('render style tokens', () => {
    it('resolves unsupported visual modes to stealth', () => {
        expect(resolveVisualMode('unknown-mode')).toBe(VISUAL_MODES.STEALTH);
        expect(resolveVisualMode(null)).toBe(VISUAL_MODES.STEALTH);
    });

    it('exposes tactical and sonar token groups', () => {
        expect(RENDER_STYLE_TOKENS.tactical2d).toBeTruthy();
        expect(RENDER_STYLE_TOKENS.sonar2d).toBeTruthy();
        expect(RENDER_STYLE_TOKENS.tactical2d.modes[VISUAL_MODES.ALARM]).toBeTruthy();
    });

    it('clears contour cache when 2d visual settings change', () => {
        const renderer = new Tactical2DRenderer();
        renderer.contourCache.set('test', [{ path: null }]);
        renderer.setEnhancedVisualsEnabled(false);
        expect(renderer.contourCache.size).toBe(0);

        renderer.contourCache.set('test', [{ path: null }]);
        renderer.setVisualMode(VISUAL_MODES.ENGAGEMENT);
        expect(renderer.contourCache.size).toBe(0);
    });
});

