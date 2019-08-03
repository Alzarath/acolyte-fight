import _ from 'lodash';
import uniqid from 'uniqid';
import wu from 'wu';
import * as auth from './auth';
import * as blacklist from './blacklist';
import * as segments from '../game/segments';
import * as games from './games';
import { getAuthTokenFromSocket } from './auth';
import { getStore } from './serverStore';
import { getLocation } from './mirroring';
import { logger } from './logging';
import { required, optional } from './schema';
import * as PlayerName from '../game/sanitize';
import * as g from './server.model';
import * as m from '../game/messages.model';
import * as constants from '../game/constants';
import * as gameStorage from './gameStorage';
import * as mirroring from './mirroring';
import * as modder from './modder';
import * as online from './online';
import * as parties from './parties';

let shuttingDown = false;
let upstreams = new Map<string, SocketIOClient.Socket>(); // socketId -> upstream

let io: SocketIO.Server = null;
const instanceId = uniqid('s-');

export function attachToSocket(_io: SocketIO.Server) {
	io = _io;
    io.on('connection', onConnection);
	games.attachToTickEmitter(data => io.to(data.gameId).emit("tick", data));
	games.attachFinishedGameListener(emitGameResult);
	online.attachOnlineEmitter(emitOnline);
}

export function shutdown() {
	shuttingDown = true;

	if (io) {
		io.emit('shutdown', {});
	}
}

function getIPs(socket: SocketIO.Socket) {
	const from = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
	if (_.isString(from)) {
		return from.split(',').map(ip => ip.trim());
	} else {
		return [from];
	}
}

function onConnection(socket: SocketIO.Socket) {
	const authToken = getAuthTokenFromSocket(socket);
	const ips = getIPs(socket);
	logger.info(`socket ${socket.id} connected - user ${authToken} - ${ips.join(', ')}`);

	if (shuttingDown) {
		logger.info(`socket ${socket.id} disconnecting now - shutting down`);
		socket.disconnect();
		return;
	}


    ++getStore().numConnections;
    
    games.onConnect(socket.id, authToken);

	socket.on('disconnect', () => {
		const upstream = upstreams.get(socket.id);
		if (upstream) {
			upstream.disconnect();
			upstreams.delete(socket.id);
		}

		--getStore().numConnections;
		logger.info(`socket ${socket.id} disconnected${upstream ? " + upstream" : ""}`);

		games.onDisconnect(socket.id, authToken);
		const changedParties = parties.onDisconnect(socket.id);
		changedParties.forEach(party => emitParty(party));
	});

	socket.use((packet: SocketIO.Packet, next) => {
		const upstream = upstreams.get(socket.id);
		if (upstream) {
			(upstream as any).emit(...packet);
		} else {
			next();
		}
	});

	socket.on('instance', (data, callback) => onInstanceMsg(socket, authToken, data, callback));
	socket.on('room', (data, callback) => onRoomMsg(socket, authToken, data, callback));
	socket.on('room.create', (data, callback) => onRoomCreateMsg(socket, authToken, data, callback));
	socket.on('party', (data, callback) => onPartyMsg(socket, authToken, data, callback));
	socket.on('party.create', (data, callback) => onPartyCreateMsg(socket, authToken, data, callback));
	socket.on('party.settings', (data, callback) => onPartySettingsMsg(socket, authToken, data, callback));
	socket.on('party.status', (data, callback) => onPartyStatusMsg(socket, authToken, data, callback));
	socket.on('join', (data, callback) => onJoinGameMsg(socket, authToken, data, callback));
	socket.on('bot', data => onBotMsg(socket, data));
	socket.on('score', data => onScoreMsg(socket, data));
	socket.on('leave', data => onLeaveGameMsg(socket, data));
	socket.on('action', data => onActionMsg(socket, data));
	socket.on('online', data => onOnlineMsg(socket, data));
	socket.on('text', data => onTextMsg(socket, data));
	socket.on('replays', (data, callback) => onReplaysMsg(socket, authToken, data, callback));
}

