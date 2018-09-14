import * as c from './world.model';

export const AuthCookieName = "enigma-auth";

export namespace ActionType {
    export const Environment = "environment";
    export const Join = "join";
    export const Bot = "bot";
	export const Leave = "leave";
	export const GameAction = "game";
	export const CloseGame = "close";
	export const Text = "text";
}

export type ActionMsg =
    EnvironmentMsg
    | JoinActionMsg
    | BotActionMsg
    | LeaveActionMsg
    | CloseGameMsg
    | GameActionMsg
    | TextMsg

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
    userHash: string | null;
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

export interface TextMsg extends ActionMsgBase {
    actionType: "text";
    text: string;
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
    server: string;
}

export type ProxyResponseMsg = ProxyResponse | ErrorResponseMsg;


export interface ServerInstanceRequest {
}
export interface ServerInstanceResponse {
    success: true;
    instanceId: string;
    server: string;
}
export type ServerInstanceResponseMsg = ServerInstanceResponse | ErrorResponseMsg;


export interface JoinRoomRequest {
    roomId: string;
}

export interface JoinRoomResponse {
    success: true;
    roomId: string;
    mod: Object;
}

export type JoinRoomResponseMsg = JoinRoomResponse | ErrorResponseMsg;

export interface HeroMsg {
    gameId: string;
    heroId: string | null; // null means observer
    room: string | null;

    mod: Object;
    allowBots: boolean;

    history: TickMsg[];
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
    isObserver: boolean;
    ready: boolean;
}
export interface PartyResponse {
    success: true;
    partyId: string;
    members: PartyMemberMsg[];
    roomId: string;
    server: string;
    isPrivate: boolean;
}
export type PartyResponseMsg = PartyResponse | ErrorResponseMsg;


export interface PartySettingsRequest {
    partyId: string;
    roomId?: string;
    isPrivate?: boolean;
}
export interface PartySettingsResponse {
    success: true;
    partyId: string;
    roomId: string;
    isPrivate: boolean;
}
export type PartySettingsResponseMsg = PartySettingsResponse | ErrorResponseMsg;


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
    roomId: string;
    members: PartyMemberMsg[];
    isPrivate: boolean;
}

export interface PartyMemberMsg {
    socketId: string;
    name: string;
    ready: boolean;
    isBot: boolean;
    isObserver: boolean;
}


export interface ServerStats {
    numGames: number;
    numPlayers: number;
    serverLoad: number;
}

export interface GameListRequest {
    ids: string[];
}
export interface GameListResponse {
    success: true;
    ids: string[];
}
export type GameListResponseMsg = GameListResponse | ErrorResponseMsg;


export interface CreateRoomRequest {
    mod: Object;
}
export interface CreateRoomResponse {
    success: true;
    roomId: string;
    server: string;
}
export type CreateRoomResponseMsg = CreateRoomResponse | ErrorResponseMsg;