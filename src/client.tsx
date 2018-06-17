import socketLib from 'socket.io-client';
import { attachToCanvas, attachToSocket } from './game/facade';

const socket = socketLib();
const canvas = document.getElementById("canvas") as HTMLCanvasElement;

attachToSocket(socket);
attachToCanvas(canvas);