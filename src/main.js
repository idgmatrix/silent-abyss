import { GameOrchestrator } from './game-orchestrator.js';

const orchestrator = new GameOrchestrator();
const startBtn = document.getElementById('start-btn');
const launchOverlay = document.getElementById('launch-overlay');
const launchStatus = document.getElementById('launch-status');
let startPromise = null;

// Expose cleanup for global access (console debugging, tests)
window.cleanupSystems = () => {
    orchestrator.stop();
};

// Also cleanup on page unload
window.addEventListener('beforeunload', () => {
    window.cleanupSystems();
});

async function startGame({ skipTransition = false } = {}) {
    if (startPromise) return startPromise;

    if (startBtn) startBtn.disabled = true;
    if (launchStatus) launchStatus.textContent = 'TACTICAL CORE INITIALIZING';

    startPromise = orchestrator.init();

    try {
        await startPromise;
        document.body.classList.remove('game-awaiting-start');
        if (launchStatus) launchStatus.textContent = 'AUDIO LINK ESTABLISHED';

        if (launchOverlay) {
            if (skipTransition) {
                launchOverlay.remove();
            } else {
                launchOverlay.classList.add('is-departing');
                launchOverlay.addEventListener('transitionend', () => launchOverlay.remove(), { once: true });
                window.setTimeout(() => launchOverlay.remove(), 700);
            }
        }
    } catch (error) {
        startPromise = null;
        if (startBtn) startBtn.disabled = false;
        if (launchStatus) launchStatus.textContent = 'INITIALIZATION FAILED / RETRY';
        console.error('Failed to initialize tactical core:', error);
    }

    return startPromise;
}

if (startBtn) startBtn.addEventListener('click', () => startGame());

try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
        startGame({ skipTransition: true });
    }
} catch {
    // Ignore query-string parsing failures in non-browser contexts.
}
