import * as moment from 'moment';
import * as m from '../game/messages.model';

export interface ServerStore {
    nextGameId: 0;
    nextPartyId: 0;
    numConnections: number;
    playerCounts: PlayerCounts;
    rooms: Map<string, Room>; // id -> room
    parties: Map<string, Party>; // id -> party
    joinableGames: Set<string>; // game ids
    activeGames: Map<string, Game>; // id -> game
    storedGameIds: Set<string>;
    recentTickMilliseconds: number[];
}

export interface LocationStore {
    region: string;
    server: string;
    upstreamSuffix: string;
}

export interface User {
    userId: string;
    loggedIn: boolean;
    settings: UserSettings;
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
    rating: number;
    rd: number;
    numGames: number;
    killsPerGame: number;
    damagePerGame: number;
    winRate: number;
}

export interface Replay {
    id: string;
    segment: string;

    roomId: string | null;
    partyId: string | null;
    isPrivate: boolean;

    mod: Object;
    allowBots: boolean;

    numPlayers: number;
	history: m.TickMsg[];
}

export interface Game extends Replay {
    created: moment.Moment;

    active: Map<string, Player>; // socketId -> Player
    bots: Map<string, string>; // heroId -> socketId
    playerNames: string[];
    userIds: Set<string>;
    socketIds: Set<string>;

    tick: number;
    winTick: number | null;

    scores: Map<string, m.GameStatsMsg>; // socketId -> final score
    joinable: boolean;
    activeTick: number;
    closeTick: number;
    ranked: boolean;

    actions: Map<string, m.ActionMsg>; // heroId -> actionData
    messages: m.TextMsg[];
}

export interface Player {
    socketId: string;
    partyId: string;
	heroId: string;
    name: string;
}

export interface Room {
    id: string;
    created: moment.Moment;
    accessed: moment.Moment;
    mod: ModTree;
    isCustom: boolean;
}

export interface Party extends PartyStatus {
    id: string;
    created: moment.Moment;
    modified: moment.Moment;
    active: Map<string, PartyMember>; // socketId -> party member
}

export interface PartyStatus {
    roomId: string;
    isPrivate: boolean;
    isLocked: boolean;
    initialObserver: boolean;
}

export interface PartyMember extends JoinParameters, PartyMemberStatus {
}

export interface JoinParameters {
    socketId: string;
    name: string;
    authToken: string;
    keyBindings: KeyBindings;
    isBot: boolean;
    isMobile: boolean;
    version: string;
}

export interface PartyMemberStatus {
    ready: boolean;
    isObserver: boolean;
    isLeader: boolean;
}

export interface PartyGameAssignment {
	partyMember: PartyMember;
	game: Game;
	heroId: string;
}

export interface PlayerCounts {
    [category: string]: number;
}