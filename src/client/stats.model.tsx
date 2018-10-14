export interface GameStats {
    id: string;
    category: string;
    timestamp: string;
    self: string; // user hash
    winner?: string; // User hash
    lengthSeconds?: number;
    players: PlayerStatsLookup;
    server?: string;
}

export interface PlayerStatsLookup {
    [userHash: string]: PlayerStats;
}

export interface PlayerStats {
    userId?: string;
    userHash: string;
    name: string;
    kills: number;
    damage: number;
    ratingDelta?: number;
}