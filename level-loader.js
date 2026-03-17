/**
 * Manages loading campaign levels from JSON files and tracking progression in localStorage.
 * Used by XBattleGame for campaign mode — Quick Play bypasses this entirely.
 */
class LevelLoader {
    constructor() {
        this.index = null;
        this.currentLevel = null;
        this.currentLevelId = 1;
        this.currentDifficulty = 'easy';
    }

    async loadIndex() {
        const res = await fetch('levels/index.json');
        this.index = await res.json();
        return this.index;
    }

    async loadLevel(levelId, difficulty) {
        if (!this.index) await this.loadIndex();
        const entry = this.index.levels.find(l => l.id === levelId);
        if (!entry) throw new Error(`Level ${levelId} not found`);
        const path = `levels/${entry[difficulty]}`;
        const res = await fetch(path);
        this.currentLevel = await res.json();
        this.currentLevelId = levelId;
        this.currentDifficulty = difficulty;
        return this.currentLevel;
    }

    getUnlockedLevel(difficulty) {
        return parseInt(localStorage.getItem(`xbattle_unlocked_${difficulty}`) || '1');
    }

    unlockNextLevel(difficulty, currentLevel) {
        const current = this.getUnlockedLevel(difficulty);
        if (currentLevel >= current) {
            localStorage.setItem(`xbattle_unlocked_${difficulty}`, String(currentLevel + 1));
        }
    }

    isLevelUnlocked(levelId, difficulty) {
        return levelId <= this.getUnlockedLevel(difficulty);
    }

    hasNextLevel() {
        return this.index && this.currentLevelId < this.index.totalLevels;
    }

    getNextLevelId() {
        return this.currentLevelId + 1;
    }

    getLevelInfo(levelId) {
        if (!this.index) return null;
        return this.index.levels.find(l => l.id === levelId) || null;
    }
}
