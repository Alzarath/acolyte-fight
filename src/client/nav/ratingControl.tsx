import _ from 'lodash';
import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as cloud from '../core/cloud';
import * as constants from '../../game/constants';
import * as loader from '../core/loader';
import * as m from '../../shared/messages.model';
import * as pages from '../core/pages';
import * as s from '../store.model';
import * as rankings from '../core/rankings';
import * as StoreProvider from '../storeProvider';
import * as url from '../url';
import HrefItem from './hrefItem';
import PageLink from './pageLink';

interface Props {
    userId: string;
    profile: m.GetProfileResponse;
    unranked: boolean;
    leagues: m.League[];
    touched: boolean;
}

function stateToProps(state: s.State): Props {
    return {
        userId: state.userId,
        profile: state.profile,
        unranked: state.options.unranked,
        leagues: state.leagues,
        touched: state.touched,
    };
}

class RatingControl extends React.PureComponent<Props> {
    private uploadSettingsDebounced = _.debounce(() => cloud.uploadSettings(), 200);

    constructor(props: Props) {
        super(props);
        this.state = {
        }
    }

    componentDidMount() {
        this.loadData(); // Don't await
    }

    private async loadData() {
        await loader.loaded();

        if (!this.props.profile) {
            await rankings.retrieveMyStatsAsync();
        }
        if (!this.props.leagues) {
            await rankings.downloadLeagues();
        }
    }

    render() {
        const rating = this.getRating();
        if (rating) {
            if (this.props.unranked) {
                return this.renderUnrankedToggle();
            } else {
                return <>
                    {this.renderRankedToggle()}
                    {this.renderRank(rating)}
                </>
            }
        } else {
            return null;
        }
    }

    private renderUnrankedToggle() {
        return <>
            <HrefItem
                key="unranked-toggle"
                className="nav-item-unranked-toggle"
                title="You are currently in unranked mode - you will not gain or lose rating points. Click to switch to Ranked Mode"
                onClick={ev => this.onUnrankedToggleClick(ev)}>
                <i className="fas fa-gamepad" />
            </HrefItem>
            <PageLink shrink={true} key="rank" page="profile" className="nav-item-ranking" profileId={this.props.userId}>
                Unranked Mode
            </PageLink>
        </>
    }

    private renderRankedToggle() {
        return <HrefItem
            key="unranked-toggle"
            className="nav-item-unranked-toggle"
            title="Switch to Unranked Mode"
            onClick={ev => this.onUnrankedToggleClick(ev)}>
            <i className="fas fa-trophy-alt" />
        </HrefItem>
    }

    private renderRank(rating: m.UserRating) {
        if (!this.props.leagues) {
            // Leagues not loaded, cannot render yet
            return null;
        }

        const league = rankings.getLeagueFromRating(rating.acoExposure, this.props.leagues);
        if (!league) {
            return null;
        }

        return <PageLink shrink={true} key="rank" page="profile" className="nav-item-ranking" profileId={this.props.userId}>
            <b>{league.name}</b> {Math.floor(rating.acoExposure)}
        </PageLink>
    }

    private getRating() {
        const profile = this.props.profile;
        if (!(profile && profile.ratings)) {
            return null;
        }

        const rating = profile.ratings[m.GameCategory.PvP];
        if (!rating) {
            return null;
        }

        if (!(rating.acoExposure && rating.acoPercentile >= 0)) {
            return null;
        }

        return rating;
    }

    private onUnrankedToggleClick(ev: React.MouseEvent) {
        ev.preventDefault();
        if (this.props.touched) { // Can't display tooltips on mobile so take them to the relevant page instead
            pages.changePage("profile", this.props.userId);
        } else {
            StoreProvider.dispatch({
                type: "updateOptions",
                options: {
                    unranked: !this.props.unranked,
                },
            });
            this.uploadSettingsDebounced();
        }
    }
}

export default ReactRedux.connect(stateToProps)(RatingControl);