function onInstanceMsg(socket: SocketIO.Socket, authToken: string, data: m.ServerInstanceRequest, callback: (output: m.ServerInstanceResponseMsg) => void) {
	try {
		if (!(required(data, "object"))) {
			callback({ success: false, error: "Bad request" });
			return;
		}

		const location = getLocation();
		callback({ success: true, instanceId, server: location.server, region: location.region });
	} catch (exception) {
		logger.error(exception);
		callback({ success: false, error: `${exception}` });
	}
}

function onRoomMsg(socket: SocketIO.Socket, authToken: string, data: m.JoinRoomRequest, callback: (output: m.JoinRoomResponseMsg) => void) {
	try {
		if (!(required(data, "object")
			&& required(data.roomId, "string"))) {
			callback({ success: false, error: "Bad request" });
			return;
		}

		const store = getStore();
		const room = store.rooms.get(data.roomId);
		if (room) {
			callback({ success: true, roomId: room.id, mod: room.mod });
		} else {
			callback({ success: false, error: `Unable to find room ${data.roomId}` });
		}
	} catch (exception) {
		logger.error(exception);
		callback({ success: false, error: `${exception}` });
	}
}

function onRoomCreateMsg(socket: SocketIO.Socket, authToken: string, data: m.CreateRoomRequest, callback: (output: m.CreateRoomResponseMsg) => void) {
	try {
		if (!(required(data, "object")
			&& required(data.mod, "object"))) {
			callback({ success: false, error: "Bad request" });
			return;
		}

		const room = modder.initRoom(data.mod, authToken);
		const result: m.CreateRoomResponse = {
			success: true,
			roomId: room.id,
			server: getLocation().server,
		};
		callback(result);
	} catch (exception) {
		logger.error(exception);
		callback({ success: false, error: `${exception}` });
	}
}

function onPartyCreateMsg(socket: SocketIO.Socket, authToken: string, data: m.CreatePartyRequest, callback: (output: m.CreatePartyResponseMsg) => void) {
	try {
		if (!(required(data, "object")
			&& optional(data.roomId, "string")
			&& required(data.playerName, "string")
			&& required(data.keyBindings, "object")
			&& optional(data.unranked, "boolean")
			&& optional(data.isMobile, "boolean")
		)) {
			callback({ success: false, error: "Bad request" });
			return;
		}

		const userHash = auth.getUserHashFromSocket(socket);
		const settings: g.JoinParameters = {
			socketId: socket.id,
			userHash,
			name: data.playerName,
			authToken,
			keyBindings: data.keyBindings,
			isMobile: data.isMobile,
			unranked: data.unranked,
			version: data.version,
		};

		const party = parties.initParty(socket.id, data.roomId);
		parties.createOrUpdatePartyMember(party, settings);
		parties.updatePartyMemberStatus(party, socket.id, { isLeader: true });
		logger.info(`Party ${party.id} created by user ${settings.name} [${authToken}]`);

		const result: m.CreatePartyResponse = {
			success: true,
			partyId: party.id,
			roomId: party.roomId,
			server: getLocation().server,
		};
		callback(result);
	} catch (exception) {
		logger.error(exception);
		callback({ success: false, error: `${exception}` });
	}
}

