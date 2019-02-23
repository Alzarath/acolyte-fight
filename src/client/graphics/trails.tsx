import Color from 'color';
import * as pl from 'planck-js';
import * as r from './render.model';
import * as shaders from './shaders';
import * as vector from '../../game/vector';

const FeatherFactor = 5; // Render up to this radius to ensure the Gaussian blur reaches close to zero
const trailFragmentShader = require('./trailFragmentShader.glsl');
const trailVertexShader = require('./trailVertexShader.glsl');

export function initData(): r.DrawTrailsData {
    return {
        uniforms: {
        },
        attribs: {
            a_pos: [],
            a_rel: [],
            a_color: [],
            a_shape: [],
        },
        numVertices: 0,
    };
}

export function initTrails(gl: WebGLRenderingContext): r.DrawTrails {
	const program = shaders.compileProgram(gl, trailVertexShader, trailFragmentShader);
	return {
		program,
		uniforms: {
			u_translate: {
				loc: gl.getUniformLocation(program, "u_translate"),
				type: gl.FLOAT,
				size: 2,
			},
			u_scale: {
				loc: gl.getUniformLocation(program, "u_scale"),
				type: gl.FLOAT,
				size: 2,
			},
			u_pixel: {
				loc: gl.getUniformLocation(program, "u_pixel"),
				type: gl.FLOAT,
				size: 1,
			},
		},
		attribs: {
			a_pos: {
				loc: gl.getAttribLocation(program, "a_pos"),
				buffer: gl.createBuffer(),
				type: gl.FLOAT,
				size: 2,
			},
			a_rel: {
				loc: gl.getAttribLocation(program, "a_rel"),
				buffer: gl.createBuffer(),
				type: gl.FLOAT,
				size: 2,
			},
			a_color: {
				loc: gl.getAttribLocation(program, "a_color"),
				buffer: gl.createBuffer(),
				type: gl.FLOAT,
				size: 4,
			},
			a_shape: {
				loc: gl.getAttribLocation(program, "a_shape"),
				buffer: gl.createBuffer(),
				type: gl.FLOAT,
				size: 4,
			},
		},
	};
}

function appendCurveShape(data: number[], fill: r.Fill) {
	data.push(fill.minRadius, fill.maxRadius);

	if (fill.feather) {
		data.push(fill.feather.sigma, fill.feather.alpha);
	} else {
		data.push(0, 0);
	}
}

function appendTrail(ctxStack: r.CanvasCtxStack, pos: pl.Vec2, rel: pl.Vec2, color: Color, fill: r.Fill) {
    const trails = ctxStack.data.trails;
	shaders.appendVec2(trails.attribs.a_pos, pos);
	shaders.appendVec2(trails.attribs.a_rel, rel);
	shaders.appendColor(trails.attribs.a_color, color);
	appendCurveShape(trails.attribs.a_shape, fill);
	++trails.numVertices;
}

export function circle(ctxStack: r.CanvasCtxStack, pos: pl.Vec2, color: Color, fill: r.Fill) {
	const extent = calculateExtent(fill);
	const quad = [
		pl.Vec2(-extent, -extent),
		pl.Vec2(-extent, extent),
		pl.Vec2(extent, extent),
		pl.Vec2(extent, -extent),
	];

	appendTrail(ctxStack, pos, quad[0], color, fill);
	appendTrail(ctxStack, pos, quad[1], color, fill);
	appendTrail(ctxStack, pos, quad[2], color, fill);

	appendTrail(ctxStack, pos, quad[2], color, fill);
	appendTrail(ctxStack, pos, quad[3], color, fill);
	appendTrail(ctxStack, pos, quad[0], color, fill);
}

export function line(ctxStack: r.CanvasCtxStack, from: pl.Vec2, to: pl.Vec2, color: Color, fill: r.Fill) {
	const extent = calculateExtent(fill);
	const down = vector.relengthen(vector.rotateRight(vector.diff(to, from)), extent);
	const up = vector.negate(down);

	appendTrail(ctxStack, from, up, color, fill);
	appendTrail(ctxStack, from, down, color, fill);
	appendTrail(ctxStack, to, up, color, fill);

	appendTrail(ctxStack, to, up, color, fill);
	appendTrail(ctxStack, from, down, color, fill);
	appendTrail(ctxStack, to, down, color, fill);
}

export function arc(ctxStack: r.CanvasCtxStack, pos: pl.Vec2, angle1: number, angle2: number, antiClockwise: boolean, color: Color, fill: r.Fill) {
    const extent = Math.sqrt(2) * calculateExtent(fill); // sqrt(2) ensures the triangle always fully enclosees the arc

	const center = vector.zero();
	const rels = new Array<pl.Vec2>();

    let currentAngle = angle1;
    for (let i = 0; i < 4; ++i) { // Maximum 4 right angle rotations
		const rel = vector.multiply(vector.fromAngle(currentAngle), extent);
		rels.push(rel);

        const direction = (antiClockwise ? -1 : 1);
        const step = direction * Math.PI / 2;

        let nextAngle: number;
        let deltaToTarget = vector.angleDelta(currentAngle, angle2);
        if (deltaToTarget === 0) {
            break;
        } else if (Math.sign(deltaToTarget) === Math.sign(direction) && Math.abs(deltaToTarget) < Math.abs(step)) {
            nextAngle = angle2;
        } else {
            nextAngle = currentAngle + step;
        }

        currentAngle = nextAngle;
    }

    for (let i = 0; i < rels.length - 1; ++i) {
		appendTrail(ctxStack, pos, center, color, fill);
		appendTrail(ctxStack, pos, rels[i], color, fill);
		appendTrail(ctxStack, pos, rels[i + 1], color, fill);
    }
}

function calculateExtent(fill: r.Fill) {
    let extent = fill.maxRadius;
    if (fill.feather) {
        extent += fill.feather.sigma * FeatherFactor;
    }
    return extent;
}