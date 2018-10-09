import _ from 'lodash';
import crypto from 'crypto';
import * as g from './server.model';
import * as m from '../game/messages.model';
import * as dbStorage from './dbStorage';
import * as users from './users';
import { getLocation } from './mirroring';

interface CandidateHash {
    gameStats: m.GameStats;
    hash: string;
    frequency: number;
}

export async function saveGame(game: g.Game) {
    const gameStats = findStats(game);
    if (!gameStats) {
        return;
    }

    const location = getLocation();
    const gameKey = dbStorage.gameKey(location.server, game.id);
    await dbStorage.saveGameStats(gameKey, gameStats);
    for (const playerStats of gameStats.players) {
        if (users.isUserId(playerStats.userHash)) {
            await dbStorage.addGameToUserStats(gameKey, gameStats, playerStats);
        }
    }
}

function findStats(game: g.Game): m.GameStats {
    if (game.scores.size <= 1) {
        // Only store multiplayer games because people can fake stats otherwise
        return null;
    }

    const corroborateThreshold = Math.max(2, Math.ceil(game.scores.size / 2));

    const candidates = new Map<string, CandidateHash>();
    for (const gameStats of game.scores.values()) {
        const hash = hashStats(gameStats);
        if (candidates.has(hash)) {
            const candidate = candidates.get(hash);
            candidate.frequency += 1;

            if (candidate.frequency >= corroborateThreshold) {
                // This candidate has been corroborated by enough players
                return candidate.gameStats;
            }
        } else {
            candidates.set(hash, { gameStats, hash, frequency: 1 });
        }
    }

    // No candidates corroborated
    return null;
}

export function hashStats(gameStats: m.GameStats): string {
    return crypto.createHash('md5').update(JSON.stringify(gameStats)).digest('hex');
}