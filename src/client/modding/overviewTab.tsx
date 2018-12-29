import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as Reselect from 'reselect';
import * as e from './editor.model';
import * as fileUtils from '../core/fileUtils';
import * as pages from '../core/pages';
import * as parties from '../core/parties';
import * as rooms from '../core/rooms';
import * as url from '../url';

const FileSaver = require('../../lib/file-saver');

const stringifyMod = Reselect.createSelector(
    (mod: Object) => mod,
    (mod: Object) => JSON.stringify(mod, null, "\t"),
);

interface Props {
    currentMod: Object;
    onUpdateMod: (mod: Object) => void;

    error: boolean;
}
interface State {
    selectedFile: File;
    loadFromFileError: string;
}

class OverviewTab extends React.PureComponent<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            selectedFile: null,
            loadFromFileError: null,
        };
    }

    render() {
        return <div className="page-container">
            <div className="page">
                <h1>Modding</h1>
                {this.renderCurrentState()}
                {this.renderHelp()}
            </div>
        </div>;
    }

    private renderHelp() {
        return <div>
            <h2>Reference</h2>
            <ul>
                <li><a href="api/acolytefight.d.ts">acolytefight.d.ts</a> - this is a TypeScript definition file that defines the schema of the settings</li>
            </ul>
        </div>
    }

    private renderCurrentState() {
        const currentMod = this.props.currentMod;
        if (currentMod) {
            return Object.keys(currentMod).length > 0 ? this.renderCurrentMod(currentMod) : this.renderEmptyMod();
        } else if (this.props.error) {
            return this.renderCurrentModError();
        } else {
            return <p>Processing...</p>;
        }
    }

    private renderEmptyMod() {
        return <div>
            <p>
                Mods allow you to change the rules of the game for your party.
                This feature is experimental and will be subject to a lot of change!
                Forward compatibility is not guaranteed - functional mods in the current version may be broken by future releases.
            </p>
            <h2>Create new mod</h2>
            <p>Go to the other tabs (at the top) and start changing some values! Come back to this tab to save your mod file.</p>
            <h2>Open file</h2>
            <p>Choose a mod file: <input className="file-selector" type="file" onChange={e => this.setState({ selectedFile: e.target.files.item(0) })} /></p>
            <div className={this.state.selectedFile ? "btn" : "btn btn-disabled"} onClick={() => this.onLoadModFile(this.state.selectedFile)}>Load from file</div>
            {this.state.loadFromFileError && <p className="error">{this.state.loadFromFileError}</p>}
            <h2>Examples</h2>
            <ul>
                <li><a href="static/fireballMod.acolytefight.json" onClick={(ev) => this.onLoadModHref(ev)}>fireballMod.acolytefight.json</a> - this example mod decreases fireball cooldown.</li>
                <li><a href="static/homingClusterMod.acolytefight.json" onClick={(ev) => this.onLoadModHref(ev)}>homingClusterMod.acolytefight.json</a> - this is an example of creating a new spell - a slow cluster of homing missiles.</li>
                <li><a href="static/noMove.acolytefight.json" onClick={(ev) => this.onLoadModHref(ev)}>noMove.acolytefight.json</a> - this example mod disables normal movement but reduces the speed of teleport.</li>
            </ul>
        </div>
    }

    private renderCurrentMod(currentMod: Object) {
        return <div>
            <p>
                The mod below is currently active.
                You will automatically be matched to other players who currently have the same mod activated.
            </p>
            <textarea className="mod-json" value={stringifyMod(this.props.currentMod)} readOnly />
            <div className="button-row">
                <div className="btn" onClick={() => this.onSaveModFile(currentMod)}>Save to File</div>
            </div>
            {this.renderDiscard()}
        </div>
    }

    private renderCurrentModError() {
        return <div>
            <p className="error">Your mod currently has an error - check the other tabs (above) to fix them.</p>
            {this.renderDiscard()}
        </div>
    }

    private renderDiscard() {
        return <>
            <h2>Back to Default Settings</h2>
            <p>Discard the current mod and revert back to default settings.</p>
            <div className="btn" onClick={() => this.props.onUpdateMod({})}>Discard</div>
        </>
    }

    private async onLoadModHref(ev: React.MouseEvent<HTMLAnchorElement>) {
        try {
            const el = ev.currentTarget;
            if (el && el.href) {
                ev.preventDefault();
                const res = await fetch(el.href);
                const mod = await res.json();
                this.props.onUpdateMod(mod);
            }
        } catch (exception) {
            console.error("Error loading mod from URL", exception);
            this.setState({ loadFromFileError: `${exception}` });
        }
    }

    private async onLoadModFile(file: File) {
        try {
            const json = await fileUtils.readFileAsync(file);
            const mod = JSON.parse(json);
            if (!(mod && typeof mod === "object")) {
                throw "Invalid mod";
            }
            if (!(mod.Mod && mod.Mod.name)) {
                mod.Mod = mod.Mod || {};
                mod.Mod.name = file.name;
            }
            this.props.onUpdateMod(mod);
        } catch (exception) {
            console.error("Error loading mod from file", exception);
            this.setState({ loadFromFileError: `${exception}` });
        }
    }

    private onSaveModFile(currentMod: ModTree) {
        if (currentMod) {
            const json = JSON.stringify(currentMod, null, "\t");

            let filename = (currentMod.Mod && currentMod.Mod.name) || "acolytefight.mod";
            if (!/\.json$/.test(filename)) {
                filename += ".json";
            }

            FileSaver.saveAs(new Blob([json], {type: "application/json;charset=utf-8"}), filename);
        }
    }
}

export default OverviewTab;