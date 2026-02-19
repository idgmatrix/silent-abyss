import { GameOrchestrator } from './game-orchestrator.js';

const orchestrator = new GameOrchestrator();

// Expose cleanup for global access (console debugging, tests)
window.cleanupSystems = () => {
    orchestrator.stop();
};

// Also cleanup on page unload
window.addEventListener('beforeunload', () => {
    window.cleanupSystems();
});

// The start button logic is now handled inside UIManager (bound to orchestrator.init)
// But we need to make sure UIManager is initialized enough to bind the button.
// GameOrchestrator constructor instantiates UIManager, but UIManager.init isn't called until orchestrator.init is called.
// Wait, UIManager.bindGlobalHandlers is called in UIManager.init.
// If I don't call anything, the start button won't have a listener.

// I should probably move the initial button binding out of UIManager.init or have a "pre-init" phase.
// Or just call caching and binding in the constructor of UIManager?
// No, caching DOM elements might fail if DOM isn't ready, but main.js runs after DOM load usually (if type module).

// Let's look at how main.js was before.
// document.getElementById('start-btn').onclick = initSystems; was at the bottom.

// So I should probably manually bind the start button here or expose a method to bind initial listeners.
// But UIManager.init() does a lot of other things that expect systems to be ready.

// I'll make a separate method in UIManager or just bind the start button here.
// Actually, `orchestrator.uiManager.bindGlobalHandlers()` includes the start button.
// But `orchestrator.init()` calls `uiManager.init()`.
// This creates a chicken-and-egg problem for the start button.

// Solution:
// Bind the start button in main.js to orchestrator.init().

const startBtn = document.getElementById('start-btn');
if (startBtn) {
    startBtn.onclick = () => orchestrator.init();
}

// But wait, UIManager binds other things too.
// When orchestrator.init() runs, it calls uiManager.init() which re-binds the start button. That's fine.

// What about other initial UI states?
// main.js previously didn't do much before initSystems except declare variables.
// It did define window.cleanupSystems.

// So:
// 1. Create orchestrator.
// 2. Bind start button to orchestrator.init().
// 3. Expose cleanup.

// One detail: In the original main.js, `document.querySelector('input[name="view-mode"]').forEach(...)` was outside initSystems.
// `UIManager.bindViewModeHandlers` is in `init()`.
// If the user changes view mode before start, it won't work.
// But they can't see the tactical view before start anyway (setup screen is overlay).

// Let's verify `UIManager` binds `rpm-slider`.
// In original `main.js`, `rpm-slider.oninput` was outside `initSystems`.
// This let the user change RPM on the setup screen?
// `rpm-display.innerText` update was inside `oninput`.
// `currentRpmValue` was updated.

// If I move it to `UIManager.init()`, the slider on the setup screen won't update the text until game starts.
// But the setup screen doesn't have an RPM slider usually. The engine controls are hidden until start.
// `document.getElementById('engine-controls').classList.remove('hidden');` is in `initSystems`.
// So it seems fine.

// However, `UIManager.cacheDomElements()` should be called safely.
// In `main.js`, `cacheDomElements` was called inside `initSystems`.
// So it seems the intention is to only initialize UI interactions once the game starts.

// Check if `start-btn` is the only entry point.
// Yes.

// Okay, so `main.js` is quite simple.

