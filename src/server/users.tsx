import crypto from 'crypto';
import * as discord from './discord';
import * as g from './server.model';
import * as uuid from 'uuid';

export function generateUserId(): string {
    return "u." + uuid.v4();
}

export function isUserId(str: string) {
    return str && str.startsWith("u.");
}

export function anonymousUserHash(authToken: string): string {
    return crypto.createHash('md5').update(authToken).digest('hex');
}

export function discordAccessKey(discordUser: discord.DiscordUser) {
    return `discord.${discordUser.id}`;
}

export function enigmaAccessKey(authToken: string) {
    return `enigma.${authToken}`;
}