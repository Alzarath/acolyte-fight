import * as _ from 'lodash';
import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as s from '../store.model';
import * as w from '../../game/world.model';
import * as spellUtils from '../core/spellUtils';
import { ButtonBar, TicksPerSecond } from '../../game/constants';

interface OwnProps {
    spellId: string;
    settings: AcolyteFightSettings;
}
interface Props extends OwnProps {
}
interface State {
}

function stateToProps(state: s.State, ownProps: OwnProps): Props {
    return {
        ...ownProps,
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

        if (spell.action === "projectile" || spell.action === "retractor") {
            const damage = this.calculateProjectileDamage(spell.projectile);
            return <div className="spell-stats">
                <span className="spell-stats-item" title="Damage"><i className="ra ra-sword" />{damage}{damage > 0 && this.renderScaling(spell.projectile.damageScaling)}{spell.projectile.bounce && " per bounce"}</span>
                <span className="spell-stats-item" title="Cooldown"><i className="fas fa-clock" />{formatTime(spell.cooldown)} s</span>
            </div>
        } else if (spell.action === "spray") {
            const hits = spell.lengthTicks / spell.intervalTicks;
            const totalDamage = this.calculateProjectileDamage(spell.projectile) * hits;
            const overTime = spell.lengthTicks >= 60 ? ` over ${formatTime(spell.lengthTicks)} s` : "";
            return <div className="spell-stats">
                <span className="spell-stats-item" title="Damage"><i className="ra ra-sword" />{totalDamage}{totalDamage > 0 && this.renderScaling(spell.projectile.damageScaling)}{overTime}</span>
                <span className="spell-stats-item" title="Cooldown"><i className="fas fa-clock" />{formatTime(spell.cooldown)} s</span>
            </div>
        } else if (spell.action === "scourge") {
            return <div className="spell-stats">
                <span className="spell-stats-item" title="Damage"><i className="ra ra-sword" />{spell.detonate.damage}{spell.detonate.damage > 0 && this.renderScaling(spell.damageScaling)}</span>
                <span className="spell-stats-item" title="Damage to self"><i className="fas fa-heart" />{spell.selfDamage}</span>
                <span className="spell-stats-item" title="Cooldown"><i className="fas fa-clock" />{formatTime(spell.cooldown)} s</span>
            </div>
        } else {
            return <div className="spell-stats">
                <span className="spell-stats-item" title="Cooldown"><i className="fas fa-clock" />{formatTime(spell.cooldown)} s</span>
            </div>
        }
    }

    private renderScaling(damageScaling: boolean) {
        const scales = damageScaling === undefined ? true : damageScaling;
        if (scales) {
            const maxScaling = 1 + this.props.settings.Hero.AdditionalDamageMultiplier;
            return <span className="spell-stats-scaling" title={`This spell scales up to ${maxScaling}x damage as the Acolyte loses health`}>+</span>;
        } else {
            return null;
        }
    }

    private calculateProjectileDamage(projectile: ProjectileTemplate) {
        return projectile.damage + (projectile.detonate ? projectile.detonate.damage : 0);
    }
}

export default ReactRedux.connect(stateToProps)(SpellStats);