function onPartySettingsMsg(socket: SocketIO.Socket, authToken: string, data: m.PartySettingsRequest, callback: (output: m.PartySettingsResponseMsg) => void) {
	try {
		if (!(required(data, "object")
			&& required(data.partyId, "string")
			&& optional(data.isPrivate, "boolean")
			&& optional(data.isLocked, "boolean")
			&& optional(data.waitForPlayers, "boolean")
			&& optional(data.roomId, "string")
			&& optional(data.initialObserver, "boolean")
		)) {
			callback({ success: false, error: "Bad request" });
			return;
		}

		const store = getStore();

		const party = store.parties.get(data.partyId);
		if (!(party && parties.isAuthorizedToAdmin(party, socket.id))) {
			logger.info(`Party ${data.partyId} not found or inaccessible for user ${socket.id} [${authToken}]`);
			callback({ success: false, error: `Party ${data.partyId} not found or inaccessible` });
			return;
		}

		const newStatus: Partial<g.PartyStatus> = _.omitBy({
			roomId: data.roomId,
			isPrivate: data.isPrivate,
			isLocked: data.isLocked,
			waitForPlayers: data.waitForPlayers,
			initialObserver: data.initialObserver,
		}, x => x === undefined);
		parties.updatePartyStatus(party, newStatus);

		const result: m.PartySettingsResponseMsg = {
			success: true,
			partyId: party.id,
			roomId: party.roomId,
			isPrivate: party.isPrivate,
			waitForPlayers: party.waitForPlayers,
		};
		callback(result);

		emitParty(party);
	} catch (exception) {
		logger.error(exception);
		callback({ success: false, error: `${exception}` });
	}
}

function onPartyMsg(socket: SocketIO.Socket, authToken: string, data: m.PartyRequest, callback: (output: m.PartyResponseMsg) => void) {
	try {
		if (!(required(data, "object")
			&& required(data.partyId, "string")
			&& required(data.playerName, "string")
			&& required(data.keyBindings, "object")
			&& optional(data.joining, "boolean")
			&& optional(data.unranked, "boolean")
			&& optional(data.isMobile, "boolean")
		)) {
			callback({ success: false, error: "Bad request" });
			return;
		}

		const store = getStore();

		const party = store.parties.get(data.partyId);
		if (!party) {
			logger.info(`Party ${data.partyId} not found for user ${socket.id} [${authToken}]`);
			callback({ success: false, error: `Party ${data.partyId} not found` });
			return;
		}

		const joining = data.joining;
		if (joining) {
			socket.join(party.id);
		} else {
			if (!party.active.has(socket.id)) {
				logger.info(`Party ${data.partyId} does not contain ${socket.id} [${authToken}]`);
				callback({ success: false, error: `Cannot update ${data.partyId} as you are not a party member` });
				return;
			}
		}

		const userHash = auth.getUserHashFromSocket(socket);
		const partyMember: g.JoinParameters = {
			socketId: socket.id,
			userHash,
			authToken,
			name: data.playerName,
			keyBindings: data.keyBindings,
			isMobile: data.isMobile,
			unranked: data.unranked,
			version: data.version,
		};
		parties.createOrUpdatePartyMember(party, partyMember);

		const location = getLocation();
		const result: m.PartyResponse = {
			success: true,
			...partyToMsg(party),
			server: location.server,
			region: location.region,
		};
		callback(result);
		emitParty(party);
	} catch (exception) {
		logger.error(exception);
		callback({ success: false, error: `${exception}` });
	}
}

function onPartyStatusMsg(socket: SocketIO.Socket, authToken: string, data: m.PartyStatusRequest, callback: (output: m.PartyStatusResponseMsg) => void) {
	try {
		if (!(required(data, "object")
			&& required(data.partyId, "string")
			&& optional(data.memberId, "string")
			&& optional(data.isLeader, "boolean")
			&& optional(data.isObserver, "boolean")
			&& optional(data.kick, "boolean")
		)) {
			callback({ success: false, error: "Bad request" });
			return;
		}

		const store = getStore();

		const party = store.parties.get(data.partyId);
		if (!party) {
			logger.info(`Party ${data.partyId} not found for user ${socket.id} [${authToken}]`);
			callback({ success: false, error: `Party ${data.partyId} not found` });
			return;
		}

		const memberId = data.memberId || socket.id;
		const newStatus: Partial<g.PartyMemberStatus> = {};
		if (data.isLeader !== undefined) {
			newStatus.isLeader = data.isLeader;
		}
		if (data.isObserver !== undefined) {
			newStatus.isObserver = data.isObserver;
		}
		if (data.isReady !== undefined) {
			newStatus.ready = data.isReady;
		}
		if (!parties.isAuthorizedToChange(party, socket.id, memberId, newStatus)) {
			logger.info(`Party ${data.partyId} ${socket.id} [${authToken}] unauthorized to modify ${memberId} ${JSON.stringify(newStatus)}`);
			callback({ success: false, error: `Party ${data.partyId} unauthorized` });
			return;
		}
		parties.updatePartyMemberStatus(party, memberId, newStatus);

		if (data.kick) {
			parties.removePartyMember(party, memberId);
		}

		if (parties.isPartyReady(party)) {
			logger.info(`Party ${party.id} started with ${party.active.size} players`);
			const assignments = games.assignPartyToGames(party);
			parties.onPartyStarted(party, assignments);
			assignments.forEach(assignment => {
				emitHero(assignment.partyMember.socketId, assignment.game, assignment.heroId, assignment.reconnectKey, true);
			});
		}

		const result: m.PartyStatusResponse = {
			success: true,
		};
		callback(result);
		emitParty(party);

		// Must emit kick before removing
		if (data.kick) {
			const memberSocket = io.sockets.connected[memberId];
			if (memberSocket) {
				memberSocket.leave(party.id);
			}
		}
	} catch (exception) {
		logger.error(exception);
		callback({ success: false, error: `${exception}` });
	}
}

