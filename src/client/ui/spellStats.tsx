import * as _ from 'lodash';
import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as s from '../store.model';
import * as w from '../../game/world.model';
import * as spellUtils from '../core/spellUtils';
import { ButtonBar, TicksPerSecond } from '../../game/constants';
import { SpellIcon } from './spellIcon';

interface OwnProps {
    spellId: string;
}
interface Props extends OwnProps {
    settings: AcolyteFightSettings;
}
interface State {
}

function stateToProps(state: s.State, ownProps: OwnProps): Props {
    return {
        spellId: ownProps.spellId,
        settings: state.world.settings,
    };
}

function formatTime(ticks: number) {
    const seconds = ticks / TicksPerSecond;
    return Math.round(seconds * 100) / 100;
}

class SpellStats extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
        };
    }

    render() {
        const spell = this.props.settings.Spells[this.props.spellId];
        if (!spell) {
            return null;
        }

        if (spell.action === "projectile") {
            return <div className="spell-stats">
                <span className="spell-stats-item" title="Damage"><i className="ra ra-sword" />{spell.projectile.damage}{spell.projectile.bounce && " per bounce"}</span>
                <span className="spell-stats-item" title="Cooldown"><i className="fas fa-clock" />{formatTime(spell.cooldown)} s</span>
            </div>
        } else if (spell.action === "spray") {
            const hits = spell.lengthTicks / spell.intervalTicks;
            const totalDamage = spell.projectile.damage * hits;
            return <div className="spell-stats">
                <span className="spell-stats-item" title="Damage"><i className="ra ra-sword" />{totalDamage} over {formatTime(spell.lengthTicks)} s</span>
                <span className="spell-stats-item" title="Cooldown"><i className="fas fa-clock" />{formatTime(spell.cooldown)} s</span>
            </div>
        } else if (spell.action === "scourge") {
            return <div className="spell-stats">
                <span className="spell-stats-item" title="Damage"><i className="ra ra-sword" />{spell.damage}</span>
                <span className="spell-stats-item" title="Cooldown"><i className="fas fa-clock" />{formatTime(spell.cooldown)} s</span>
            </div>
        } else {
            return <div className="spell-stats">
                <span className="spell-stats-item" title="Cooldown"><i className="fas fa-clock" />{formatTime(spell.cooldown)} s</span>
            </div>
        }
    }
}

export default ReactRedux.connect(stateToProps)(SpellStats);