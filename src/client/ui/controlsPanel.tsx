import _ from 'lodash';
import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as keyboardUtils from '../core/keyboardUtils';
import * as m from '../../shared/messages.model';
import * as r from '../graphics/render.model';
import * as s from '../store.model';
import * as w from '../../game/world.model';
import * as cloud from '../core/cloud';
import * as spellUtils from '../core/spellUtils';
import * as Storage from '../storage';
import * as StoreProvider from '../storeProvider';

import './controlsPanel.scss';

namespace Toggle {
    export const On = "on";
    export const Off = "off";
}

namespace MoveWith {
    export const FollowCursor = "follow";
    export const Click = "click";
}

namespace Side {
    export const Left = "left";
    export const Right = "right";
}

namespace TouchTracking {
    export const Fastest = "fastest";
    export const Fast = "fast";
    export const Medium = "medium";
    export const Slow = "slow";
    export const Slowest = "slowest";
}

namespace FontSize {
    export const Normal = "normal";
    export const Large = "large";
}

interface Props {
    keyBindings: KeyBindings;
    rebindings: KeyBindings;
    settings: AcolyteFightSettings;
    options: m.GameOptions;
    touched: boolean;
}

interface ControlState {
    moveWith: string;
    leftClickKey: string;
    rightClickKey: string;
    singleTapKey: string;
    doubleTapKey: string;
    actionWheelSide: string;
    touchTracking: string;
    targetingIndicator: string;
    autoJoin: string;
    cameraFollow: string;
    buttonBarClickable: string;
    fontSize: string;
    profanityFilter: string;
    sounds: string;
    graphics: string;
    shake: string;
}
interface State extends ControlState {
    changed: boolean;
    saved: boolean;
    advanced: boolean;
}

function stateToProps(state: s.State): Props {
    return {
        keyBindings: state.keyBindings,
        rebindings: state.rebindings,
        settings: state.room.settings,
        options: state.options,
        touched: state.touched,
    };
}

function controlConfigToState(rebindings: KeyBindings, options: m.GameOptions): ControlState {
    const moveWith = rebindings[w.SpecialKeys.Hover] === w.SpecialKeys.Move ? MoveWith.FollowCursor : MoveWith.Click;
    return {
        moveWith,
        leftClickKey: rebindings[w.SpecialKeys.LeftClick],
        rightClickKey: rebindings[w.SpecialKeys.RightClick],
        singleTapKey: rebindings[w.SpecialKeys.SingleTap],
        doubleTapKey: rebindings[w.SpecialKeys.DoubleTap],
        actionWheelSide: options.wheelOnRight ? Side.Right : Side.Left,
        touchTracking: formatTouchTracking(options.touchSurfacePixels),
        targetingIndicator: options.noTargetingIndicator ? Toggle.Off : Toggle.On,
        autoJoin: options.noAutoJoin ? Toggle.Off : Toggle.On,
        cameraFollow: options.noCameraFollow ? Toggle.Off : Toggle.On,
        fontSize: formatFontSize(options.fontSizeMultiplier),
        buttonBarClickable: options.noRightClickChangeSpells ? Toggle.Off : Toggle.On,
        profanityFilter: options.noProfanityFilter ? Toggle.Off : Toggle.On,
        sounds: options.mute ? Toggle.Off : Toggle.On,
        graphics: r.formatGraphics(options.graphics),
        shake: options.noShake ? Toggle.Off : Toggle.On,
    };
}

function formatOption(key: string): string {
    return key ? key : "null";
}

function parseOption(value: string): string {
    if (value === "null") {
        return null;
    } else {
        return value;
    }
}

function formatTouchTracking(pixels: number): string {
    if (pixels >= 600) {
        return TouchTracking.Slowest;
    } else if (pixels >= 420) {
        return TouchTracking.Slow;
    } else if (pixels >= 240) {
        return TouchTracking.Medium;
    } else if (pixels >= 180) {
        return TouchTracking.Fast;
    } else if (pixels >= 120) {
        return TouchTracking.Fastest;
     } else {
        return TouchTracking.Medium;
    }
}

function parseTouchTracking(tracking: string): number {
    switch (tracking) {
        case TouchTracking.Fastest: return 120;
        case TouchTracking.Fast: return 180;
        case TouchTracking.Medium: return 240;
        case TouchTracking.Slow: return 420;
        case TouchTracking.Slowest: return 600;
        default: return null;
    }
}

function formatFontSize(multiplier: number): string {
    if (multiplier > 1) {
        return FontSize.Large;
    } else {
        return FontSize.Normal;
    }
}

function parseFontSize(fontSize: string): number {
    switch (fontSize) {
        case FontSize.Large: return 2;
        default: return 1;
    }
}

class ControlsPanel extends React.PureComponent<Props, State> {
    private saveStateDebounced = _.debounce(() => this.saveState(), 500);

    constructor(props: Props) {
        super(props);

        this.state = {
            ...controlConfigToState(props.rebindings, props.options),
            changed: false,
            saved: true,
            advanced: false,
        };
    }

