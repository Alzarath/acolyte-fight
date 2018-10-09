import * as Firestore from '@google-cloud/firestore';
import * as db from './db.model';
import * as constants from '../game/constants';
import * as m from '../game/messages.model';
import * as mathUtils from '../game/mathUtils';
import * as s from './server.model';
import * as users from './users';

const firestore = new Firestore.Firestore({
    timestampsInSnapshots: true,
});

export function init() {
}

export async function getUserIdFromAccessKey(accessKey: string): Promise<string> {
    if (!accessKey) {
        return null;
    }

    const record = await firestore.collection('accessKey').doc(accessKey).get()
    const data = record.data() as db.AccessKeyUserData;
    return data ? data.userId : null;
}

export async function getUserById(userId: string): Promise<s.UserSettings> {
    if (!userId) {
        return null;
    }

    const record = await firestore.collection('userSettings').doc(userId).get();
    const data = record.data() as db.UserSettingsData;
    if (data) {
        const user: s.UserSettings = {
            userId: record.id,
            name: data.name,
            buttons: data.buttons,
            rebindings: data.rebindings,
        };
        return user;
    } else {
        return null;
    }
}

export async function createOrUpdateUser(user: s.UserSettings): Promise<void> {
    const data: db.UserSettingsData = {
        name: user.name,
        buttons: user.buttons,
        rebindings: user.rebindings,
    };
    await firestore.collection('userSettings').doc(user.userId).set(data);
}

export async function associateAccessKey(accessKey: string, userId: string): Promise<void> {
    const data: db.AccessKeyUserData = { userId };
    await firestore.collection('accessKey').doc(accessKey).set(data);
}

export async function disassociateAccessKey(accessKey: string): Promise<void> {
    await firestore.collection('accessKey').doc(accessKey).delete();
}

export function gameKey(serverId: string, gameId: string) {
    return `${serverId}.${gameId}`;
}

export async function saveGameStats(gameKey: string, gameStats: m.GameStats) {
    await firestore.collection('gameStats').doc(gameKey).set(gameStats);
}

export async function addGameToUserStats(gameKey: string, gameStats: m.GameStats, player: m.PlayerStats) {
    const data: db.UserGameReference = { gameKey, unixTimestamp: gameStats.unixTimestamp };
    await firestore.collection('userStats').doc(player.userHash).collection('games').doc(gameKey).set(data);

    await firestore.runTransaction(async (transaction) => {
        const userStatsRef = firestore.collection('userStats').doc(player.userHash);

        let userStats = (await transaction.get(userStatsRef)).data() as db.UserStatsData;
        if (!userStats) {
            userStats = {
                categoryStats: {},
            };
        }

        let categoryStats = userStats.categoryStats[gameStats.category];
        if (!categoryStats) {
            categoryStats = {
                name: player.name,
                numGames: 0,
                numWins: 0,
                totalDamage: 0,
                totalKills: 0,
                averageDamage: 0,
                averageKills: 0,
                winRate: 0,
                winRateLowerBound: 0,
            }
            userStats.categoryStats[gameStats.category] = categoryStats;
        }

        categoryStats.numGames++;
        if (gameStats.winner === player.userHash) {
            categoryStats.numWins++;
        }

        categoryStats.totalDamage += player.damage;
        categoryStats.totalKills += player.kills;

        categoryStats.winRate = categoryStats.numWins / categoryStats.numGames;
        categoryStats.averageDamage = categoryStats.totalDamage / categoryStats.numGames;
        categoryStats.averageKills = categoryStats.totalKills / categoryStats.numGames;
        categoryStats.winRateLowerBound = mathUtils.wilsonLowerBound(categoryStats.numGames, categoryStats.numWins, constants.Stats.WilsonConfidence);

        transaction.set(userStatsRef, userStats);
    });
}