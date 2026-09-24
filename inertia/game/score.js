export const SCORE_PER_NIGHT = 100;
export const SCORE_PER_KILL = 5;
const BEST_KEY = 'block-survival:best';
export const computeScore = (nightsSurvived, kills) => nightsSurvived * SCORE_PER_NIGHT + kills * SCORE_PER_KILL;
export const nightsSurvived = (night, phase) => Math.max(0, phase === 'night' ? night - 1 : night);
export function loadBest() {
    try {
        return Number(localStorage.getItem(BEST_KEY)) || 0;
    }
    catch {
        return 0;
    }
}
export function saveBest(score) {
    const best = Math.max(loadBest(), score);
    try {
        localStorage.setItem(BEST_KEY, String(best));
    }
    catch {
    }
    return best;
}
export const formatTime = (seconds) => {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(s % 60).padStart(2, '0')}`;
};
export const timeAgo = (iso, now = Date.now()) => {
    const t = Date.parse(iso);
    if (Number.isNaN(t))
        return 'a while ago';
    const s = Math.max(0, Math.floor((now - t) / 1000));
    if (s < 60)
        return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 48)
        return `${h} h ago`;
    return `${Math.floor(h / 24)} d ago`;
};
//# sourceMappingURL=score.js.map