    componentDidUpdate(prevProps: Props) {
        if (prevProps.rebindings !== this.props.rebindings || prevProps.options !== this.props.options) {
            this.setState(controlConfigToState(this.props.rebindings, this.props.options));
        }
    }

    render() {
        const touched = this.props.touched;
        return <div className="controls-panel" onClick={ev => this.onClick(ev)}>
            <h2>Controls</h2>
            {!touched && <div className="row">
                <span className="label">Move with</span>
                <select className="value" value={this.state.moveWith} onChange={ev => this.onUpdate({ moveWith: ev.target.value })}>
                    <option value={MoveWith.Click}>Click</option>
                    <option value={MoveWith.FollowCursor}>Follow cursor</option>
                </select>
            </div>}
            {!touched && <div className="row">
                <span className="label">Left click</span>
                <select
                    className="value"
                    value={formatOption(this.state.leftClickKey)}
                    onChange={ev => this.onUpdate({ leftClickKey: parseOption(ev.target.value) })}
                    >

                    <option value={formatOption(null)}>Move</option>
                    {this.props.settings.Choices.Keys.map(keyConfig => this.renderKeyOption(keyConfig))}
                </select>
            </div>}
            {!touched && <div className="row">
                <span className="label">Right click</span>
                <select
                    className="value"
                    value={formatOption(this.state.rightClickKey)}
                    onChange={ev => this.onUpdate({ rightClickKey: parseOption(ev.target.value) })}
                    >

                    {this.state.rightClickKey === undefined && <option value={formatOption(undefined)}></option>}
                    <option value={formatOption(null)}>Move</option>
                    {this.props.settings.Choices.Keys.map(keyConfig => this.renderKeyOption(keyConfig))}
                </select>
            </div>}
            {touched && <div className="row">
                <span className="label">Single tap</span>
                <select
                    className="value"
                    value={formatOption(this.state.singleTapKey)}
                    onChange={ev => this.onUpdate({ singleTapKey: parseOption(ev.target.value) })}
                    >

                    <option value={formatOption(null)}>Move</option>
                    {this.props.settings.Choices.Keys.map(keyConfig => this.renderKeyOption(keyConfig))}
                </select>
            </div>}
            {touched && <div className="row">
                <span className="label">Double tap</span>
                <select
                    className="value"
                    value={formatOption(this.state.doubleTapKey)}
                    onChange={ev => this.onUpdate({ doubleTapKey: parseOption(ev.target.value) })}
                    >

                    <option value={formatOption(null)}>Move</option>
                    {this.props.settings.Choices.Keys.map(keyConfig => this.renderKeyOption(keyConfig))}
                </select>
            </div>}
            {touched && <div className="row">
                <span className="label">Layout</span>
                <select className="value" value={this.state.actionWheelSide} onChange={ev => this.onUpdate({ actionWheelSide: ev.target.value })}>
                    <option value={formatOption(Side.Left)}>Right-handed</option>
                    <option value={formatOption(Side.Right)}>Left-handed</option>
                </select>
            </div>}
            {touched && <div className="row">
                <span className="label">Touch tracking speed</span>
                <select className="value" value={this.state.touchTracking} onChange={ev => this.onUpdate({ touchTracking: ev.target.value })}>
                    <option value={formatOption(TouchTracking.Fastest)}>Fastest</option>
                    <option value={formatOption(TouchTracking.Fast)}>Fast</option>
                    <option value={formatOption(TouchTracking.Medium)}>Medium</option>
                    <option value={formatOption(TouchTracking.Slow)}>Slow</option>
                    <option value={formatOption(TouchTracking.Slowest)}>Slowest</option>
                </select>
                <div className="info">How fast should the cursor move?</div>
            </div>}
            {!touched && <div className="row">
                <span className="label">On-screen buttons</span>
                <select className="value" value={this.state.buttonBarClickable} onChange={ev => this.onUpdate({ buttonBarClickable: ev.target.value })}>
                    <option value={Toggle.On}>Enabled</option>
                    <option value={Toggle.Off}>Disabled</option>
                </select>
                {this.state.buttonBarClickable === Toggle.On && <span className="info">Click on the on-screen buttons to cast spells</span>}
                {this.state.buttonBarClickable === Toggle.Off && <span className="info">Must use the keyboard to cast spells</span>}
            </div>}
            <h2>Interface</h2>
            <div className="row">
                <span className="label">Sound</span>
                <select className="value" value={this.state.sounds} onChange={ev => this.onUpdate({ sounds: ev.target.value })}>
                    <option value={Toggle.On}>On</option>
                    <option value={Toggle.Off}>Off</option>
                </select>
            </div>
            <div className="row">
                <span className="label">Profanity filter</span>
                <select className="value" value={this.state.profanityFilter} onChange={ev => this.onUpdate({ profanityFilter: ev.target.value })}>
                    <option value={Toggle.On}>On</option>
                    <option value={Toggle.Off}>Off</option>
                </select>
            </div>
            <div className="row">
                <span className="label">Auto-join next match</span>
                <select className="value" value={this.state.autoJoin} onChange={ev => this.onUpdate({ autoJoin: ev.target.value })}>
                    <option value={Toggle.On}>On</option>
                    <option value={Toggle.Off}>Off</option>
                </select>
            </div>
            <h2>Visuals</h2>
            <div className="row">
                <span className="label">Font size</span>
                <select className="value" value={this.state.fontSize} onChange={ev => this.onUpdate({ fontSize: ev.target.value })}>
                    <option value={FontSize.Normal}>Normal</option>
                    <option value={FontSize.Large}>Large</option>
                </select>
            </div>
            <div className="row">
                <span className="label">Targeting Indicator</span>
                <select className="value" value={this.state.targetingIndicator} onChange={ev => this.onUpdate({ targetingIndicator: ev.target.value })}>
                    <option value={Toggle.On}>On</option>
                    <option value={Toggle.Off}>Off</option>
                </select>
            </div>
            <div className="row">
                <span className="label">Camera follow</span>
                <select className="value" value={this.state.cameraFollow} onChange={ev => this.onUpdate({ cameraFollow: ev.target.value })}>
                    <option value={Toggle.On}>On</option>
                    <option value={Toggle.Off}>Off</option>
                </select>
                <span className="info">Whether to zoom and pan if the screen is too small.</span>
            </div>
            <div className="row">
                <span className="label">Screen shake</span>
                <select className="value" value={this.state.shake} onChange={ev => this.onUpdate({ shake: ev.target.value })}>
                    <option value={Toggle.On}>On</option>
                    <option value={Toggle.Off}>Off</option>
                </select>
            </div>
            <h2>Performance</h2>
            <div className="row">
                <span className="label">Graphics</span>
                <select className="value" value={this.state.graphics} onChange={ev => this.onUpdate({ graphics: ev.target.value })}>
                    <option value={formatOption(null)}>Auto</option>
                    <option value={r.Graphics.Maximum}>Maximum</option>
                    <option value={r.Graphics.Ultra}>Ultra</option>
                    <option value={r.Graphics.High}>High</option>
                    <option value={r.Graphics.Medium}>Medium</option>
                    <option value={r.Graphics.Low}>Low</option>
                    <option value={r.Graphics.Minimum}>Minimum</option>
                </select>
            </div>
            {this.state.changed && <div className="status-row">
                {this.state.saved 
                    ? "Changes saved"
                    : "Unsaved changes"}
            </div>}
        </div>;
    }

