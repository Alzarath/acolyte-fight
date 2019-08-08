import _ from 'lodash';
import moment from 'moment';
import msgpack from 'msgpack-lite';
import * as constants from '../../game/constants';
import * as credentials from './credentials';
import * as d from '../stats.model';
import * as m from '../../shared/messages.model';
import * as s from '../store.model';
import * as w from '../../game/world.model';
import * as StoreProvider from '../storeProvider';
import * as url from '../url';

export async function downloadLeagues() {
    const state = StoreProvider.getState();
    if (state.leagues) {
        return;
    }

    const leagues = await retrieveLeagues(m.GameCategory.PvP);
    StoreProvider.dispatch({ type: "updateLeagues", leagues });
}

export async function downloadLeaderboard() {
    const leaderboard = await retrieveLeaderboardAsync(m.GameCategory.PvP);
    StoreProvider.dispatch({ type: "updateLeaderboard", leaderboard });
}

export function onNotification(notifs: w.Notification[]) {
    for (const notif of notifs) {
        if (notif.type === "ratingAdjustment") {
            adjustRating(notif);
        }
    }
}

function adjustRating(adjustment: w.RatingAdjustmentNotification) {
    // Incrementally adjust the rating until it's reloaded later
    const state = StoreProvider.getState();
    if (!(state.profile && state.profile.ratings)) {
        return;
    }

    const rating = state.profile.ratings[adjustment.category];
    if (!rating) {
        return;
    }

    const profile: m.GetProfileResponse = {
        ...state.profile,
        ratings: {
            ...state.profile.ratings,
            [adjustment.category]: {
                ...rating,
                acoExposure: rating.acoExposure + adjustment.acoDelta,
            },
        }
    };
    StoreProvider.dispatch({ type: "updateProfile", profile });
}

export function getLeagueFromRating(exposure: number, leagues: m.League[]) {
    for (const league of leagues) {
        if (exposure >= league.minRating) {
            return league;
        }
    }
    return leagues[leagues.length - 1];
}

export async function retrieveMyStatsAsync() {
    const state = StoreProvider.getState();
    if (state.userId) {
        await retrieveUserStatsAsync(state.userId);
    }
}

export async function retrieveUserStatsAsync(profileId: string) {
    if (!profileId) {
        return null;
    }

    const res = await fetch(`${url.base}/api/profile?p=${encodeURIComponent(profileId)}`, {
        headers: credentials.headers(),
        credentials: 'same-origin',
    });
    if (res.status === 200) {
        const profile = await res.json() as m.GetProfileResponse;

        // Cache profile if this is the current logged-in user
        const state = StoreProvider.getState();
        if (state.userId === profile.userId) {
            StoreProvider.dispatch({ type: "updateProfile", profile });
        }

        return profile;
    } else {
        throw await res.text();
    }
}

export async function retrieveLeagues(category: string): Promise<m.League[]> {
    const res = await fetch(`${url.base}/api/leagues/${encodeURIComponent(category)}`, {
        headers: credentials.headers(),
        credentials: 'same-origin',
    });
    if (res.status === 200) {
        const json = await res.json() as m.GetLeaguesResponse;
        return json.leagues;
    } else {
        throw await res.text();
    }
}

export async function retrieveLeaderboardAsync(category: string) {
    const res = await fetch(`${url.base}/api/leaderboard?category=${encodeURIComponent(category)}`, {
        headers: credentials.headers(),
        credentials: 'same-origin'
    });
    if (res.status === 200) {
        const buffer = new Uint8Array(await res.arrayBuffer());
        const json = msgpack.decode(buffer) as m.GetLeaderboardResponse;
        return json.leaderboard;
    } else {
        throw await res.text();
    }
}