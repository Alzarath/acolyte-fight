import _ from 'lodash';
import moment from 'moment';
import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as Reselect from 'reselect';
import * as d from '../stats.model';
import * as m from '../../game/messages.model';
import * as s from '../store.model';
import * as cloud from '../core/cloud';
import * as matches from '../core/matches';
import * as storage from '../storage';
import * as url from '../url';

interface CategoryCounts {
    [category: string]: number;
}

interface Stats {
    games: number;
    wins: number;
    kills: number;
    damage: number;
}

interface GlobalStats {
    players: Map<string, LeaderboardStats>;
    totals: Stats;
}

interface GameRow {
    id: string;
    category: string;
    server: string;
    createdTimestamp: moment.Moment;

    self: string;
    winner: string;
    players: Map<string, PlayerStats>;
    totals: Stats;

    lengthSeconds: number;
}

interface PlayerStats extends Stats {
    name: string;
    userHash: string;
}

interface LeaderboardStats extends PlayerStats { 
    winRate: number;
    winRateLowerBound: number;
    killsPerGame: number;
    damagePerGame: number;
}

interface Props {
}

interface State {
    category: string;
    self: string;
    leaderboard: m.LeaderboardPlayer[];
    games: GameRow[];
    error: string;
    availableReplays: Set<string>;
}

const getCategoryCounts = Reselect.createSelector(
    (games: GameRow[]) => games,
    (games) => {
        const counts: CategoryCounts = {};
        if (games) {
            for (const game of games) {
                counts[game.category] = (counts[game.category] || 0) + 1;
            }
        }
        return counts;
    }
);

const getGameSubset = Reselect.createSelector(
    (state: State) => state.category,
    (state: State) => state.games,
    (category, games) => {
        if (games) {
            return games.filter(g => g.category === category);
        } else {
            return null;
        }
    });

const getGlobalStats = Reselect.createSelector(
    getGameSubset,
    (games) => {
        if (games) {
            return calculateGlobalStats(games);
        } else {
            return null;
        }
    }
);

async function retrieveLeaderboardAsync() {
    const res = await fetch('api/leaderboard', {
        credentials: 'same-origin'
    });
    const json = await res.json() as m.GetLeaderboardResponse;
    return json.leaderboard;
}

async function retrieveGamesAsync(): Promise<GameRow[]> {
    await cloud.downloadGameStats();
    const gameStats = await storage.loadAllGameStats()

    let games = gameStats.map(convertGame);
    games = _.sortBy(games, (g: GameRow) => -g.createdTimestamp.unix());
    return games;
}

function retrieveReplaysAsync(gameIds: string[]) {
    return matches.replays(gameIds);
}

function initStats(): Stats {
    return { games: 0, wins: 0, kills: 0, damage: 0 };
}

function accumulateStats(accumulator: Stats, addend: Stats) {
    accumulator.games += addend.games;
    accumulator.wins += addend.wins;
    accumulator.kills += addend.kills;
    accumulator.damage += addend.damage;
}

function convertGame(stats: d.GameStats): GameRow {
    const game: GameRow = {
        id: stats.id,
        category: stats.category,
        server: stats.server,
        createdTimestamp: moment(stats.timestamp),
        players: new Map<string, PlayerStats>(),
        self: null,
        winner: null,
        totals: initStats(),
        lengthSeconds: stats.lengthSeconds,
    };

    for (const userHash in stats.players) {
        const player = stats.players[userHash];
        const cell: PlayerStats = {
            name: player.name,
            userHash: player.userHash,
            games: 1,
            wins: player.userHash === stats.winner ? 1 : 0,
            kills: player.kills,
            damage: player.damage,
        };

        game.players.set(userHash, cell);
        accumulateStats(game.totals, cell);

        if (stats.winner === userHash) {
            game.winner = userHash;
        }
        if (stats.self && stats.self === userHash) {
            game.self = userHash;
        }
    }

    return game;
}

function joinWithComma(elements: JSX.Element[]): Array<JSX.Element | string> {
    const result = new Array<JSX.Element | string>();
    elements.forEach(elem => {
        if (result.length > 0) {
            result.push(", ");
        }
        result.push(elem);
    });
    return result;
}