    private renderKeyOption(keyConfig: KeyConfig) {
        if (!keyConfig) {
            return null;
        }

        const key = keyConfig.btn;
        const spell = spellUtils.resolveSpellForKey(key, this.props.keyBindings, this.props.settings);
        if (spell) {
            return <option key={key} value={key}>{spellUtils.spellName(spell)}</option>
        } else {
            return null;
        }
    }

    private onUpdate(settings: Partial<ControlState>) {
        const update: Partial<State> = { ...settings, changed: true, saved: false };
        this.setState(update as any);
        this.saveStateDebounced();
    }

    private onClick(ev: React.MouseEvent) {
        if (ev.altKey && ev.shiftKey) {
            this.setState({ advanced: true });
        }
    }

    private saveState() {
        const state = this.state;

        // Update rebindings
        {
            const rebindings = { ...this.props.rebindings };
            rebindings[w.SpecialKeys.Hover] = state.moveWith === MoveWith.FollowCursor ? w.SpecialKeys.Move : w.SpecialKeys.Retarget;
            rebindings[w.SpecialKeys.LeftClick] = state.leftClickKey;
            rebindings[w.SpecialKeys.RightClick] = state.rightClickKey;
            rebindings[w.SpecialKeys.SingleTap] = state.singleTapKey;
            rebindings[w.SpecialKeys.DoubleTap] = state.doubleTapKey;

            StoreProvider.dispatch({ type: "updateRebindings", rebindings });
            Storage.saveRebindingConfig(rebindings);
        }

        // Update options
        {
            const options = { ...this.props.options };
            options.wheelOnRight = state.actionWheelSide === Side.Right;
            options.mute = state.sounds === Toggle.Off;
            options.noProfanityFilter = state.profanityFilter === Toggle.Off;
            options.noTargetingIndicator = state.targetingIndicator === Toggle.Off;
            options.noAutoJoin = state.autoJoin === Toggle.Off;
            options.noCameraFollow = state.cameraFollow === Toggle.Off;
            options.noRightClickChangeSpells = state.buttonBarClickable === Toggle.Off;
            options.fontSizeMultiplier = parseFontSize(state.fontSize);
            options.touchSurfacePixels = parseTouchTracking(state.touchTracking);
            options.noShake = state.shake === Toggle.Off;
            options.graphics = r.parseGraphics(state.graphics);
            StoreProvider.dispatch({ type: "updateOptions", options });
            Storage.saveOptions(options);
        }

        this.setState({ saved: true });
        cloud.uploadSettings();
    }
}

export default ReactRedux.connect(stateToProps)(ControlsPanel);