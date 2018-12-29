import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as d from '../stats.model';
import * as m from '../../game/messages.model';
import * as s from '../store.model';
import * as w from '../../game/world.model';
import AccountPanel from './accountPanel';
import AiPanel from './aiPanel';
import DebugPanel from './debugPanel';
import EditorPage from './editorPage';
import GamePanel from './gamePanel';
import HomePanel from './homePanel';
import LeaderboardPanel from './leaderboardPanel';
import PartyPanel from './partyPanel';
import PrivacyPolicyPanel from './privacyPolicyPanel';
import ProfilePanel from './profilePanel';
import SettingsPanel from './settingsPanel';
import TitleSection from './titleSection';
import NavBar from '../nav/navbar';
import RegionsPanel from './regionsPanel';
import UrlListener from './urlListener';
import WatchLooper from './watchLooper';

interface Props {
    myGameId: string;
    current: s.PathElements;
}

function stateToProps(state: s.State): Props {
    return {
        myGameId: state.world.ui.myGameId,
        current: state.current,
    };
}

class Root extends React.Component<Props> {
    constructor(props: Props) {
        super(props);
        this.state = {
        };
    }

    render() {
        if (this.props.myGameId) {
            return this.renderGame();
        } else {
            return this.renderPage();
        }
    }

    private renderGame() {
        return <GamePanel />;
    }

    private renderPage() {
        const page = this.props.current.page;
        return (
            <div className="root-panel">
                {page === "" && this.renderHome()}
                {page === "debug" && this.renderDebug()}
                {page === "leaderboard" && this.renderLeaderboard()}
                {page === "party" && this.renderParty()}
                {page === "modding" && this.renderModding()}
                {page === "ai" && this.renderAi()}
                {page === "regions" && this.renderRegions()}
                {page === "about" && this.renderAbout()}
                {page === "profile" && this.renderProfile()}
                {page === "settings" && this.renderSettings()}
                {page === "watch" && this.renderWatch()}
                {page === "privacy" && this.renderPrivacy()}
                <UrlListener />
            </div>
        );
    }

    private renderHome() {
        return <HomePanel />
    }

    private renderParty() {
        return <div className="content-container">
            <NavBar />
            <div className="page">
                <PartyPanel />
            </div>
        </div>;
    }

    private renderModding() {
        return <EditorPage />;
    }

    private renderAi() {
        return <div className="content-container">
            <NavBar />
            <div className="page">
                <AiPanel />
            </div>
        </div>;
    }

    private renderRegions() {
        return <div className="content-container">
            <NavBar />
            <div className="page">
                <RegionsPanel />
            </div>
        </div>;
    }

    private renderAbout() {
        return <div className="content-container">
            <NavBar />
            <div className="page">
                <TitleSection />
            </div>
        </div>;
    }

    private renderDebug() {
        return <div className="content-container">
            <NavBar />
            <div className="page">
                <DebugPanel />
            </div>
        </div>;
    }

    private renderLeaderboard() {
        return <div className="content-container">
            <NavBar />
            <div className="page">
                <LeaderboardPanel category={m.GameCategory.PvP} />
            </div>
        </div>;
    }

    private renderProfile() {
        return <div className="content-container">
            <NavBar />
            <div className="page">
                <ProfilePanel />
            </div>
        </div>;
    }

    private renderSettings() {
        return <div className="content-container">
            <NavBar />
            <div className="page">
                <SettingsPanel />
            </div>
        </div>;
    }

    private renderWatch() {
        return <div className="content-container">
            <NavBar />
            <div className="page">
                <WatchLooper />
            </div>
        </div>;
    }

    private renderPrivacy() {
        return <div className="content-container">
            <NavBar />
            <div className="page">
                <PrivacyPolicyPanel />
            </div>
        </div>;
    }
}

export default ReactRedux.connect(stateToProps)(Root);