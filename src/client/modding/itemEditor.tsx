import _ from 'lodash';
import classNames from 'classnames';
import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as e from './editor.model';
import * as s from '../store.model';
import * as editing from './editing';
import * as StoreProvider from '../storeProvider';
import Button from '../controls/button';
import CodeEditor from './codeEditor';

interface OwnProps {
    sectionKey: string;
}
interface Props extends OwnProps {
    codeTree: e.CodeTree;
    selectedId: string;
    defaults: e.CodeSection;
    section: e.CodeSection;
    errors: e.ErrorSection;
    currentMod: ModTree;
    children?: React.ReactFragment;
}
interface State {
}

const noErrors = {}; // Reuse this to keep reference equality
function stateToProps(state: s.State, ownProps: OwnProps): Props {
    const defaults = editing.defaultTree[ownProps.sectionKey];
    return {
        ...ownProps,
        codeTree: state.codeTree,
        defaults,
        section: state.codeTree ? state.codeTree[ownProps.sectionKey] : defaults,
        errors: state.modErrors[ownProps.sectionKey] || noErrors,
        currentMod: state.mod,
        selectedId: state.current.hash,
    };
}

class ItemEditor extends React.PureComponent<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
        };
    }

    render() {
        const codeTree = this.props.codeTree;
        if (!codeTree) {
            return null;
        }

        const id = this.props.selectedId;
        if (id) {
            const error = this.props.errors[id];
            const code = this.props.section[id] || "";
            return this.renderItemEditor(id, code, error);
        } else {
            return <div className="code-area"></div>;
        }
    }

    private renderItemEditor(id: string, code: string, error: string) {
        return <div className="code-panel">
            <CodeEditor key="code" code={code} onChange={(code) => this.onCodeChange(id, code)} />
            <div className="editor-actions button-row">
                {this.renderRevertButton()}
                {this.renderCanonicalizeButton()}
                {this.renderStatus(error)}
                <div className="spacer"></div>
                {this.props.children}
            </div>
        </div>
    }

    private renderStatus(error: string) {
        if (error) {
            return <div className="editor-status error">{error}</div>;
        } else {
            return null;
        }
    }

    private onCodeChange(id: string, code: string) {
        editing.updateItem(this.props.sectionKey, id, code);
    }

    private renderRevertButton() {
        const selectedId = this.props.selectedId;
        if (!selectedId) {
            return null;
        }

        const hasDefault = selectedId in this.props.defaults;
        const isModded = this.props.section[selectedId] !== this.props.defaults[selectedId];
        const disabled = !(selectedId && hasDefault && isModded);
        const className = classNames({ 'btn': true, 'btn-disabled': disabled });
        return <div className={className} title="Revert to default settings" onClick={() => !disabled && this.onRevertClick()}><i className="fas fa-history" /> Revert</div>;
    }

    private onRevertClick() {
        const selectedId = this.props.selectedId;
        if (!(selectedId)) {
            return;
        }

        if (selectedId in this.props.defaults) {
            editing.updateItem(this.props.sectionKey, selectedId, this.props.defaults[selectedId]);
        } else {
            editing.deleteItem(this.props.sectionKey, selectedId);
        }
    }

    private renderCanonicalizeButton() {
        return <Button title="Reformat" disabled={!this.props.currentMod} onClick={() => this.onCanonicalizeClick()}><i className="fas fa-align-left" /> Format</Button>;
    }

    private onCanonicalizeClick() {
        if (this.props.currentMod) {
            editing.canonlicalize(this.props.currentMod);
        }
    }

}

export default ReactRedux.connect(stateToProps)(ItemEditor);