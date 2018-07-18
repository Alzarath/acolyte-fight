import * as React from 'react';
import * as s from './store.model';
import * as w from '../game/world.model';
import { GamePanel } from './gamePanel';
import { NameConfig } from '../settings/nameConfig';
import { SpellConfig } from '../settings/spellConfig';
import { RecentGameList } from '../settings/recentGameList';
import { TitleSection } from '../settings/titleSection';

interface Props {
    playerName: string;
    world: w.World;
    items: s.NotificationItem[];
    page: string;
    changePage: (newPage: string) => void;
    newGameCallback: () => void;
    exitGameCallback: () => void;
}
interface State {
}

export class Root extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
        };
    }

    render() {
        if (this.props.world.ui.myGameId) {
            return this.renderGame();
        } else {
            return this.renderPage();
        }
    }

    private renderGame() {
        return <GamePanel
            world={this.props.world} 
            items={this.props.items} 
            playerName={this.props.playerName}
            newGameCallback={this.props.newGameCallback}
            exitGameCallback={this.props.exitGameCallback} />;
    }

    private renderPage() {
        const page = this.props.page;
        return (
            <div className="root-panel">
                <div className="navbar">
                    {this.renderNavBarItem(null, "Home")}
                    {this.renderNavBarItem("replays", "Replays")}
                    {this.renderNavBarItem("about", "About")}
                    <div className="spacer" />
                </div>
                {page === null && this.renderHome()}
                {page === "customize" && this.renderSettings()}
                {page === "replays" && this.renderReplays()}
                {page === "about" && this.renderAbout()}
            </div>
        );
    }

    private renderNavBarItem(page: string, label: string) {
        const className = this.props.page === page ? "nav-item nav-item-selected" : "nav-item";
        return <span className={className} onClick={() => this.props.changePage(page)}>{label}</span>
    }

    private renderHome() {
        return <div className="content-container">
            <div className="home">
                <div className="spacer" />
                <div className="title">Acolyte Fight!</div>
                <div className="button-row">
                    <span className="btn primary" onClick={() => this.props.newGameCallback()}>Play</span>
                </div>
                <div className="spacer" />
                <div className="fold-indicator"><i className="fa fa-chevron-down" /></div>
                <div className="spacer" />
            </div>
            <div className="page">
                <h1>Welcome Acolyte!</h1>
                <p>
                    Time to practice your skills.
                    In this arena, you'll find others just like you. Will you be the last one standing?
                </p>
                <NameConfig />
                <SpellConfig />
            </div>
        </div>;
    }

    private renderSettings() {
        return <div className="content-container">
        </div>;
    }

    private renderReplays() {
        return <div className="content-container">
            <div className="page">
                <RecentGameList />
            </div>
        </div>;
    }

    private renderAbout() {
        return <div className="content-container">
            <div className="page">
                <TitleSection />
            </div>
        </div>;
    }
}