function onJoinGameMsg(socket: SocketIO.Socket, authToken: string, data: m.JoinMsg, callback: (hero: m.JoinResponseMsg) => void) {
	onJoinGameMsgAsync(socket, authToken, data).then(response => callback(response)).catch(exception => {
		logger.error(exception);
		callback({ success: false, error: `${exception}` });
	});
}

async function onJoinGameMsgAsync(socket: SocketIO.Socket, authToken: string, data: m.JoinMsg): Promise<m.JoinResponseMsg> {
	if (!(required(data, "object")
		&& optional(data.server, "string")
		&& required(data.name, "string")
		&& required(data.keyBindings, "object")
		&& required(data.room, "string")
		&& optional(data.layoutId, "string")
		&& optional(data.gameId, "string")
		&& optional(data.isMobile, "boolean")
		&& optional(data.unranked, "boolean")
		&& optional(data.locked, "string")
		&& optional(data.observe, "boolean")
		&& optional(data.reconnectKey, "string")
		&& optional(data.numBots, "number")
	)) {
		return { success: false, error: "Bad request" };
	}

	const store = getStore();
	const location = mirroring.getLocation();

	if (data.server !== location.server) {
		socket.disconnect(); // Force disconnect so client re-downloads and re-connects with latest client codebase
		return { success: false, error: "Wrong server" };
	}

	const playerName = PlayerName.sanitizeName(data.name);
	const userHash = auth.getUserHashFromSocket(socket);

	const room = store.rooms.get(data.room);
	if (!room) {
		return { success: false, error: `Unable to find room ${data.room}` };
	}

	let game: g.Replay;
	if (data.gameId) {
		const replay = store.activeGames.get(data.gameId);
		if (!replay) {
			game = await gameStorage.loadGame(data.gameId);
		} else {
			game = replay;
		}
	} else {
		// This method is always used for public games
		const partyId: string = null;
		const locked = data.locked || (blacklist.isBlocked(socket.id) ? m.LockType.Blocked : null);
		const isPrivate: boolean = !!locked;

		if (data.observe) {
			game = games.findExistingGame(data.version, room, partyId, isPrivate);
		} else if (locked) {
			// The user wants a private game, create one
			game = games.initGame(data.version, room, partyId, isPrivate, locked, data.layoutId);
		} else {
			game = games.findNewGame(data.version, room, partyId, isPrivate, [userHash]);
		}
	}

	if (game) {
		let heroId: string = null;
		let reconnectKey: string = null;
		let live = data.live || false;
		if (!data.observe && store.activeGames.has(game.id)) {
			const joinResult = games.joinGame(game as g.Game, {
				userHash,
				name: playerName,
				keyBindings: data.keyBindings,
				isMobile: data.isMobile,
				authToken,
				unranked: data.unranked,
				socketId: socket.id,
				version: data.version,
				reconnectKey: data.reconnectKey,
			});
			if (joinResult) {
				heroId = joinResult.heroId;
				reconnectKey = joinResult.reconnectKey;
				live = true;
			}

			if (data.numBots) {
				const numBots = Math.min(constants.Matchmaking.MaxPlayers, data.numBots);
				for (let i = 0; i < numBots; ++i) {
					games.addBot(game as g.Game);
				}
			}
		}

		emitHero(socket.id, game, heroId, reconnectKey, live);

		if (heroId) {
			logger.info(`Game [${game.id}]: player ${playerName} (${authToken}) [${socket.id}] joined, now ${game.numPlayers} players`);
		} else {
			logger.info(`Game [${game.id}]: player ${playerName} (${authToken}) [${socket.id}] joined as observer`);
		}
		return { success: true };
	} else {
		// logger.info(`Unable to find game for ${playerName} (${authToken}) [${socket.id}]`);
		return { success: false, error: `Unable to find game` };
	}
}

