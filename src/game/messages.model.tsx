import * as c from './world.model';

export const AuthCookieName = "enigma-auth";

export namespace ActionType {
    export const Environment = "environment";
    export const Join = "join";
    export const Bot = "bot";
	export const Leave = "leave";
	export const GameAction = "game";
	export const CloseGame = "close";
}

export type ActionMsg =
    EnvironmentMsg
    | JoinActionMsg
    | BotActionMsg
    | LeaveActionMsg
    | CloseGameMsg
    | GameActionMsg;

export interface ActionMsgBase {
    actionType: string;
    gameId: string;
    heroId: string;
}

export interface EnvironmentMsg extends ActionMsgBase {
    actionType: "environment";
    seed: number;
}

export interface JoinActionMsg extends ActionMsgBase {
    actionType: "join";
    playerName: string;
    keyBindings: KeyBindings;
    isBot: boolean;
    isMobile: boolean;
}

export interface BotActionMsg extends ActionMsgBase {
    actionType: "bot";
    keyBindings: KeyBindings;
}

export interface LeaveActionMsg extends ActionMsgBase {
    actionType: "leave";
}

export interface CloseGameMsg extends ActionMsgBase {
    actionType: "close";
    closeTick: number;
}

export interface GameActionMsg extends ActionMsgBase {
    actionType: "game";
    spellId: string;
    targetX: number;
    targetY: number;
}

export interface TickMsg {
    gameId: string;
    tick: number;
    actions: ActionMsg[];
}

export interface JoinMsg {
    gameId: string | null;
    room: string | null;
    name: string;
    keyBindings: KeyBindings;
    isBot: boolean;
    isMobile: boolean;
    observe: boolean;
}

export interface JoinResponse {
    success: true;
}
export type JoinResponseMsg = JoinResponse | ErrorResponseMsg;

export interface StartGameMsg {
    gameId: string;
}

export interface BotMsg {
    gameId: string;
}

export interface LeaveMsg {
    gameId: string;
}

export interface ErrorResponseMsg {
    success: false;
    error: string;
}

export interface ProxyRequestMsg {
    server: string;
}

export interface ProxyResponse {
    success: true;
}

export type ProxyResponseMsg = ProxyResponse | ErrorResponseMsg;

export interface JoinRoomRequest {
    roomId: string;
}

export interface JoinRoomResponse {
    success: true;
    roomId: string;
    mod: Object;
    allowBots: boolean;
}

export type JoinRoomResponseMsg = JoinRoomResponse | ErrorResponseMsg;

export interface HeroMsg {
    gameId: string;
    heroId: string | null; // null means observer
    room: string | null;

    mod: Object;
    allowBots: boolean;

    history: TickMsg[];
    numGames: number;
    numPlayers: number;
}

export interface CreatePartyRequest {
    roomId: string;
}
export interface CreatePartyResponse {
    success: true;
    partyId: string;
    roomId: string;
    server: string;
}
export type CreatePartyResponseMsg = CreatePartyResponse | ErrorResponseMsg;


export interface PartyRequest {
    joining: boolean;
    partyId: string;
    playerName: string;
    keyBindings: KeyBindings;
    isBot: boolean;
    isMobile: boolean;
    ready: boolean;
}
export interface PartyResponse {
    success: true;
    partyId: string;
    members: PartyMemberMsg[];
    roomId: string;
    server: string;
}
export type PartyResponseMsg = PartyResponse | ErrorResponseMsg;


export interface LeavePartyRequest {
    partyId: string;
}
export interface LeavePartyResponse {
    success: true;
    partyId: string;
}
export type LeavePartyResponseMsg = LeavePartyResponse | ErrorResponseMsg;


export interface PartyMsg {
    partyId: string;
    members: PartyMemberMsg[];
}

export interface PartyMemberMsg {
    socketId: string;
    name: string;
    ready: boolean;
}


export interface ServerStats {
    numGames: number;
    numPlayers: number;
    serverLoad: number;
}

export interface GameListMsg {
    games: GameMsg[];
}

export interface GameMsg {
    id: string;
    createdTimestamp: string;
    playerNames: string[];
    numActivePlayers: number;
    joinable: boolean;
    numTicks: number;
    roomId: string;
    server: string;
}

export interface LocationMsg {
    targetServer: string;
    currentServer: string;
}

export interface CreateRoomRequest {
    mod: Object;
    allowBots: boolean;
}
export interface CreateRoomResponse {
    success: true;
    roomId: string;
    server: string;
}
export type CreateRoomResponseMsg = CreateRoomResponse | ErrorResponseMsg;