function calculateGlobalStats(games: GameRow[]): GlobalStats {
    const totals = initStats();
    const statsPerPlayer = new Map<string, PlayerStats>();

    for (const game of games) {
        accumulateStats(totals, game.totals);

        for (const gamePlayer of game.players.values()) {
            let globalPlayer = statsPerPlayer.get(gamePlayer.userHash);
            if (!globalPlayer) {
                globalPlayer = {
                    ...initStats(),
                    name: gamePlayer.name,
                    userHash: gamePlayer.userHash,
                };
                statsPerPlayer.set(globalPlayer.userHash, globalPlayer);
            }

            accumulateStats(globalPlayer, gamePlayer);
        }
    }

    const players = new Map<string, LeaderboardStats>();
    for (const stats of statsPerPlayer.values()) {
        const winRate = stats.wins / Math.max(1, stats.games);

        players.set(stats.userHash, {
            ...stats,
            winRate,
            winRateLowerBound: wilsonLowerBound(stats.wins, stats.games, 1.96),
            killsPerGame: stats.kills / Math.max(1, stats.games),
            damagePerGame: stats.damage / Math.max(1, stats.games),
        });
    }

    return {
        players,
        totals,
    };
}

function wilsonLowerBound(nSuccess: number, n: number, z: number) {
    if (n === 0) {
        return 0;
    }

    const nFailure = n - nSuccess;
    const mean = (nSuccess + z * z / 2) / (n + z * z);
    const interval = (z / (n + z * z)) * Math.sqrt((nSuccess * nFailure) / n + (z * z / 4));
    return mean - interval;
}

function findSelf(games: GameRow[]): string {
    for (const game of games) {
        if (game.self) {
            return game.self;
        }
    }
    return null;
}

function stateToProps(state: s.State): Props {
    return {
        server: state.server,
    };
}

