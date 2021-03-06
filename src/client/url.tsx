import queryString from 'query-string';
import * as s from './store.model';

export const baseUrl = (window as any).baseUrl;
export const base = baseUrl || "";

export function parseLocation(location: Location): s.PathElements {
    let path: string = null;
    let page: string = null;
    let gameId: string = null;
    let recordId: string = null;
    let party: string = null;
    let server: string = null;
    let profileId: string = null;
    let hash: string = null;
    let source: string = null;
    let gclid: string = null;


    if (location.pathname) {
        const elems = location.pathname.split("/");
        if (elems.length > 0) {
            page = elems.pop();
        }
        path = elems.join("/");

        if (!page || page === "index.html") {
            page = "";
        }
    }
    if (location.search) {
        const params = queryString.parse(location.search);
        if (params["g"]) {
            gameId = flatten(params["g"]);
        }
        if (params["r"]) {
            recordId = flatten(params["r"]);
        }
        if (params["party"]) {
            party = flatten(params["party"]);
        }
        if (params["server"]) {
            server = flatten(params["server"]);
        }
        if (params["p"]) {
            profileId = flatten(params["p"]);
        }
        if (params["source"]) {
            source = flatten(params["source"]);
        }
        if (params["gclid"]) {
            gclid = flatten(params["gclid"]);
        }
    }
    if (location.hash) {
        hash = location.hash;
    }

    return { path, page, gameId, recordId, profileId, party, server, gclid, hash };
}

function flatten(param: string | number | (string | number)[]): string {
    if (param instanceof Array) {
        return `${param[0]}`;
    } else {
        return `${param}`;
    }
}

export function getPath(elems: s.PathElements) {
    let pathElements = new Array<string>();
    let params = [];
    if (elems.gameId) {
        params.push("g=" + elems.gameId);
    } else if (elems.recordId) {
        params.push("r=" + elems.recordId);
    } else if (elems.profileId) {
        params.push("p=" + elems.profileId);
        pathElements = ["profile"];
    } else if (elems.page) {
        pathElements = [elems.page];
    }

    if (elems.party) {
        params.push("party=" + elems.party);
    }
    if (elems.server) {
        params.push("server=" + elems.server);
    }

    if (elems.gclid) {
        params.push("gclid=" + elems.gclid);
    }

    let path = (elems.path || "") + "/" + pathElements.join("/");
    if (params.length > 0) {
        path += "?" + params.join("&");
    }

    if (elems.hash) {
        path += "#" + elems.hash;
    }

    return path;
}