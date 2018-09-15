import moment from 'moment';
import * as uuid from 'uuid';
import * as games from './games';
import { AuthHeader, getAuthTokenFromSocket } from './auth';
import { getStore } from './serverStore';
import { getLocation, sanitizeHostname } from './mirroring';
import { logger } from './logging';
import { required, optional } from './schema';
import * as PlayerName from '../game/sanitize';
import * as g from './server.model';
import * as m from '../game/messages.model';
import * as gameStorage from './gameStorage';
import socketClient from 'socket.io-client';

let upstreams = new Map<string, SocketIOClient.Socket>(); // socketId -> upstream

let io: SocketIO.Server = null;
const instanceId = uuid.v4();

export function attachToSocket(_io: SocketIO.Server) {
	io = _io;
    io.on('connection', onConnection);
    games.attachToTickEmitter(data => io.to(data.gameId).emit("tick", data));
}

function onConnection(socket: SocketIO.Socket) {
    const authToken = getAuthTokenFromSocket(socket);

	logger.info(`socket ${socket.id} connected - user ${authToken}`);
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

		const disconnectResult = games.onDisconnect(socket.id, authToken);
		disconnectResult.changedParties.forEach(party => emitParty(party));
	});

	socket.on('proxy', (data, callback) => {
		const upstream = upstreams.get(socket.id);
		if (upstream) {
			logger.error(`Error: socket ${socket.id} attempted to proxy multiple times`);
			callback({ error: "Cannot connect to new server - already connected to an existing server" });
		} else {
			onProxyMsg(socket, authToken, data, callback);
		}
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
	socket.on('party.leave', (data, callback) => onPartyLeaveMsg(socket, authToken, data, callback));
	socket.on('join', (data, callback) => onJoinGameMsg(socket, authToken, data, callback));
	socket.on('bot', data => onBotMsg(socket, data));
	socket.on('leave', data => onLeaveGameMsg(socket, data));
	socket.on('action', data => onActionMsg(socket, data));
	socket.on('replays', (data, callback) => onReplaysMsg(socket, authToken, data, callback));
}

function onProxyMsg(socket: SocketIO.Socket, authToken: string, data: m.ProxyRequestMsg, callback: (msg: m.ProxyResponseMsg) => void) {
	if (!(required(data, "object")
		&& required(data.server, "string"))) {
		callback({ success: false, error: "Bad request" });
		return;
	}

	const location = getLocation();
	if (!location.server || !data.server || location.server === data.server) {
		// Already connected to the correct server
		callback({ success: true, server: location.server });
	} else {
		const server = sanitizeHostname(data.server);
		const upstream = socketClient(`http://${server}${location.upstreamSuffix}`, {
			forceNew: true,
			transportOptions: {
				polling: {
					extraHeaders: { [AuthHeader]: authToken }
				}
			},
		});

		let attached = false;
		upstream.on('connect', () => {
			if (!attached) {
				attached = true;
				upstreams.set(socket.id, upstream);
				callback({ success: true, server });
				logger.error(`Socket ${socket.id} connected to upstream ${server}`);
			}
		});
		upstream.on('connect_error', (error: any) => {
			if (!attached) {
				attached = true;
				callback({ success: false, error: `${error}` });
				logger.error(`Socket ${socket.id} could not connect to upstream ${server}: ${error}`);
			}
		});
		upstream.on('connect_timeout', () => {
			if (!attached) {
				attached = true;
				callback({ success: false, error: "Timed out connecting to upstream server" });
				logger.error(`Socket ${socket.id} could not connect to upstream ${server}: timeout`);
			}
		});
		upstream.on('hero', (data: any) => socket.emit('hero', data));
		upstream.on('tick', (data: any) => socket.emit('tick', data));
		upstream.on('party', (data: any) => socket.emit('party', data));
		upstream.on('disconnect', () => {
			// Only disconnect if we've actually connected before
			if (!attached) { return; }
			socket.disconnect();
		});
	}
}

function onInstanceMsg(socket: SocketIO.Socket, authToken: string, data: m.ServerInstanceRequest, callback: (output: m.ServerInstanceResponseMsg) => void) {
	if (!(required(data, "object"))) {
		callback({ success: false, error: "Bad request" });
		return;
	}

	const location = getLocation();
	callback({ success: true, instanceId, server: location.server });
}

function onRoomMsg(socket: SocketIO.Socket, authToken: string, data: m.JoinRoomRequest, callback: (output: m.JoinRoomResponseMsg) => void) {
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
}

function onRoomCreateMsg(socket: SocketIO.Socket, authToken: string, data: m.CreateRoomRequest, callback: (output: m.CreateRoomResponseMsg) => void) {
	if (!(required(data, "object")
		&& required(data.mod, "object"))) {
		callback({ success: false, error: "Bad request" });
		return;
	}

	const room = games.initRoom(data.mod, authToken);
	const result: m.CreateRoomResponse = {
		success: true,
		roomId: room.id,
		server: getLocation().server,
	};
	callback(result);
}

function onPartyCreateMsg(socket: SocketIO.Socket, authToken: string, data: m.CreatePartyRequest, callback: (output: m.CreatePartyResponseMsg) => void) {
	if (!(required(data, "object")
		&& optional(data.roomId, "string"))) {
		callback({ success: false, error: "Bad request" });
		return;
	}

	const party = games.initParty(socket.id, data.roomId);
	logger.info(`Party ${party.id} created by user ${authToken}`);

	const result: m.CreatePartyResponse = {
		success: true,
		partyId: party.id,
		roomId: party.roomId,
		server: getLocation().server,
	};
	callback(result);
}

function onPartySettingsMsg(socket: SocketIO.Socket, authToken: string, data: m.PartySettingsRequest, callback: (output: m.PartySettingsResponseMsg) => void) {
	if (!(required(data, "object")
		&& required(data.partyId, "string")
		&& optional(data.isPrivate, "boolean")
		&& optional(data.roomId, "string"))) {
		callback({ success: false, error: "Bad request" });
		return;
	}

	const store = getStore();

	const party = store.parties.get(data.partyId);
	if (!(party && party.active.has(socket.id) && party.leaderSocketId === socket.id)) {
		logger.info(`Party ${data.partyId} not found or inaccessible for user ${socket.id} [${authToken}]`);
		callback({ success: false, error: `Party ${data.partyId} not found or inaccessible` });
		return;
	}

	let changed = false;
	if (data.roomId !== undefined && games.updatePartyRoom(party, data.roomId)) {
		changed = true;
	}
	if (data.isPrivate !== undefined && games.updatePartyPrivacy(party, data.isPrivate)) {
		changed = true;
	}

	const result: m.PartySettingsResponseMsg = {
		success: true,
		partyId: party.id,
		roomId: party.roomId,
		isPrivate: party.isPrivate,
	};
	callback(result);

	if (changed) {
		emitParty(party);
	}
}

function onPartyMsg(socket: SocketIO.Socket, authToken: string, data: m.PartyRequest, callback: (output: m.PartyResponseMsg) => void) {
	if (!(required(data, "object")
		&& required(data.partyId, "string")
		&& required(data.playerName, "string")
		&& required(data.keyBindings, "object")
		&& required(data.ready, "boolean")
		&& optional(data.joining, "boolean")
		&& optional(data.isBot, "boolean")
		&& optional(data.isMobile, "boolean")
		&& optional(data.isObserver, "boolean")
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

	const partyMember: g.PartyMember = {
		socketId: socket.id,
		authToken,
		name: data.playerName,
		keyBindings: data.keyBindings,
		isBot: data.isBot,
		isMobile: data.isMobile,
		isObserver: data.isObserver,
		ready: data.ready,
	};
	games.updatePartyMember(party, partyMember, joining);

	const result: m.PartyResponse = {
		success: true,
		partyId: party.id,
		members: partyMembersToContract(party),
		isPrivate: party.isPrivate,
		roomId: party.roomId,
		server: getLocation().server,
	};
	callback(result);

	const assignments = games.startPartyIfReady(party);
	assignments.forEach(assignment => {
		emitHero(assignment.partyMember.socketId, assignment.game, assignment.heroId);
	});
	emitParty(party);
}

function onPartyLeaveMsg(socket: SocketIO.Socket, authToken: string, data: m.LeavePartyRequest, callback: (output: m.LeavePartyResponseMsg) => void) {
	if (!(required(data, "object")
		&& required(data.partyId, "string")
	)) {
		callback({ success: false, error: "Bad request" });
		return;
	}

	const store = getStore();

	let party = store.parties.get(data.partyId);
	if (!party) {
		logger.info(`Party ${data.partyId} not found for user ${authToken}`);
		callback({ success: false, error: `Party ${data.partyId} not found` });
		return;
	}

	games.removePartyMember(party, socket.id);
	socket.leave(party.id);

	const result: m.LeavePartyResponse = {
		success: true,
		partyId: party.id,
	};
	callback(result);

	emitParty(party);
}

function onJoinGameMsg(socket: SocketIO.Socket, authToken: string, data: m.JoinMsg, callback: (hero: m.JoinResponseMsg) => void) {
	if (!(required(data, "object")
		&& required(data.name, "string")
		&& required(data.keyBindings, "object")
		&& optional(data.room, "string")
		&& optional(data.gameId, "string")
		&& optional(data.isBot, "boolean")
		&& optional(data.isMobile, "boolean")
		&& optional(data.observe, "boolean")
	)) {
		callback({ success: false, error: "Bad request" });
		return;
	}

	const store = getStore();
	const playerName = PlayerName.sanitizeName(data.name);

	const roomId = data.room;
	const room = roomId ? store.rooms.get(roomId) : null;

	Promise.resolve().then(() => {
		if (data.gameId) {
			const replay = store.activeGames.get(data.gameId);
			if (!replay) {
				return gameStorage.loadGame(data.gameId);
			} else {
				return replay;
			}
		} else {
			const game = games.findNewGame(room, data.privatePartyId, data.isBot);
			return game;
		}
	}).catch(err => {
		console.error("Error joining game: ", err);
		return null as g.Replay;
	}).then(game => {
		if (game) {
			let heroId = null;
			if (!data.observe && store.activeGames.has(game.id)) {
				heroId = games.joinGame(game as g.Game, playerName, data.keyBindings, data.isBot, data.isMobile, authToken, socket.id);
			}

			emitHero(socket.id, game, heroId);

			if (heroId) {
				const botLog = data.isBot ? " (bot)" : "";
				logger.info(`Game [${game.id}]: player ${playerName}${botLog} (${authToken}) [${socket.id}] joined, now ${game.numPlayers} players`);
			} else {
				logger.info(`Game [${game.id}]: player ${playerName} (${authToken}) [${socket.id}] joined as observer`);
			}
		} else {
			logger.info("Game [" + data.gameId + "]: unable to find game for " + playerName);
			callback({ success: false, error: `Unable to find game ${data.gameId}` });
		}
	});
}

function onBotMsg(socket: SocketIO.Socket, data: m.BotMsg) {
	if (!(required(data, "object")
		&& optional(data.gameId, "string")
	)) {
		// callback({ success: false, error: "Bad request" });
		return;
	}


	const game = getStore().activeGames.get(data.gameId);
	if (game && game.active.has(socket.id) && game.numPlayers <= 1 && game.bots.size === 0) { // Only allow adding bots once
		games.addBot(game);
		games.addBot(game);
		logger.info(`Game [${game.id}]: playing vs AI`);
	}
}

function onLeaveGameMsg(socket: SocketIO.Socket, data: m.LeaveMsg) {
	socket.leave(data.gameId);

	const game = getStore().activeGames.get(data.gameId);
	if (game) {
		games.leaveGame(game, socket.id);
	}
}

function onActionMsg(socket: SocketIO.Socket, data: m.ActionMsg) {
	if (!(required(data, "object")
		&& required(data.actionType, "string")
		&& required(data.gameId, "string")
		&& required(data.heroId, "string")
	)) {
		// callback({ success: false, error: "Bad request" });
		return;
	}

	const game = getStore().activeGames.get(data.gameId);
	if (game) {
		games.receiveAction(game, data, socket.id);
	}
}

function onReplaysMsg(socket: SocketIO.Socket, authToken: string, data: m.GameListRequest, callback: (response: m.GameListResponseMsg) => void) {
	if (!(required(data, "object")
		&& required(data.ids, "object") && Array.isArray(data.ids) && data.ids.every(id => required(id, "string"))
	)) {
		callback({ success: false, error: "Bad request" });
		return;
	}

	const store = getStore();
	const availableIds = data.ids.filter(id => store.activeGames.has(id) || gameStorage.hasGame(id));
	callback({ success: true, ids: availableIds });
}

function emitHero(socketId: string, game: g.Replay, heroId: string) {
	const socket = io.sockets.connected[socketId];
	if (!socket) {
		return;
	}

	socket.join(game.id);

	const publicCategory = games.publicCategory();
	const numPlayersPublic = games.calculateRoomStats(publicCategory);
	const numPlayersInCategory = games.calculateRoomStats(game.category);
	const msg: m.HeroMsg = {
		gameId: game.id,
		heroId,
		isPrivate: game.category !== publicCategory,
		privatePartyId: game.privatePartyId,
		room: game.roomId,
		mod: game.mod,
		allowBots: game.allowBots,
		history: game.history,
		numPlayersPublic,
		numPlayersInCategory,
	};
	socket.emit('hero', msg);
}

function emitParty(party: g.Party) {
	const msg: m.PartyMsg = {
		partyId: party.id,
		roomId: party.roomId,
		members: partyMembersToContract(party),
		isPrivate: party.isPrivate,
	};
    io.to(party.id).emit("party", msg);
}

function partyMembersToContract(party: g.Party) {
	let members = new Array<m.PartyMemberMsg>();
	party.active.forEach(member => {
		const contract: m.PartyMemberMsg = {
			socketId: member.socketId,
			name: member.name,
			ready: member.ready,
			isBot: member.isBot,
			isObserver: member.isObserver,
		}
		members.push(contract);
	});
	return members;
}