function onBotMsg(socket: SocketIO.Socket, data: m.BotMsg) {
	try {
		if (!(required(data, "object")
			&& optional(data.gameId, "string")
		)) {
			// callback({ success: false, error: "Bad request" });
			return;
		}


		const game = getStore().activeGames.get(data.gameId);
		if (game && game.active.has(socket.id)) {
			const targetGameSize = Math.random() < 0.5 ? 2 : 3;
			const botsToAdd = Math.max(1, targetGameSize - game.numPlayers);
			for (let i = 0; i < botsToAdd; ++i) {
				games.addBot(game);
			}
			logger.info(`Game [${game.id}]: added ${botsToAdd} bots`);
		}
	} catch (exception) {
		logger.error(exception);
	}
}

function onScoreMsg(socket: SocketIO.Socket, data: m.GameStatsMsg) {
	try {
		if (!(required(data, "object")
			&& required(data.category, "string")
			&& required(data.gameId, "string")
			&& required(data.lengthSeconds, "number")
			&& required(data.winner, "string")
			&& required(data.winners, "object") && data.winners.every(winner => required(winner, "string"))
			&& required(data.players, "object")
			&& data.players.every(p =>
				optional(p.userId, "string")
				&& required(p.userHash, "string")
				&& required(p.teamId, "string")
				&& required(p.name, "string")
				&& required(p.damage, "number")
				&& required(p.kills, "number")
				&& required(p.outlasts, "number")
			)
		)) {
			// callback({ success: false, error: "Bad request" });
			return;
		}
		const game = getStore().activeGames.get(data.gameId);
		if (game) {
			// Ensure the client cannot override certain fields
			data.unixTimestamp = game.created.unix();
			data.server = getLocation().server;

			games.receiveScore(game, socket.id, data);
		}
	} catch (exception) {
		logger.error(exception);
	}
}

function onLeaveGameMsg(socket: SocketIO.Socket, data: m.LeaveMsg) {
	try {
		socket.leave(data.gameId);

		const game = getStore().activeGames.get(data.gameId);
		if (game) {
			games.leaveGame(game, socket.id);
		}
	} catch (exception) {
		logger.error(exception);
	}
}

function onActionMsg(socket: SocketIO.Socket, data: m.ActionMsg) {
	try {
		if (!(required(data, "object")
			&& required(data.type, "string")
			&& required(data.gid, "string")
			&& required(data.hid, "string")
		)) {
			// callback({ success: false, error: "Bad request" });
			return;
		}

		const game = getStore().activeGames.get(data.gid);
		if (game) {
			games.receiveAction(game, data, socket.id);
		}
	} catch (exception) {
		logger.error(exception);
	}
}

