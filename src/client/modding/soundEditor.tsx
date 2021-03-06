import _ from 'lodash';
import uniqid from 'uniqid';
import * as pl from 'planck-js';
import * as React from 'react';
import * as ReactRedux from 'react-redux';
import * as e from './editor.model';
import * as s from '../store.model';
import * as w from '../../game/world.model';
import * as audio from '../audio/audio';
import * as editing from './editing';
import EditorPage from './editorPage';
import SectionEditor from './sectionEditor';

const center = pl.Vec2(0.5, 0.5);

interface Props {
    mod: ModTree;
    settings: AcolyteFightSettings;
    selectedId: string;
}
interface State {
    currentAudioElement: audio.AudioElement;
    audioCancelTime: number;
}

function stateToProps(state: s.State): Props {
    return {
        mod: state.mod,
        settings: editing.modToSettings(state.mod),
        selectedId: state.current.hash,
    };
}

class SoundEditor extends React.PureComponent<Props, State> {
    private timerHandle: NodeJS.Timeout = null;

    constructor(props: Props) {
        super(props);
        this.state = {
            currentAudioElement: null,
            audioCancelTime: null,
        };
    }

    componentDidMount() {
        this.timerHandle = setInterval(() => this.onAudioTimer(), 16);
    }
    
    componentWillUnmount() {
        if (this.timerHandle) {
            clearInterval(this.timerHandle);
        }
    }

    render() {
        const id = this.props.selectedId;
        return <EditorPage expand={true}>
            <SectionEditor sectionKey="sounds" addRemovePrefix="sound">
                {(this.state.currentAudioElement) && <div className="btn" onClick={() => this.onStopClick()}><i className="fas fa-stop" /> Stop</div>}
                {(this.props.mod && id) && <div className="btn" onClick={() => this.onPreviewClick(id)}><i className="fas fa-volume" /> Preview Sound</div>}
            </SectionEditor>
        </EditorPage>;
    }

    private onPreviewClick(soundId: string) {
        audio.unlock();

        const audioElement: audio.AudioElement = {
            id: uniqid("preview-"),
            sound: soundId,
            pos: center,
        };
        this.setState({
            currentAudioElement: audioElement,
            audioCancelTime: Date.now() + 3000,
        });
    }

    private onStopClick() {
        this.setState({
            currentAudioElement: null,
            audioCancelTime: null,
        });
    }

    private onAudioTimer() {
        if (!this.props.settings) {
            return;
        }

        const elements = new Array<audio.AudioElement>();
        if (this.state.currentAudioElement) {
            elements.push(this.state.currentAudioElement);
        }
        audio.play(center, elements, this.props.settings.Sounds);

        if (this.state.audioCancelTime && Date.now() >= this.state.audioCancelTime) {
            this.setState({ currentAudioElement: null, audioCancelTime: null });
        }
    }
}

export default ReactRedux.connect(stateToProps)(SoundEditor);