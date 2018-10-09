import * as dbStorage from './dbStorage';

const accessKeyToUserIdCache = new Map<string, string>();

export function getUserIdFromCache(accessKey: string): string {
    return accessKeyToUserIdCache.get(accessKey);
}

export async function getUserIdFromAccessKey(accessKey: string, allowCache: boolean = true): Promise<string> {
    let userId = accessKeyToUserIdCache.get(accessKey);
    if (allowCache && userId) {
        return userId;
    } else {
        userId = await dbStorage.getUserIdFromAccessKey(accessKey);
        accessKeyToUserIdCache.set(accessKey, userId);
        return userId;
    }
}

export async function associateAccessKey(accessKey: string, userId: string): Promise<void> {
    await dbStorage.associateAccessKey(accessKey, userId);
    accessKeyToUserIdCache.set(accessKey, userId);
}

export async function disassociateAccessKey(accessKey: string): Promise<void> {
    await dbStorage.disassociateAccessKey(accessKey);
    accessKeyToUserIdCache.delete(accessKey);
}