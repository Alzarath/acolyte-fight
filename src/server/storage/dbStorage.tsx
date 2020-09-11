import * as Firestore from '@google-cloud/firestore';
import * as db from './db.model';
import * as s from '../server.model';
import { logger } from '../status/logging';

const MaxFirestoreAgeHours = 0.25;

let firestore: Firestore.Firestore = null;
let firestoreExpiry: number = 0;
let noDb: boolean = false;

export function getFirestore() {
    if (noDb) { return null; }

    if (!firestore || Date.now() >= firestoreExpiry) {
        firestoreExpiry = Date.now() + MaxFirestoreAgeHours * 60 * 60 * 1000;
        recreateFirestore();
    }
    return firestore;
}

function recreateFirestore() {
    logger.info("Recreating firestore...");
    try {
        const newFirestore = new Firestore.Firestore({});
        firestore = newFirestore;
    } catch (exception) {
        logger.error("Could not connect to database, running in non-database mode", exception);
    }
}

export function init(_noDb: boolean) {
    noDb = _noDb;
    if (noDb) {
        logger.info("Running in no-database mode");
    }
}

export function stream(query: Firestore.Query, func: (doc: Firestore.DocumentSnapshot) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        query.stream().on('data', func).on('end', () => {
            resolve();
        });
    });
}