function onOnlineMsg(socket: SocketIO.Socket, data: m.OnlineControlMsg) {
	try {
		if (!(required(data, "object")
			&& optional(data.join, "string")
			&& optional(data.leave, "string")
			&& optional(data.refresh, "string")
		)) {
			// callback({ success: false, error: "Bad request" });
			return;
		}

		if (data.leave) {
			socket.leave(segmentRoom(data.leave));
		}

		if (data.join) {
			const msg = online.getOnlinePlayers(data.join);
			socket.emit('online', msg);
			socket.join(segmentRoom(data.join));
		}

		if (data.refresh) {
			const msg = online.getOnlinePlayers(data.join);
			socket.emit('online', msg);
		}
	} catch (exception) {
		logger.error(exception);
	}
}

async function onTextMsg(socket: SocketIO.Socket, data: m.SendTextMsg) {
	try {
		if (!(required(data, "object")
			&& required(data.segment, "string")
			&& required(data.name, "string")
			&& required(data.text, "string")
		)) {
			// callback({ success: false, error: "Bad request" });
			return;
		}

		const userHash = auth.getUserHashFromSocket(socket);
		const name = PlayerName.sanitizeName(data.name);
		if (name.length > 0) {
			online.receiveTextMessage(data.segment, userHash, name, data.text);
		}
	} catch (exception) {
		logger.error(exception);
	}
}

function onReplaysMsg(socket: SocketIO.Socket, authToken: string, data: m.GameListRequest, callback: (response: m.GameListResponseMsg) => void) {
	try {
		if (!(required(data, "object")
			&& required(data.ids, "object") && Array.isArray(data.ids) && data.ids.every(id => required(id, "string"))
		)) {
			callback({ success: false, error: "Bad request" });
			return;
		}

		const store = getStore();
		const availableIds = data.ids.filter(id => store.activeGames.has(id) || gameStorage.hasGame(id));
		callback({ success: true, ids: availableIds });
	} catch (exception) {
		logger.error(exception);
		callback({ success: false, error: `${exception}` });
	}
}

function emitHero(socketId: string, game: g.Replay, heroId: string, reconnectKey: string, live: boolean = false) {
	try {
		const socket = io.sockets.connected[socketId];
		if (!socket) {
			return;
		}

		socket.join(game.id);
		const userHash = auth.getUserHashFromSocket(socket);

		const publicSegment = segments.publicSegment();
		const msg: m.HeroMsg = {
			gameId: game.id,
			heroId,
			userHash,
			reconnectKey,
			locked: game.locked,
			isPrivate: game.segment !== publicSegment,
			partyId: game.partyId,
			room: game.roomId,
			mod: game.mod,
			live,
			history: game.history,
		};
		socket.emit('hero', msg);
	} catch (exception) {
		logger.error(exception);
	}
}

function emitParty(party: g.Party) {
    io.to(party.id).emit("party", partyToMsg(party));
}

function partyToMsg(party: g.Party): m.PartyMsg {
	const msg: m.PartyMsg = {
		partyId: party.id,
		roomId: party.roomId,
		members: partyMembersToContract(party),
		isPrivate: party.isPrivate,
		isLocked: party.isLocked,
		initialObserver: party.initialObserver,
		waitForPlayers: party.waitForPlayers,
	};
	return msg;
}

function partyMembersToContract(party: g.Party) {
	let members = new Array<m.PartyMemberMsg>();
	party.active.forEach(member => {
		const contract: m.PartyMemberMsg = {
			socketId: member.socketId,
			name: member.name,
			ready: member.ready,
			isObserver: member.isObserver,
			isLeader: member.isLeader,
		}
		members.push(contract);
	});
	return members;
}

function emitGameResult(game: g.Game, result: m.GameStatsMsg) {
	if (result) {
		const rooms = wu(game.socketIds).toArray();
		if (game.partyId) {
			rooms.push(game.partyId);
		}

		if (rooms.length > 0) {
			let emitTo = io.to(null);
			for (const room of rooms) {
				emitTo = emitTo.to(room);
			}
			emitTo.emit('game', result);
		}
	}
}

function emitOnline(msg: m.OnlineMsg) {
	io.to(segmentRoom(msg.segment)).emit('online', msg);
}

function segmentRoom(segment: string) {
	return `s-${segment}`;
}