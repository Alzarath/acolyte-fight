import * as Firestore from '@google-cloud/firestore';

export interface UserSettingsData {
    name: string;
    buttons: KeyBindings;
    rebindings: KeyBindings;
}

export interface AccessKeyUserData {
    userId: string;
}

export interface UserStatsData {
    categoryStats: { [category: string]: UserCategoryStatsData }
}

export interface UserCategoryStatsData {
    name: string;

    numWins: number;
    numGames: number;
    totalDamage: number;
    totalKills: number;

    winRate: number;
    winRateLowerBound: number;
    averageDamage: number;
    averageKills: number;
}

export interface UserGameReference {
    gameKey: string;
    unixTimestamp: number;
}