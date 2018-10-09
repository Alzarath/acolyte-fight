import cookie from 'cookie';
import express from 'express';
import * as uuid from 'uuid';

import * as m from '../game/messages.model';

export const AuthHeader = "x-enigma-auth";

export function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
    let authToken = parseAuthTokenFromRequest(req);
    if (authToken) {
        setAuthToken(req, authToken);
    } else {
        resendAuthToken(req, res);
    }
    next();
}

export function resendAuthToken(req: express.Request, res: express.Response) {
    let authToken = getAuthToken(req);
    if (!authToken) {
        authToken = uuid.v4();
    }

    res.cookie(m.AuthCookieName, authToken, {
        maxAge: 20 * 365 * 24 * 60 * 60 * 1000,
        domain: `.${req.hostname}`,
        httpOnly: true,
    });
    setAuthToken(req, authToken);

    return authToken;
}

export function getAuthToken(req: express.Request) {
    return (req as any).enigmaAuthToken;
}

export function setAuthToken(req: express.Request, authToken: string) {
    (req as any).enigmaAuthToken = authToken;
}

export function getAuthTokenFromSocket(socket: SocketIO.Socket) {
    if (socket && socket.request) {
        return parseAuthTokenFromRequest(socket.request);
    } else {
        return null;
    }
}

function parseAuthTokenFromRequest(req: express.Request): string | null {
    if (!(req && req.headers)) {
        return null;
    } 

    let headerValue = req.headers[AuthHeader];
    if (headerValue && typeof headerValue === "string") {
        return headerValue
    } 

    if (req.headers.cookie && typeof req.headers.cookie === "string") {
        const cookies = cookie.parse(req.headers.cookie);
        return cookies && cookies[m.AuthCookieName];
    }

    return null;
}