class RecentGameList extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            category: d.GameCategory.PvP,
            self: null,
            games: null,
            leaderboard: null,
            availableReplays: new Set<string>(),
            error: null,
        };
    }

    componentDidMount() {
        retrieveGamesAsync().then(games => {
            const counts = getCategoryCounts(games);

            // Choose a category with data in it
            let category = this.state.category;
            if (!counts[category] && Object.keys(counts).length > 0) {
                category = Object.keys(counts)[0];
            }

            this.setState({
                games,
                self: findSelf(games),
                category,
            });
        }).then(() => retrieveReplaysAsync(this.state.games.map(g => g.id))).then(ids => {
            this.setState({ availableReplays: new Set<string>(ids) });
        }).then(() => retrieveLeaderboardAsync()).then(leaderboard => {
            this.setState({ leaderboard });
        }).catch(error => {
            this.setState({ error: `${error}` });
        });
    }

    render() {
        return <div className="recent-game-list-section">
            {this.renderCategorySelector()}
            {this.renderGlobals()}
            {this.renderLeaderboard2()}
            {this.renderGames()}
        </div>;
    }

    private renderGames(): JSX.Element {
        const games = getGameSubset(this.state);
        return <div>
            <h1>Stats</h1>
            {this.state.error && <p className="error">Error loading recent games: {this.state.error}</p>}
            {!this.state.games && <p className="loading-text">Loading...</p>}
            {games && games.length === 0 && <p>No recent games</p>}
            {games && games.length > 0 && <div className="game-list">
                <table style={{width: "100%"}}>
                    <col className="timestamp" />
                    <col />
                    <col />
                    <col />
                    <col className="actions" />
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Players</th>
                            <th>Kills</th>
                            <th>Damage</th>
                            <th>Watch</th>
                        </tr>
                    </thead>
                    <tbody>
                        {games.map(game => this.renderRow(game))}
                    </tbody>
                </table>
            </div>}
        </div>
    }

    private renderCategorySelector(): JSX.Element {
        const categoryCounts = getCategoryCounts(this.state.games);
        return <div className="category-selector">
            {Object.keys(categoryCounts).map(category => (
                <div
                    key={category}
                    className={category === this.state.category ? "category category-selected" : "category"}
                    onClick={() => this.setState({ category })}
                    >
                    {category}
                </div>
            ))}
        </div>
    }

    private renderGlobals(): JSX.Element {
        const global = getGlobalStats(this.state);
        if (!(this.state.self && global && this.state.games && this.state.games.length > 0)) {
            return null;
        }

        const self = global.players.get(this.state.self);
        const total = global.totals;
        if (!(self && total && self.games > 0)) {
            return null;
        }

        return <div>
            <h1>Previous {self.games} games</h1>
            <div className="stats-card-row">
                <div className="stats-card" title={`You won ${self.wins} out of ${self.games} games`}>
                    <div className="label">Win rate</div>
                    <div className="value">{Math.round(100 * self.winRate)}%</div>
                </div>
                <div className="stats-card" title={`You scored ${self.kills} kills out of ${total.kills} total`}>
                    <div className="label">Kills per game</div>
                    <div className="value">{self.killsPerGame.toFixed(1)}</div>
                </div>
                <div className="stats-card" title={`You did ${Math.round(self.damage)} damage out of ${Math.round(total.damage)} total`}>
                    <div className="label">Damage per game</div>
                    <div className="value">{Math.round(self.damagePerGame)}</div>
                </div>
            </div>
        </div>
    }

    private renderLeaderboard2() {
        if (!this.state.leaderboard) {
            return null;
        }

        return <div>
            <h1>Leaderboard</h1>
            <div className="leaderboard">
                {this.state.leaderboard.map((player, index) => <div className="leaderboard-row">
                    <span className="position">{index + 1}</span>
                    <span className="player-name">{player.name}</span>
                    <span className="win-count" title={`${player.rd} ratings deviation`}>{Math.round(player.lowerBound)} rating</span>
                </div>)}
            </div>
        </div>
    }

    private renderLeaderboard(): JSX.Element {
        const global = getGlobalStats(this.state);
        if (!(this.state.self && global)) {
            return null;
        }

        const MinGames = 5;
        const MaxLeaderboardLength = 10;
        const self = this.state.self;

        let players = [...global.players.values()];
        players = players.filter(p => p.games >= MinGames);
        players = _.sortBy(players, (p: LeaderboardStats) => -p.winRateLowerBound);
        if (players.length === 0) {
            return null;
        }

        return <div>
            <h1>Leaderboard</h1>
            <div className="leaderboard">
                {players.map((player, index) => (index < MaxLeaderboardLength || player.userHash === self) ? this.renderLeaderboardRow(player, index) : null)}
            </div>
        </div>;
    }

    private renderLeaderboardRow(player: LeaderboardStats, index: number) {
        return <div
            className={index === 0 ? "leaderboard-row leaderboard-best" : "leaderboard-row"}
            title={`${Math.round(100 * player.winRate)}% win rate (${player.games} games), ${player.killsPerGame.toFixed(1)} kills per game, ${Math.round(player.damagePerGame)} damage per game`}>
            <span className="position">{index + 1}</span>
            <span className="player-name">{player.name}</span>
            <span className="win-count">{Math.round(100 * player.winRate)}% win rate ({player.games} games)</span>
        </div>
    }
    
    private renderRow(game: GameRow): JSX.Element {
        const self = game.players.get(game.self);
        if (!self) {
            return null;
        }

        return <tr>
            <td title={game.createdTimestamp.toLocaleString()}>{game.createdTimestamp.fromNow()}</td>
            <td>{joinWithComma([...game.players.values()].map(player => this.renderPlayer(player)))}</td>
            <td title={`You scored ${self.kills} kills out of ${game.totals.kills} total`}>{self.kills}</td>
            <td title={`You did ${Math.round(self.damage)} damage out of ${Math.round(game.totals.damage)} total`}>{Math.round(self.damage)}</td>
            <td>{this.state.availableReplays.has(game.id) && <a href={this.gameUrl(game)} onClick={(ev) => this.onWatchGameClicked(ev, game)}>Watch <i className="fa fa-external-link-square-alt" /></a>}</td>
        </tr>
    }

    private renderPlayer(player: PlayerStats): JSX.Element {
        return <span className="player-cell" title={`${player.name}: ${player.wins ? "winner, " : ""}${player.kills} kills, ${Math.round(player.damage)} damage`}>
            <span className={player.wins ? "winner" : ""}>
                {player.wins ? <i className="fas fa-crown" /> : null}
                {player.name}
            </span>
        </span>
    }

    private gameUrl(game: GameRow): string {
        return url.getPath({
            gameId: game.id,
            party: null,
            server: game.server,
            page: null,
        });
    }

    private onWatchGameClicked(ev: React.MouseEvent, game: GameRow) {
        ev.preventDefault();

        matches.joinNewGame(game.id);
    }
}

export default ReactRedux.connect(stateToProps)(RecentGameList);