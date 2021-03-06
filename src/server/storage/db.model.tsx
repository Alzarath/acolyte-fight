import * as Firestore from '@google-cloud/firestore';
import * as m from '../../shared/messages.model';

export const Singleton = 'singleton';

export namespace Collections {
    export const User = 'user';
    export const UserRatingHistory = 'ratingHistory';
    export const AcoDecay = 'acoDecay';
    export const RatingDecay = 'ratingDecay';
    export const Game = 'game';
    export const GlobalMod = 'mod';
    export const Scoreboard = 'scoreboard';
    export const ScoreboardEntries = 'entries';
    export const Ban = 'ban';
    export const Loadouts = 'loadouts';
}

export interface GlobalMod {
    json: string;
}

export interface RatingDecaySingleton {
    updated: Firestore.Timestamp;
}

export interface User {
    accessed: Firestore.Timestamp;
    loggedIn: boolean;
    accessKeys: string[];
    settings: UserSettings;
    ratings: UserRatingLookup;
}
export interface UserSettings {
    name: string;
    buttons: KeyBindings;
    rebindings: KeyBindings;
    options: m.GameOptions;
}
export interface UserRatingLookup {
    [category: string]: UserRating;
}
export interface UserRating {
    acoExposure?: number;
    aco?: number;
    acoGames?: number;
    acoUnranked?: number;
    acoDeflate?: number;
    numGames: number;
    killsPerGame: number;
    damagePerGame: number;
    winRate: number;
}

export interface UserRatingHistoryItem {
    unixDate: number;
    ratings: UserRatingLookup;
}

export interface AcoDecayKey {
    userId: string;
    category: string;
    unixCeiling: number;
}
export interface AcoDecay extends AcoDecayKey {
    acoDelta: number;
    acoGamesDelta: number;
}

export interface AcoDeflate {
    updated: Firestore.Timestamp;
}

export interface Game {
    unixTimestamp: number;
    userIds: string[];
    partyId: string;
    stats: GameStats;
}
export interface GameStats {
    category: string;
    winner: string; // userHash
    winners?: string[]; // user hashes
    winnerUserId?: string;
    lengthSeconds: number;
    players: PlayerStats[];
    server: string;
}
export interface PlayerStats {
    userId?: string;
    userHash: string;
    teamId?: string;
    name: string;
    kills: number;
    outlasts: number;
    damage: number;
    ticks: number;
    rank: number;

    spellIds?: string[];

    initialNumGames?: number;
    initialAco?: number;
    initialAcoGames?: number;
    initialAcoExposure?: number;

    acoChanges?: AcoChangeMsg[];
    acoDelta?: number;
}

export interface AcoChangeMsg {
    otherTeamId?: string;
    delta: number;
    e?: number;
}

export interface PlayerScore {
    segment: string;

    userHash: string;
    name: string;
    userId?: string;

    wins: number;
    kills: number;
    damage: number;
    outlasts: number;
    games: number;

    expiry: number; // unix timestamp
}

export interface Ban {
    ips: string[];
    authTokens: string[];
    userIds: string[];
}

export interface Loadouts {
    loadouts: Loadout[];
}

export interface Loadout {
    name: string;
    buttons: KeyBindings;
}