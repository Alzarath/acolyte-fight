import _ from 'lodash';
import moment from 'moment';
import express from 'express';
import url from 'url';

import * as g from './server.model';
import * as m from '../game/messages.model';
import * as auth from './auth';
import * as discord from './discord';
import * as games from './games';
import * as loadMetrics from './loadMetrics';
import * as sanitize from '../game/sanitize';
import * as statsStorage from './statsStorage';
import * as userStorage from './userStorage';

import { getAuthToken } from './auth';
import { getLocation } from './mirroring';
import { getStore } from './serverStore';
import { logger } from './logging';
import { required, optional } from './schema';
import { DefaultSettings } from '../game/settings';

let port: number = null;

export function init(_port: number) {
    port = _port;
}

export function onDefaultSettings(req: express.Request, res: express.Response) {
    res.header("Content-Type", "application/json");
    res.send(JSON.stringify(DefaultSettings));
}

export function onInternalStatus(req: express.Request, res: express.Response) {
    res.send(getInternalStatus());
}

export function getInternalStatus() {
    const store = getStore();
    const location = getLocation();
	const status: m.InternalStatus = {
        region: location.region,
        host: location.server,
        numGames: store.activeGames.size,
        numPlayers: _.sum(_.values(store.playerCounts)),
        numConnections: store.numConnections,
        breakdown: store.playerCounts,
        serverLoad: loadMetrics.getLoadAverage(),
    };
    return status;
}

export function onExternalStatus(req: express.Request, res: express.Response) {
	res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    res.send(getExternalStatus());
}

export function getExternalStatus() {
    const location = getLocation();
	const status: m.ExternalStatus = {
        region: location.region,
        host: location.server,
        numPlayers: games.calculateRoomStats(games.publicCategory()),
    };
    return status;
}

export function onLogin(req: express.Request, res: express.Response) {
    onLoginAsync(req, res).catch(error => handleError(error, res));
;
}

async function onLoginAsync(req: express.Request, res: express.Response): Promise<void> {
    const authToken = auth.resendAuthToken(req, res);
    const origin = getOrigin(req);
    if (req.query.code && authToken) {
        const code = req.query.code;
        const discordUser = await discord.authenticateWithCode(origin, code);
        if (!discordUser) {
            throw "Unable to find Discord user";
        }

        const allowCache = false;
        let userId = await auth.getUserIdFromAccessKey(auth.discordAccessKey(discordUser), allowCache)
        if (userId) {
            // Associate this browser with the existing user
            logger.info(`Discord user ${discordUser.id} - ${discordUser.username} - logged in`);
            await auth.associateAccessKey(auth.enigmaAccessKey(authToken), userId);

        } else {
            // Create a new user
            logger.info(`Discord user ${discordUser.id} - ${discordUser.username} - creating new user`);

            userId = userStorage.generateUserId();
            const userSettings: g.UserSettings = {
                userId,
                name: sanitize.sanitizeName(discordUser.username),
                buttons: null,
                rebindings: null,
            };

            await userStorage.createOrUpdateUser(userSettings);
            await auth.associateAccessKey(auth.discordAccessKey(discordUser), userId);
            await auth.associateAccessKey(auth.enigmaAccessKey(authToken), userId);
        }

        res.redirect('/');
    } else {
        res.redirect(discord.getAuthUrl(origin));
    }
}

export function onLogout(req: express.Request, res: express.Response) {
    onLogoutAsync(req, res).catch(error => handleError(error, res));
;
}

async function onLogoutAsync(req: express.Request, res: express.Response): Promise<void> {
    const authToken = getAuthToken(req);
    if (authToken) {
        const accessKey = auth.enigmaAccessKey(authToken);
        await auth.disassociateAccessKey(accessKey);
    }
    res.send("OK");
}

export function onGetGameStats(req: express.Request, res: express.Response) {
    onGetGameStatsAsync(req, res).catch(error => handleError(error, res));
}

export async function onGetGameStatsAsync(req: express.Request, res: express.Response): Promise<void> {
    const maxLimit = 10;

    const after = req.query.after ? parseInt(req.query.after) : null;
    const before = req.query.before ? parseInt(req.query.before) : null;
    const limit = req.query.limit ? Math.min(maxLimit, parseInt(req.query.limit)) : maxLimit;

    const authToken = getAuthToken(req);
    const userId = await auth.getUserIdFromAccessKey(auth.enigmaAccessKey(authToken));
    if (!userId) {
        res.status(403).send("Forbidden");
        return;
    }

    const allGameStats = await statsStorage.loadGamesForUser(userId, after, before, limit);
    const response: m.GetGameStatsResponse = {
        stats: allGameStats,
    };
    res.send(response);
}

export function onGetUserSettings(req: express.Request, res: express.Response) {
    onGetUserSettingsAsync(req, res).catch(error => handleError(error, res));
}

function handleError(error: any, res: express.Response) {
    if (error instanceof Error && error.stack) {
        logger.error(`${error.name} - ${error.message}: ${error.stack}`);
    } else {
        logger.error(error);
    }
    res.status(500).send("Internal server error");
}

export async function onGetUserSettingsAsync(req: express.Request, res: express.Response): Promise<void> {
    const authToken = getAuthToken(req);
    const userId = await auth.getUserIdFromAccessKey(auth.enigmaAccessKey(authToken));
    const user = await userStorage.getUserById(userId);
    if (user) {
        const result: m.GetUserSettingsResponse = {
            userId: user.userId,
            name: user.name,
            buttons: user.buttons,
            rebindings: user.rebindings,
        };

        res.header("Content-Type", "application/json");
        res.send(result);
    } else if (userId) {
        // This user hasn't yet uploaded their settings
        const result: m.GetUserSettingsResponse = {
            userId,
            name: null,
            buttons: null,
            rebindings: null,
        };

        res.header("Content-Type", "application/json");
        res.send(result);
    } else {
        res.status(404).send("User not found");
    }
}

export function onUpdateUserSettings(req: express.Request, res: express.Response) {
    onUpdateUserSettingsAsync(req, res).catch(error => handleError(error, res));
}

export async function onUpdateUserSettingsAsync(req: express.Request, res: express.Response): Promise<void> {
    const input = req.body as m.UpdateUserSettingsRequest;
    if (!(required(input, "object")
        && required(input.name, "string")
        && required(input.buttons, "object") && Object.keys(input.buttons).map(key => input.buttons[key]).every(x => required(x, "string"))
        && required(input.rebindings, "object") && Object.keys(input.rebindings).map(key => input.rebindings[key]).every(x => required(x, "string"))
    )) {
        res.status(400).send("Bad request");
        return;
    }

    const authToken = getAuthToken(req);
    const userId = await auth.getUserIdFromAccessKey(auth.enigmaAccessKey(authToken))
    if (userId) {
        const user: g.UserSettings = {
            userId: userId,
            name: input.name,
            buttons: input.buttons,
            rebindings: input.rebindings,
        };
        await userStorage.createOrUpdateUser(user);

        const result: m.UpdateUserSettingsResponse = {};
        res.header("Content-Type", "application/json");
        res.send(result);
    } else {
        res.status(404).send("User not found");
    }
}

function getOrigin(req: express.Request): string {
    let origin = `${req.protocol}://${req.hostname}`;
    if (port !== 80) {
        origin += `:${port}`;
    }
    return origin;
}