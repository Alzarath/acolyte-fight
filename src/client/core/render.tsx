import Color from 'color';
import * as pl from 'planck-js';
import * as Reselect from 'reselect';
import * as audio from './audio';
import * as constants from '../../game/constants';
import * as engine from '../../game/engine';
import * as keyboardUtils from './keyboardUtils';
import * as icons from './icons';
import * as vector from '../../game/vector';
import * as w from '../../game/world.model';

import { ButtonBar, ChargingIndicator, DashIndicator, HealthBar, HeroColors, Pixel } from '../../game/constants';
import { renderIconButton, renderIconOnly } from './renderIcon';
import { isMobile, isEdge } from '../core/userAgent';

const MaxSoundAgeInTicks = constants.TicksPerSecond;

export interface CanvasStack {
	background: HTMLCanvasElement;
	glows: HTMLCanvasElement;
	canvas: HTMLCanvasElement;
	ui: HTMLCanvasElement;
	cursor: HTMLCanvasElement;
}

export interface CanvasCtxStack {
	background: CanvasRenderingContext2D;
	glows: CanvasRenderingContext2D;
	canvas: CanvasRenderingContext2D;
	ui: CanvasRenderingContext2D;
	rtx: boolean;
}

export interface RenderOptions {
	wheelOnRight: boolean;
	mute: boolean;
	keysToSpells: Map<string, string>;
	rebindings: KeyBindings;
	rtx: boolean;
}

interface ButtonInput {
	buttonRenderState: { [btn: string]: w.ButtonRenderState };
}

// Rendering
export function resetRenderState(world: w.World) {
	world.ui.renderedTick = null;
	world.ui.buttonBar = null;
}

export function worldPointFromInterfacePoint(interfacePoint: pl.Vec2, rect: ClientRect) {
	const viewRect = calculateViewRects(rect);
	const worldPoint = worldPointFromViewRect(interfacePoint, viewRect);
	return worldPoint;
}

export function worldPointFromViewRect(interfacePoint: pl.Vec2, viewRect: ClientRect) {
	const worldRect = calculateWorldRect(viewRect);
	const worldPoint = pl.Vec2((interfacePoint.x - worldRect.left) / worldRect.width, (interfacePoint.y - worldRect.top) / worldRect.height);
	return worldPoint;
}

function calculateViewRects(rect: ClientRect): ClientRect {
	return {
		left: 0,
		right: rect.width,
		width: rect.width,
		top: 0,
		bottom: rect.height,
		height: rect.height,
	};
}

function calculateWorldRect(viewRect: ClientRect): ClientRect {
	const size = Math.min(viewRect.width, viewRect.height);

	const width = size;
	const height = size;

	const left = viewRect.left + (viewRect.width - size) / 2.0;
	const top = viewRect.top + (viewRect.height - size) / 2.0;

	const right = left + width;
	const bottom = top + height;

	return { left, top, right, bottom, width, height };
}

export function render(world: w.World, canvasStack: CanvasStack, options: RenderOptions) {
	const rect = canvasStack.canvas.getBoundingClientRect();
	const viewRect = calculateViewRects(rect);
	const worldRect = calculateWorldRect(viewRect);

	// Cursor always gets rerendered
	{
		const cursorCtx = canvasStack.cursor.getContext('2d', { alpha: true });
		renderCursor(cursorCtx, world, rect, worldRect);
	}

	// Everything also always gets rendered (used to wait for changes)
	world.ui.renderedTick = world.tick;

	let ctxStack = {
		background: canvasStack.background.getContext('2d', { alpha: false }),
		glows: canvasStack.glows.getContext('2d', { alpha: true }),
		canvas: canvasStack.canvas.getContext('2d', { alpha: true }),
		ui: canvasStack.ui.getContext('2d', { alpha: true }),
		rtx: options.rtx,
	} as CanvasCtxStack;
	if (!(ctxStack.background && ctxStack.glows && ctxStack.canvas && ctxStack.ui)) {
		throw "Error getting context";
	}

	all(ctxStack, ctx => ctx.save());
	clearCanvas(ctxStack, rect);
	renderWorld(ctxStack, world, worldRect, options);
	renderInterface(ctxStack.ui, world, rect, options);
	all(ctxStack, ctx => ctx.restore());

	playSounds(world, options);

	world.ui.destroyed = [];
	world.ui.events = [];
	world.ui.sounds = [];
}

function playSounds(world: w.World, options: RenderOptions) {
	if (options.mute
		|| world.tick <= world.ui.playedTick // Already played this tick
		|| (world.tick - world.ui.playedTick) > MaxSoundAgeInTicks) { // We've lagged or entered a game late, don't replay all the sounds because it just causes WebAudio to hang

		// Play nothing
	} else {
		const hero = world.objects.get(world.ui.myHeroId);
		const self = hero ? hero.body.getPosition() : pl.Vec2(0.5, 0.5);
		audio.play(self, world.ui.sounds, world.settings.Sounds);
	}

	world.ui.playedTick = world.tick; // Always update this so if user unmutes they don't classified as get sound lag
}

function all(contextStack: CanvasCtxStack, func: (ctx: CanvasRenderingContext2D) => void) {
	func(contextStack.background);
	if (contextStack.rtx) {
		func(contextStack.glows);
	}
	func(contextStack.canvas);
	func(contextStack.ui);
}

function foreground(contextStack: CanvasCtxStack, func: (ctx: CanvasRenderingContext2D) => void) {
	if (contextStack.rtx) {
		func(contextStack.glows);
	}
	func(contextStack.canvas);
}

function clearCanvas(ctxStack: CanvasCtxStack, rect: ClientRect) {
	ctxStack.background.fillStyle = 'black';
	ctxStack.background.fillRect(0, 0, rect.width, rect.height);

	ctxStack.glows.clearRect(0, 0, rect.width, rect.height);
	ctxStack.canvas.clearRect(0, 0, rect.width, rect.height);
}

function renderWorld(ctxStack: CanvasCtxStack, world: w.World, worldRect: ClientRect, options: RenderOptions) {
	all(ctxStack, ctx => ctx.save());
	all(ctxStack, ctx => ctx.translate(worldRect.left, worldRect.top));
	all(ctxStack, ctx => ctx.scale(worldRect.width, worldRect.height));

	renderMap(ctxStack.background, world);

	world.objects.forEach(obj => renderObject(ctxStack, obj, world, options));
	world.ui.destroyed.forEach(obj => renderDestroyed(ctxStack, obj, world));
	world.ui.events.forEach(obj => renderEvent(ctxStack, obj, world));

	let newTrails = new Array<w.Trail>();
	world.ui.trails.forEach(trail => {
		renderTrail(ctxStack, trail, world);

		const expireTick = trail.initialTick + trail.max;
		if (world.tick < expireTick) {
			newTrails.push(trail);
		}
	});
	world.ui.trails = newTrails;

	all(ctxStack, ctx => ctx.restore());
}

function renderCursor(ctx: CanvasRenderingContext2D, world: w.World, rect: ClientRect, worldRect: ClientRect) {
	if (!isMobile) {
		return;
	}

	ctx.clearRect(0, 0, rect.width, rect.height);

	ctx.save();
	ctx.translate(worldRect.left, worldRect.top);
	ctx.scale(worldRect.width, worldRect.height);

	renderTarget(ctx, world.ui.nextTarget, world);

	ctx.restore();
}

function renderTarget(ctx: CanvasRenderingContext2D, target: pl.Vec2, world: w.World) {
	const CrossHairSize = world.settings.Hero.Radius;
	if (!target) {
		return;
	}

	ctx.save();
	ctx.translate(target.x, target.y);

	ctx.strokeStyle = "white";
	ctx.lineWidth = Pixel * 3;

	ctx.beginPath();
	ctx.moveTo(0, -CrossHairSize);
	ctx.lineTo(0, CrossHairSize);
	ctx.moveTo(-CrossHairSize, 0);
	ctx.lineTo(CrossHairSize, 0);
	ctx.stroke();

	ctx.restore();
}

function renderObject(ctxStack: CanvasCtxStack, obj: w.WorldObject, world: w.World, options: RenderOptions) {
	if (obj.category === "hero") {
		renderHero(ctxStack, obj, world);
		if (obj.gravity) {
			renderGravityWell(ctxStack, obj, world);
		}
		if (obj.link) {
			const target = world.objects.get(obj.link.targetId);
			if (target) {
				renderLinkBetween(ctxStack, obj, target, world.settings.Render.link);
			}
		}
	} else if (obj.category === "shield") {
		renderShield(ctxStack, obj, world);
		playShieldSounds(obj, world);
	} else if (obj.category === "projectile") {
		renderSpell(ctxStack, obj, world);
		playSpellSounds(obj, world);
	} else if (obj.category === "obstacle") {
		renderObstacle(ctxStack, obj, world, options);
	}
}

function renderDestroyed(ctxStack: CanvasCtxStack, obj: w.WorldObject, world: w.World) {
	if (obj.category === "hero") {
		renderHeroDeath(ctxStack, obj, world);
	} else if (obj.category === "projectile") {
		renderSpell(ctxStack, obj, world);
		playSpellSounds(obj, world);
	} else if (obj.category === "obstacle") {
		renderObstacleDestroyed(ctxStack, obj, world);
	}
}

function renderHeroDeath(ctxStack: CanvasCtxStack, hero: w.Hero, world: w.World) {
	const ticks = 15;
	const pos = vector.clone(hero.body.getPosition());
	world.ui.trails.push({
		type: "circle",
		max: ticks,
		initialTick: world.tick,
		pos,
		fillStyle: 'white',
		radius: world.settings.Hero.Radius * 1.5,
	});

	world.ui.sounds.push({
		id: `${hero.id}-death`,
		sound: 'death',
		pos,
	});
}

function renderObstacleDestroyed(ctxStack: CanvasCtxStack, obstacle: w.Obstacle, world: w.World) {
	const ticks = 15;
	world.ui.trails.push({
		type: "circle",
		max: ticks,
		initialTick: world.tick,
		pos: obstacle.body.getPosition(),
		fillStyle: 'white',
		radius: obstacle.extent,
	});
}

function renderSpell(ctxStack: CanvasCtxStack, obj: w.Projectile, world: w.World) {
	obj.uiPath.push(vector.clone(obj.body.getPosition()));

	obj.renderers.forEach(render => {
		if (render.type === "projectile") {
			renderProjectile(ctxStack, obj, world, render);
		} else if (render.type == "ray") {
			renderRay(ctxStack, obj, world, render);
		} else if (render.type === "link") {
			renderLink(ctxStack, obj, world, render);
		} else if (render.type === "swirl") {
			renderGravity(ctxStack, obj, world, render);
		} else if (render.type === "reticule") {
			renderReticule(ctxStack, obj, world, render);
		}
	});

	while (obj.uiPath.length > 1) {
		obj.uiPath.shift();
	}
}

function playSpellSounds(obj: w.Projectile, world: w.World) {
	if (obj.sound) {
		world.ui.sounds.push({
			id: obj.id,
			sound: obj.sound,
			pos: vector.clone(obj.body.getPosition()),
		});
	}

	const hitSound = obj.soundHit || obj.sound;
	if (hitSound && obj.hit) {
		world.ui.sounds.push({
			id: `${obj.id}-hit-${obj.hit}`, // Each hit has a unique ID
			sound: `${hitSound}-hit`,
			pos: vector.clone(obj.body.getPosition()),
		});
	}
}

function renderLifeStealReturn(ctxStack: CanvasCtxStack, ev: w.LifeStealEvent, world: w.World) {
	let owner = world.objects.get(ev.owner);
	if (!owner) {
		return;
	}

	const pos = owner.body.getPosition();

	world.ui.trails.push({
		type: 'circle',
		initialTick: world.tick,
		max: 0.25 * constants.TicksPerSecond,
		pos: vector.clone(pos),
		fillStyle: HeroColors.HealColor,
		radius: world.settings.Hero.Radius * 1.5,
	} as w.CircleTrail);
}

function renderEvent(ctxStack: CanvasCtxStack, ev: w.WorldEvent, world: w.World) {
	if (ev.type === "detonate") {
		renderDetonate(ctxStack, ev, world);
	} else if (ev.type === "lifeSteal") {
		renderLifeStealReturn(ctxStack, ev, world);
	} else if (ev.type === "teleport") {
		renderTeleport(ctxStack, ev, world);
	} else {
		return;
	}
}

function renderDetonate(ctxStack: CanvasCtxStack, ev: w.DetonateEvent, world: w.World) {
	world.ui.trails.push({
		type: "circle",
		max: ev.explosionTicks,
		initialTick: world.tick,
		pos: ev.pos,
		fillStyle: 'white',
		radius: ev.radius,
	});

	if (ev.sound) {
		world.ui.sounds.push({
			id: `${ev.sourceId}-detonating`,
			sound: `${ev.sound}-detonating`,
			pos: ev.pos,
		});
	}
}

function renderTeleport(ctxStack: CanvasCtxStack, ev: w.TeleportEvent, world: w.World) {
	const Hero = world.settings.Hero;
	if (ev.heroId === world.ui.myHeroId) {
		world.ui.trails.push({
			type: "ripple",
			max: 15,
			initialTick: world.tick,
			pos: ev.toPos,
			fillStyle: 'white',
			initialRadius: Hero.Radius,
			finalRadius: Hero.Radius * 4,
		});
	}

	if (ev.sound) {
		world.ui.sounds.push({
			id: `${ev.heroId}-teleport-arriving`,
			sound: `${ev.sound}-arriving`,
			pos: ev.toPos,
		});
	}
}

function renderMap(ctx: CanvasRenderingContext2D, world: w.World) {
	ctx.save();

	ctx.translate(0.5, 0.5);

	ctx.lineWidth = Pixel * 5;
	ctx.strokeStyle = HeroColors.WorldColor;
	if (world.winner) {
		const color = heroColor(world.winner, world);
		ctx.fillStyle = color;
		ctx.globalAlpha = 0.5;
	} else {
		ctx.fillStyle = HeroColors.WorldColor;
	}

	let radius = world.radius;
	if (isEdge) {
		// Edge has a weird oscillation of Y-axis scaling for certain fractions of radius.
		// Force it to draw perfect circles by snapping to a minimum precision.
		radius = Math.floor(world.radius / Pixel) * Pixel;
	}
	ctx.beginPath();
	ctx.arc(0, 0, radius, 0, 2 * Math.PI);

	ctx.fill();

	ctx.restore();
}

function renderObstacle(ctxStack: CanvasCtxStack, obstacle: w.Obstacle, world: w.World, options: RenderOptions) {
	if (obstacle.destroyed) {
		return;
	}

	const body = obstacle.body;
	const pos = body.getPosition();

	const proportion = obstacle.health / obstacle.maxHealth;

	foreground(ctxStack, ctx => {
		ctx.save();
		
		ctx.translate(pos.x, pos.y);
		ctx.rotate(body.getAngle());

		if (world.tick - obstacle.createTick < obstacle.growthTicks) {
			const growthProportion = (world.tick - obstacle.createTick) / obstacle.growthTicks;
			ctx.scale(growthProportion, growthProportion);
		}

		ctx.lineWidth = Pixel * 3;

		const red = 0;
		const saturation = 1.0 - proportion;
		ctx.strokeStyle = 'white'; // hsl(red, saturation, (0.5 + 0.5 * proportion));

		if (ctx === ctxStack.canvas) {
			const hitAge = obstacle.damagedTick ? world.tick - obstacle.damagedTick : Infinity;

			let lighten = 0;
			if (hitAge < HeroColors.ObstacleFlashTicks) {
				lighten = HeroColors.ObstacleGlowFactor * (1 - hitAge / HeroColors.ObstacleFlashTicks);
			}

			if (options.rtx) {
				const gradient = ctx.createLinearGradient(-obstacle.extent, -obstacle.extent, obstacle.extent, obstacle.extent);
				gradient.addColorStop(0, hsl(red, saturation, lighten + (1 - lighten) * 0.5));
				gradient.addColorStop(1, hsl(red, saturation, lighten + (1 - lighten) * 0.4));
				ctx.fillStyle = gradient;
			} else {
				ctx.fillStyle = hsl(red, saturation, lighten + (1 - lighten) * 0.5);
			}
		} else {
			ctx.fillStyle = 'white';
		}
		ctx.beginPath();

		const points = obstacle.points;
		for (let i = 0; i < points.length; ++i) {
			const point = points[i % points.length];
			if (i === 0) {
				ctx.moveTo(point.x, point.y);
			}
			ctx.lineTo(point.x, point.y);
		}

		ctx.closePath();
		ctx.fill();

		if (ctx === ctxStack.canvas) {
			ctx.stroke();
		}

		ctx.restore();
	});
}

function renderHero(ctxStack: CanvasCtxStack, hero: w.Hero, world: w.World) {
	const Hero = world.settings.Hero;
	const ctx = ctxStack.canvas;

	if (hero.destroyed) {
		return;
	}

	const pos = hero.body.getPosition();
	const radius = Hero.Radius;

	foreground(ctxStack, ctx => ctx.save());
	foreground(ctxStack, ctx => ctx.translate(pos.x, pos.y));

	renderRangeIndicator(ctxStack, hero, world);
	renderHeroCharacter(ctxStack, hero, world);
	renderHeroBars(ctxStack, hero, world);

	foreground(ctxStack, ctx => ctx.restore());

	playHeroSounds(hero, world);
}

function renderHeroCharacter(ctxStack: CanvasCtxStack, hero: w.Hero, world: w.World) {
	const Hero = world.settings.Hero;
	const ctx = ctxStack.canvas;

	const player = world.players.get(hero.id);
	let color = heroColor(hero.id, world);
	if (!(world.activePlayers.has(hero.id) || (player && player.isSharedBot))) {
		color = HeroColors.InactiveColor;
	}

	const angle = hero.body.getAngle();
	const radius = Hero.Radius;

	// Fill
	{
		ctx.save();

		const damageAge = hero.damagedTick ? world.tick - hero.damagedTick : Infinity;
		const lavaAge = hero.lavaTick ? world.tick - (Math.floor(hero.lavaTick / HeroColors.LavaFlashInterval) * HeroColors.LavaFlashInterval) : Infinity;
		const hitAge = Math.min(lavaAge, damageAge);

		let fillColor = color;
		if (hitAge < HeroColors.DamageFlashTicks) {
			fillColor = Color(fillColor).lighten(HeroColors.DamageGlowFactor * (1 - hitAge / HeroColors.DamageFlashTicks)).string();
		}
		ctx.fillStyle = fillColor;
		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, 2 * Math.PI);
		ctx.fill();

		ctx.restore();
	}

	// Orientation
	{
		ctx.save();

		ctx.beginPath();
		ctx.arc(0, 0, radius, 0, 2 * Math.PI);
		ctx.clip();

		ctx.rotate(angle);
		ctx.scale(radius, radius);

		ctx.fillStyle = "white";
		ctx.strokeStyle = "black";
		ctx.lineWidth = Pixel;

		ctx.globalAlpha = 0.5;

		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(-1, 1);
		ctx.lineTo(0, 1);
		ctx.lineTo(0.5, 0);
		ctx.lineTo(0, -1);
		ctx.lineTo(-1, -1);
		ctx.closePath();
		ctx.fill();
		ctx.stroke();

		ctx.restore();
	}

	// Charging
	if (hero.casting && hero.casting.color && hero.casting.proportion > 0) {
		ctx.save();

		ctx.globalAlpha = hero.casting.proportion;
		ctx.strokeStyle = hero.casting.color;
		ctx.lineWidth = ChargingIndicator.Width;
		ctx.beginPath();
		ctx.arc(0, 0, radius + ChargingIndicator.Margin, 0, 2 * Math.PI);
		ctx.stroke();

		ctx.restore();
	}
}

function playHeroSounds(hero: w.Hero, world: w.World) {
	// Casting sounds
	if (hero.casting) {
		const spell = world.settings.Spells[hero.casting.action.type];
		if (spell && spell.sound) {
			let stage: string = null;
			if (hero.casting.stage === w.CastStage.Charging) {
				stage = "charging";
			} else if (hero.casting.stage === w.CastStage.Channelling) {
				stage = "channelling";
			}

			if (stage) {
				// Make the sound happen in the correct direction
				const pos = vector.plus(
					hero.body.getPosition(),
					vector.multiply(vector.fromAngle(hero.body.getAngle()), hero.radius));
				const key = `${spell.sound}-${stage}`;
				world.ui.sounds.push({
					id: `${hero.id}-${key}`,
					sound: key,
					pos,
				});
			}
		}
	}
}

function renderRangeIndicator(ctxStack: CanvasCtxStack, hero: w.Hero, world: w.World) {
	if (!(hero.id === world.ui.myHeroId && world.ui.hoverSpellId && !isMobile)) {
		return;
	}

	const ctx = ctxStack.canvas;

	let range = null;

	const spell = world.settings.Spells[world.ui.hoverSpellId];
	if (spell.action === "projectile" || spell.action === "spray") {
		range = spell.projectile.speed * spell.projectile.maxTicks / constants.TicksPerSecond;
	} else if (spell.action === "teleport" || spell.action === "thrust") {
		range = spell.range;
	} else if (spell.action === "scourge") {
		range = spell.detonate.radius;
	} else if(spell.action === "shield") {
		range = spell.radius;
	} else if (spell.action === "wall") {
		range = spell.maxRange;
	}

	if (range > 0.5) {
		range = 0.5;
	}

	if (range) {
		ctx.save();

		ctx.globalAlpha = 0.25;
		ctx.strokeStyle = spell.color;
		ctx.lineWidth = HeroColors.RangeIndicatorWidth;
		ctx.setLineDash([ Pixel * 5, Pixel * 5 ]);
		ctx.beginPath();
		ctx.arc(0, 0, range, 0, 2 * Math.PI);
		ctx.stroke();
		ctx.restore();
	}
}

function renderHeroBars(ctxStack: CanvasCtxStack, hero: w.Hero, world: w.World) {
	const Hero = world.settings.Hero;
	const ctx = ctxStack.canvas;

	const radius = Hero.Radius;

	// Health bar
	const ticksUntilStart = Math.max(0, world.startTick - world.tick);
	if (!(ticksUntilStart <= constants.Matchmaking.JoinPeriod || hero.health < Hero.MaxHealth)) {
		return;
	}

	// Health
	{
		const healthProportion = hero.health / Hero.MaxHealth;
		const startProportion = Math.min(healthProportion, ticksUntilStart / constants.Matchmaking.JoinPeriod);

		let color = Color(rgColor(healthProportion));
		if (startProportion > 0) {
			color = color.lighten(0.75 + 0.25 * startProportion);
		}

		ctx.save();

		ctx.lineWidth = Pixel * 2;
		ctx.strokeStyle = '#111';
		ctx.fillStyle = '#111';
		ctx.beginPath();
		healthBarPath(ctx, radius, 1.0, world);
		ctx.fill();

		ctx.fillStyle = color.string();
		ctx.beginPath();
		healthBarPath(ctx, radius, healthProportion, world);
		ctx.fill();

		ctx.restore();
	}
}

function renderShield(ctxStack: CanvasCtxStack, shield: w.Shield, world: w.World) {
	const MaxAlpha = 0.75;
	const MinAlpha = 0.10;

	const ticksRemaining = shield.expireTick - world.tick;
	const maxTicks = shield.expireTick - shield.createTick;
	const proportion = 1.0 * ticksRemaining / maxTicks;

	let color = (shield.selfColor && shield.owner === world.ui.myHeroId) ? HeroColors.MyHeroColor : shield.color;
	if (shield.hitTick >= 0) {
		const hitAge = world.tick - shield.hitTick;
		if (hitAge < HeroColors.ShieldFlashTicks) {
			color = Color(color).lighten(HeroColors.ShieldGlowFactor * (1 - hitAge / HeroColors.ShieldFlashTicks)).string();
		}
	}

	foreground(ctxStack, ctx => ctx.save());

	let pos: pl.Vec2;
	let angle: number;
	if (shield.type === "reflect") {
		const hero = world.objects.get(shield.owner);
		if (!hero) {
			return;
		}
		pos = hero.body.getPosition();
		angle = hero.body.getAngle();
	} else if (shield.type === "wall") {
		pos = shield.body.getPosition();
		angle = shield.body.getAngle();
	} else if (shield.type === "saber") {
		const hero = world.objects.get(shield.owner);
		if (!hero) {
			return;
		}
		pos = hero.body.getPosition();
		angle = shield.body.getAngle();
	} else {
		return;
	}
	foreground(ctxStack, ctx => ctx.translate(pos.x, pos.y));

	foreground(ctxStack, ctx => {
		if (world.tick - shield.createTick < shield.growthTicks) {
			const growthProportion = (world.tick - shield.createTick) / shield.growthTicks;
			ctx.scale(growthProportion, growthProportion);
		}
	});

	if (shield.type === "saber") {
		// Do this before we apply the angle transformation because it's easier
		renderSaberTrail(ctxStack, shield, world);
	}

	foreground(ctxStack, ctx => ctx.rotate(angle));

	foreground(ctxStack, ctx => {
		ctx.globalAlpha = (MaxAlpha - MinAlpha) * proportion + MinAlpha;
		ctx.fillStyle = color;
		ctx.lineWidth = Pixel * 3;

		ctx.beginPath();
		if (shield.type === "reflect") {
			ctx.arc(0, 0, shield.radius, 0, 2 * Math.PI);
		} else {
			ctx.beginPath();

			const points = shield.points;
			for (let i = 0; i < points.length; ++i) {
				const point = points[i % points.length];
				if (i === 0) {
					ctx.moveTo(point.x, point.y);
				}
				ctx.lineTo(point.x, point.y);
			}

			ctx.closePath();
			ctx.fill();
		}
		ctx.fill();
	});

	foreground(ctxStack, ctx => ctx.restore());
}

function renderSaberTrail(ctxStack: CanvasCtxStack, saber: w.Saber, world: w.World) {
	const previousAngle = saber.uiPreviousAngle || saber.body.getAngle();
	const newAngle = saber.body.getAngle();

	const previousTip = vector.multiply(vector.fromAngle(previousAngle), saber.length);
	const antiClockwise = vector.angleDelta(previousAngle, newAngle) < 0;

	world.ui.trails.push({
		type: "arc",
		initialTick: world.tick,
		max: saber.trailTicks,
		pos: saber.body.getPosition(),
		minRadius: world.settings.Hero.Radius,
		maxRadius: saber.length,
		fromAngle: previousAngle,
		toAngle: newAngle,
		antiClockwise,
		fillStyle: saber.color,
	});

	saber.uiPreviousAngle = newAngle;
}

function playShieldSounds(obj: w.Shield, world: w.World) {
	if (obj.sound) {
		world.ui.sounds.push({
			id: obj.id,
			sound: obj.sound,
			pos: vector.clone(obj.body.getPosition()),
		});

		if (obj.hitTick) {
			world.ui.sounds.push({
				id: `${obj.id}-hit-${obj.hitTick}`, // Each hit has a unique ID
				sound: `${obj.sound}-hit`,
				pos: vector.clone(obj.body.getPosition()),
			});
		}
	}
}

function heroColor(heroId: string, world: w.World) {
	const player = world.players.get(heroId);
	if (heroId === world.ui.myHeroId) {
		return HeroColors.MyHeroColor;
	} else {
		return player.uiColor;
	}
}

function healthBarPath(ctx: CanvasRenderingContext2D, radius: number, proportion: number, world: w.World) {
	barPath(ctx, radius, proportion, HealthBar.Margin, HealthBar.Height, world);
}

function dashBarPath(ctx: CanvasRenderingContext2D, radius: number, proportion: number, world: w.World) {
	barPath(ctx, radius, proportion, DashIndicator.Margin, DashIndicator.Height, world);
}

function barPath(ctx: CanvasRenderingContext2D, radius: number, proportion: number, margin: number, height: number, world: w.World) {
	const barRadius = HealthBar.HeroRadiusFraction * world.settings.Hero.Radius;
	ctx.rect(-barRadius, -radius - height - margin, barRadius * 2 * proportion, height);
}

function rgColor(proportion: number) {
	let hue = proportion * 120.0;
	return hsl(hue, 1.0, 0.5);
}

function renderGravity(ctxStack: CanvasCtxStack, projectile: w.Projectile, world: w.World, swirl: RenderSwirl) {
	const color = projectileColor(swirl, projectile, world);
	renderGravityAt(ctxStack, projectile.body.getPosition(), world, swirl, color);
}

function renderGravityWell(ctxStack: CanvasCtxStack, hero: w.Hero, world: w.World) {
	if (!hero.gravity) {
		return;
	}

	const spell = world.settings.Spells[hero.gravity.spellId] as ProjectileSpell;
	const swirl = world.settings.Render.gravity;
	renderGravityAt(ctxStack, hero.gravity.location, world, swirl);

	if (spell.sound) {
		world.ui.sounds.push({
			id: `${hero.id}-trapped`,
			sound: `${spell.sound}-trapped`,
			pos: hero.gravity.location,
		});
	}
}

function renderGravityAt(ctxStack: CanvasCtxStack, location: pl.Vec2, world: w.World, swirl: RenderSwirl, color?: string) {
	const animationLength = swirl.loopTicks;
	const numParticles = swirl.numParticles;

	const angleOffset = (2 * Math.PI) * (world.tick % animationLength) / animationLength;
	for (let i = 0; i < numParticles; ++i) {
		const angle = angleOffset + (2 * Math.PI) * i / numParticles;
		world.ui.trails.push({
			type: "circle",
			pos: vector.plus(location, vector.multiply(vector.fromAngle(angle), swirl.radius)),
			radius: swirl.particleRadius,
			initialTick: world.tick,
			max: swirl.ticks, 
			fillStyle: color || swirl.color,
		});
	}
}

function renderReticule(ctxStack: CanvasCtxStack, projectile: w.Projectile, world: w.World, reticule: RenderReticule) {
	// After reached cursor
	const remainingTicks = Math.max(0, projectile.expireTick - world.tick);
	const proportion = remainingTicks / reticule.ticks;
	if (proportion > 1) {
		return;
	}

	const pos = projectile.body.getPosition();

	const animationLength = 11;
	const numSegments = 5;
	const arcFraction = 0.5;

	const angleOffset = ((world.tick % animationLength) / animationLength) * 2 * Math.PI;
	const arcAngle = arcFraction * 2 * Math.PI / numSegments;

	foreground(ctxStack, ctx => {
		ctx.save();

		ctx.strokeStyle = reticule.color;
		ctx.lineWidth = 3 * Pixel;

		const perSegment = 2 * Math.PI / numSegments;
		for (let i = 0; i < numSegments; ++i) {
			const startAngle = angleOffset + i * perSegment;
			const endAngle = startAngle + arcAngle;
			ctx.beginPath();
			ctx.arc(pos.x, pos.y, reticule.radius * proportion, startAngle, endAngle);
			ctx.stroke();
		}

		ctx.restore();
	});
}

function renderLink(ctxStack: CanvasCtxStack, projectile: w.Projectile, world: w.World, render: RenderLink) {
	let owner: w.WorldObject = world.objects.get(projectile.owner);
	if (owner && owner.category == "hero") {
		renderLinkBetween(ctxStack, owner, projectile, render);
	}
}

function renderLinkBetween(ctxStack: CanvasCtxStack, owner: w.Hero, target: w.WorldObject, render: RenderLink) {
	foreground(ctxStack, ctx => {
		ctx.lineWidth = render.width;
		ctx.strokeStyle = render.color;

		const from = owner.body.getPosition();
		const to = target.body.getPosition();
		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(to.x, to.y);
		ctx.stroke();
	});
}

function renderRay(ctxStack: CanvasCtxStack, projectile: w.Projectile, world: w.World, render: RenderRay) {
	let previous: pl.Vec2 = null;

	const multiplier = engine.calculatePartialDamageMultiplier(world, projectile);
	for (let pos of getRenderPoints(projectile.uiPath, render.intermediatePoints)) {
		if (previous) {
			world.ui.trails.push({
				type: 'line',
				initialTick: world.tick,
				max: render.ticks, 
				from: previous,
				to: pos,
				fillStyle: projectileColor(render, projectile, world),
				width: multiplier * projectile.radius * 2,
			} as w.LineTrail);
		}

		previous = pos;
	}
}

function getRenderPoints(path: pl.Vec2[], intermediatePoints: boolean) {
	if (intermediatePoints) {
		return path;
	} else {
		if (path.length <= 2) {
			return path;
		} else {
			return [path[0], path[path.length - 1]];
		}
	}
}

function renderProjectile(ctxStack: CanvasCtxStack, projectile: w.Projectile, world: w.World, render: RenderProjectile) {
	const multiplier = engine.calculatePartialDamageMultiplier(world, projectile);
	world.ui.trails.push({
		type: 'circle',
		initialTick: world.tick,
		max: render.ticks,
		pos: vector.clone(projectile.body.getPosition()),
		fillStyle: projectileColor(render, projectile, world),
		radius: multiplier * projectile.radius,
	} as w.CircleTrail);
}

function projectileColor(render: ProjectileColorParams, projectile: w.Projectile, world: w.World) {
	if (render.selfColor && projectile.owner === world.ui.myHeroId) {
		return HeroColors.MyHeroColor;
	} else {
		return render.color;
	}
}

function renderTrail(ctxStack: CanvasCtxStack, trail: w.Trail, world: w.World) {
	const expireTick = trail.initialTick + trail.max;
	const remaining = expireTick - world.tick;
	if (remaining <= 0) {
		return true;
	}

	const proportion = 1.0 * remaining / trail.max;

	foreground(ctxStack, ctx => {
		ctx.save(); 

		if (ctx === ctxStack.glows) {
			ctx.globalAlpha = proportion;
		}
		ctx.fillStyle = trail.fillStyle;
		ctx.strokeStyle = trail.fillStyle;

		if (trail.type === "circle") {
			ctx.beginPath();
			ctx.arc(trail.pos.x, trail.pos.y, proportion * trail.radius, 0, 2 * Math.PI);
			ctx.fill();
		} else if (trail.type === "ripple") {
			const radius = proportion * trail.initialRadius + (1 - proportion) * trail.finalRadius;
			ctx.globalAlpha = proportion;
			ctx.lineWidth = proportion * trail.initialRadius / 2;
			ctx.beginPath();
			ctx.arc(trail.pos.x, trail.pos.y, radius, 0, 2 * Math.PI);
			ctx.stroke();
		} else if (trail.type === "arc") {
			ctx.globalAlpha = proportion;

			ctx.beginPath();
			ctx.arc(trail.pos.x, trail.pos.y, trail.maxRadius, trail.fromAngle, trail.toAngle, trail.antiClockwise);
			ctx.arc(trail.pos.x, trail.pos.y, trail.minRadius, trail.toAngle, trail.fromAngle, !trail.antiClockwise);
			ctx.closePath();
			ctx.fill();

		} else if (trail.type === "line") {
			if (isEdge) {
				// Edge doesn't render lines if they are shorter than the line width, so render them ourselves.
				const axis = vector.diff(trail.to, trail.from);
				const cross = vector.relengthen(vector.rotateRight(axis), proportion * trail.width / 2);

				ctx.beginPath();
				ctx.moveTo(trail.from.x + cross.x, trail.from.y + cross.y);
				ctx.lineTo(trail.to.x + cross.x, trail.to.y + cross.y);
				ctx.lineTo(trail.to.x - cross.x, trail.to.y - cross.y);
				ctx.lineTo(trail.from.x - cross.x, trail.from.y - cross.y);
				ctx.closePath();
				ctx.fill();
			} else {
				ctx.lineWidth = proportion * trail.width;
				ctx.beginPath();
				ctx.moveTo(trail.from.x, trail.from.y);
				ctx.lineTo(trail.to.x, trail.to.y);
				ctx.stroke();
			}
		}

		ctx.restore();
	});

	return false;
}

function renderInterface(ctx: CanvasRenderingContext2D, world: w.World, rect: ClientRect, options: RenderOptions) {
	const myHero = world.objects.get(world.ui.myHeroId) as w.Hero;
	renderButtons(ctx, rect, world, myHero, options);
}

export function whichKeyClicked(pos: pl.Vec2, config: w.ButtonConfig): string {
	if (!config) {
		// Buttons not drawn yet
		return null;
	}

	const region = config.region;
	if (!(region.left <= pos.x && pos.x < region.right && region.top <= pos.y && pos.y < region.bottom)) {
		return null;
	}

	let key: string = null;
	if (config.view === "bar") {
		const offset = pl.Vec2((pos.x - region.left) / config.scaleFactor, (pos.y - region.top) / config.scaleFactor);
		config.hitBoxes.forEach((hitBox, candidateKey) => {
			if (hitBox.left <= offset.x && offset.x < hitBox.right && hitBox.top <= offset.y && offset.y < hitBox.bottom) {
				key = candidateKey;
			}
		});
	} else if (config.view === "wheel") {
		const offset = pl.Vec2(pos.x - config.center.x, pos.y - config.center.y);
		const radius = vector.length(offset);

		if (config.innerRadius <= radius && radius < config.outerRadius) {
			const angle = vector.angle(offset);
			config.hitSectors.forEach((hitSector, candidateKey) => {
				const arcWidth = hitSector.endAngle - hitSector.startAngle;
				const delta = vector.angleDelta(hitSector.startAngle, angle);
				if (0 <= delta && delta < arcWidth) {
					key = candidateKey;
				}
			});
		} else if (radius <= config.innerRadius) {
			config.hitSectors.forEach((hitSector, candidateKey) => {
				if (!(hitSector.startAngle && hitSector.endAngle)) {
					key = candidateKey;
				}
			});
			if (!key) {
				key = w.SpecialKeys.WheelCenter;
			}
		}
	}

	return key;
}

export function touchControls(config: w.ButtonConfig): boolean {
	if (!config) {
		// Buttons not drawn yet
		return false;
	}

	if (config.view === "wheel") {
		return true;
	} else {
		return false;
	}
}

function renderButtons(ctx: CanvasRenderingContext2D, rect: ClientRect, world: w.World, hero: w.Hero, options: RenderOptions) {
	let buttonStateLookup: Map<string, w.ButtonRenderState> = null;
	if (hero) {
		buttonStateLookup = calculateButtonStatesFromHero(world, hero, options);
	} else if (world.ui.myHeroId) {
		// Dead - display buttons so user can continue customising
		buttonStateLookup = calculateButtonStatesFromKeyBindings(world, options.keysToSpells);
	} else {
		buttonStateLookup = null;
	}

	if (buttonStateLookup) {
		if (!world.ui.buttonBar) {
			world.ui.buttonBar = calculateButtonLayout(world.settings.Choices.Keys, rect, options);
		}

		const config = world.ui.buttonBar;
		const iconLookup = world.settings.Icons;
		if (config.view === "bar") {
			renderButtonBar(ctx, config, buttonStateLookup, iconLookup);
		} else if (config.view === "wheel") {
			renderButtonWheel(ctx, config, buttonStateLookup, iconLookup);
		}
	} else {
		ctx.clearRect(0, 0, rect.width, rect.height);
	}
}

function calculateButtonStatesFromHero(world: w.World, hero: w.Hero, options: RenderOptions) {
	const selectedAction = hero && hero.casting && hero.casting.action && hero.casting.action.type;
	const keys = world.settings.Choices.Keys;
	const buttonStateLookup = new Map<string, w.ButtonRenderState>();
	for (let i = 0; i < keys.length; ++i) {
		const key = keys[i];
		if (!key) {
			continue;
		}

		const btnState = calculateButtonState(key.btn, hero, selectedAction, world, options.rebindings);
		buttonStateLookup.set(key.btn, btnState);
	}
	return buttonStateLookup;
}

function calculateButtonStatesFromKeyBindings(world: w.World, keysToSpells: Map<string, string>) {
	const keys = world.settings.Choices.Keys;
	const hoverSpellId = world.ui.hoverSpellId;

	const buttonStateLookup = new Map<string, w.ButtonRenderState>();
	for (let i = 0; i < keys.length; ++i) {
		const key = keys[i];
		if (!key) { continue; }

		const spellId = keysToSpells.get(key.btn);
		if (!spellId) { continue }

		const spell = world.settings.Spells[spellId];
		if (!spell) { continue }

		const btnState: w.ButtonRenderState = {
			key: null,
			color: spell.id === hoverSpellId ? "#555555" : "#444444",
			icon: spell.icon,
			cooldownText: null,
		};
		buttonStateLookup.set(key.btn, btnState);
	}
	return buttonStateLookup;
}

function calculateButtonLayout(keys: KeyConfig[], rect: ClientRect, options: RenderOptions): w.ButtonConfig {
	if (isMobile) {
		return calculateButtonWheelLayout(keys, rect, options);
	} else {
		return calculateButtonBarLayout(keys, rect);
	}
}

function renderButtonBar(ctx: CanvasRenderingContext2D, config: w.ButtonBarConfig, states: Map<string, w.ButtonRenderState>, icons: IconLookup) {
	ctx.save();
	ctx.translate(config.region.left, config.region.top);
	ctx.scale(config.scaleFactor, config.scaleFactor);

	for (let i = 0; i < config.keys.length; ++i) {
		const key = config.keys[i];
		if (!key) {
			continue;
		}

		const newState = states.get(key.btn);
		const currentState = config.buttons.get(key.btn);

		if (buttonStateChanged(currentState, newState)) {
			const buttonRegion = config.hitBoxes.get(key.btn);
			if (buttonRegion) {
				config.buttons.set(key.btn, newState);

				ctx.save();
				ctx.translate(buttonRegion.left, buttonRegion.top);
				renderBarButton(ctx, buttonRegion, newState, icons);
				ctx.restore();
			}
		}
	}
	ctx.restore();
}

function renderButtonWheel(ctx: CanvasRenderingContext2D, config: w.ButtonWheelConfig, states: Map<string, w.ButtonRenderState>, iconLookup: IconLookup) {
	ctx.save();
	ctx.translate(config.center.x, config.center.y);

	for (const key of config.hitSectors.keys()) {
		if (!key) {
			continue;
		}

		const newState = states.get(key);
		const currentState = config.buttons.get(key);

		if (buttonStateChanged(currentState, newState)) {
			const buttonSector = config.hitSectors.get(key);
			if (buttonSector) {
				config.buttons.set(key, newState);

				ctx.save();
				renderWheelButton(ctx, buttonSector, config.innerRadius, config.outerRadius, newState, iconLookup);
				ctx.restore();
			}
		}
	}
	ctx.restore();
}

function calculateButtonBarLayout(keys: KeyConfig[], rect: ClientRect): w.ButtonBarConfig {
	const hitBoxes = new Map<string, ClientRect>();
	let nextOffset = 0;
	keys.forEach(key => {
		if (nextOffset > 0) {
			nextOffset += ButtonBar.Spacing;
		}

		if (key) {
			const offset = nextOffset;
			const size = ButtonBar.Size * (key.weight || 1);

			const left = offset;
			const top = ButtonBar.Size - size;
			const width = size;
			const height = size;
			const right = left + width;
			const bottom = top + height;
			hitBoxes.set(key.btn, { left, top, right, bottom, width, height });

			nextOffset += size;
		} else {
			nextOffset += ButtonBar.Gap;
		}
	});

	const scaleFactor = Math.min(
		calculateButtonScaleFactor(rect.width, nextOffset),
		calculateButtonScaleFactor(rect.height * ButtonBar.MaxHeightProportion, ButtonBar.Size)
	);
	const region = calculateButtonBarRegion(rect, nextOffset, scaleFactor);

	return {
		view: "bar",
		keys,
		hitBoxes,
		region,
		scaleFactor,
		buttons: new Map<string, w.ButtonRenderState>(),
	};
}

function calculateButtonScaleFactor(available: number, actual: number): number {
	if (available <= 0) {
		return 1.0; // Stop division by zero errors
	} else if (actual <= available) {
		return 1.0;
	} else {
		return available / actual;
	}
}

function calculateButtonBarRegion(rect: ClientRect, totalSize: number, scaleFactor: number): ClientRect {
	const axisSize = totalSize * scaleFactor;
	const crossSize = ButtonBar.Size * scaleFactor;

	const height = crossSize;
	const width = axisSize;

	const left = rect.width / 2.0 - width / 2.0;
	const top = rect.height - crossSize - ButtonBar.Margin;

	const right = left + width;
	const bottom = top + height;
	return { left, top, right, bottom, width, height };
}

function calculateButtonWheelLayout(keys: KeyConfig[], rect: ClientRect, options: RenderOptions): w.ButtonWheelConfig {
	const WheelAngleOffset = Math.PI / 2;

	const hitSectors = new Map<string, w.HitSector>();

	const arcWidth = 2 * Math.PI / keys.filter(k => !!k).length;
	let nextAngle = WheelAngleOffset + arcWidth / 2;
	keys.forEach(key => {
		if (key) {
			const startAngle = nextAngle;
			const endAngle = startAngle + arcWidth;

			let hitSector = { startAngle, endAngle, weight: key.weight || 1.0 };
			if (options.wheelOnRight) {
				hitSector = invertSector(hitSector);
			}

			hitSectors.set(key.btn, hitSector);

			nextAngle += arcWidth;
		}
	});
	// hitSectors.set(w.SpecialKeys.RightClick, { startAngle: null, endAngle: null });

	const region = calculateButtonWheelRegion(rect, options);
	const outerRadius = Math.min(region.width, region.height) / 2.0;
	const innerRadius = outerRadius / 2;
	const center = pl.Vec2((region.left + region.right) / 2, (region.top + region.bottom) / 2);

	const targetSurfaceCenter = pl.Vec2(rect.right - (center.x - rect.left), center.y); // Mirror the wheel on the right

	return {
		view: "wheel",
		hitSectors,
		region,
		center,
		outerRadius,
		innerRadius,
		targetSurfaceCenter,
		buttons: new Map<string, w.ButtonRenderState>(),
	};
}

function invertSector(input: w.HitSector): w.HitSector {
	return {
		startAngle: Math.PI - input.endAngle,
		endAngle: Math.PI - input.startAngle,
		weight: input.weight,
	};
}

function calculateButtonWheelRegion(rect: ClientRect, options: RenderOptions): ClientRect {
	const maxSize = ButtonBar.Size * 3;

	let size = Math.min(
		(rect.width - ButtonBar.Margin) / 2, // Half width
		(rect.height - ButtonBar.Margin * 2)); // Or whole height
	size = Math.max(0, Math.min(maxSize, size));

	let left;
	let right;
	if (options.wheelOnRight) {
		right = rect.width - ButtonBar.Margin;
		left = right - size;
	} else {
		left = ButtonBar.Margin;
		right = left + size;
	}

	const bottom = rect.bottom - ButtonBar.Margin;
	const top = bottom - size;
	const width = size;
	const height = size;

	return { left, top, right, bottom, width, height };
}

function buttonStateChanged(previous: w.ButtonRenderState, current: w.ButtonRenderState) {
	if (!previous && !current) {
		return false;
	} else if (!previous && current || previous && !current) {
		return true;
	} else {
		return previous.key !== current.key
			|| previous.color !== current.color
			|| previous.icon !== current.icon
			|| previous.cooldownText !== current.cooldownText;
	}
}

function calculateButtonState(key: string, hero: w.Hero, selectedAction: string, world: w.World, rebindings: KeyBindings): w.ButtonRenderState {
	if (!key) { return null; }

	const spellId = hero.keysToSpells.get(key);
	if (!spellId) { return null; }

	const spell = (world.settings.Spells as Spells)[spellId];
	if (!spell) { return null; }

	const rebindingLookup = keyboardUtils.getRebindingLookup(rebindings);
	let button: w.ButtonRenderState = {
		key: rebindingLookup.get(key) || "",
		color: spell.color,
		icon: spell.icon,
		cooldownText: null,
	};

	let isSelected = selectedAction === spell.id || world.ui.nextSpellId === spell.id;
	let isHovered = world.ui.hoverSpellId === spell.id;
	let remainingInSeconds = engine.cooldownRemaining(world, hero, spell) / constants.TicksPerSecond;

	if (isSelected) {
		button.color = '#f0f0f0';
	} else if (remainingInSeconds > 0) {
		button.color = '#444444';
	}

	if (isHovered) {
		button.color = Color(button.color).lighten(0.25).string();
	} 

	if (remainingInSeconds > 0) {
		// Cooldown
		let cooldownText = remainingInSeconds > 1 ? remainingInSeconds.toFixed(0) : remainingInSeconds.toFixed(1);
		button.cooldownText = cooldownText;
	}

	return button;
}

function renderBarButton(ctx: CanvasRenderingContext2D, buttonRegion: ClientRect, buttonState: w.ButtonRenderState, iconLookup: IconLookup) {
	const size = buttonRegion.width; // assume square
	if (buttonState) {
		ctx.save();
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
        ctx.fillStyle = buttonState.color;
		
        ctx.beginPath();
        ctx.rect(0, 0, size, size);
        ctx.fill();

		ctx.clip();

		renderIconOnly(ctx, icons.getIcon(buttonState.icon, iconLookup), 0.6, size);

		if (buttonState.cooldownText) {
			// Cooldown
			let cooldownText = buttonState.cooldownText

			ctx.font = 'bold ' + (size * 0.75 - 1) + 'px sans-serif';
			renderTextWithShadow(ctx, cooldownText, size / 2, size / 2);
		} else {
			const key = buttonState.key;
			if (key && !keyboardUtils.isSpecialKey(key)) {
				// Keyboard shortcut
				ctx.save();

				ctx.font = 'bold ' + (size / 2 - 1) + 'px sans-serif';

				renderTextWithShadow(ctx, key.toUpperCase(), size / 4, size * 3 / 4);

				ctx.restore();
			}
		}


		ctx.restore();
	} else {
		ctx.clearRect(0, 0, size, size);
	}
}

function renderWheelButton(ctx: CanvasRenderingContext2D, sector: w.HitSector, innerRadius: number, outerRadius: number, buttonState: w.ButtonRenderState, iconLookup: IconLookup) {
	outerRadius = innerRadius + (0.5 + 0.5 * sector.weight) * (outerRadius - innerRadius);

	ctx.save();

	// Render button
	ctx.fillStyle = buttonState.color;

	ctx.beginPath();
	if (sector.startAngle && sector.endAngle) {
		ctx.arc(0, 0, outerRadius, sector.startAngle, sector.endAngle, false);
		ctx.arc(0, 0, innerRadius, sector.endAngle, sector.startAngle, true);
	} else {
		ctx.arc(0, 0, innerRadius, 0, 2 * Math.PI)
	}
	ctx.closePath();
	ctx.fill();

	ctx.clip(); // Clip icon inside button

	{
		ctx.save();

		// Translate to center of button
		if (sector.startAngle && sector.endAngle) {
			const midVector = vector.multiply(
				vector.fromAngle((sector.startAngle + sector.endAngle) / 2),
				(innerRadius + outerRadius) / 2);
			ctx.translate(midVector.x, midVector.y);
		}

		const size = outerRadius - innerRadius;

		// Render icon
		{
			ctx.save();

			ctx.translate(-size / 2, -size / 2); // Translate to top-left of button
			renderIconOnly(ctx, icons.getIcon(buttonState.icon, iconLookup), 0.6, size);
			
			ctx.restore();
		}

		// Cooldown
		let cooldownText = buttonState.cooldownText
		if (cooldownText) {
			ctx.save();

			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.font = 'bold ' + (size * 0.75 - 1) + 'px sans-serif';
			renderTextWithShadow(ctx, cooldownText, 0, 0);

			ctx.restore();
		}

		ctx.restore();
	}

	ctx.restore();
}

function renderTextWithShadow(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
	ctx.save();

	ctx.fillStyle = 'black';
	ctx.fillText(text, x + 1, y + 1);

	ctx.fillStyle = 'white';
	ctx.fillText(text, x, y);

	ctx.restore();
}

function hsl(h: number, sProportion: number, lProportion: number): string {
	return 'hsl(' + h.toFixed(0) + ', ' + (100 * sProportion).toFixed(2) + '%, ' + (100 * lProportion).toFixed(2) + '%)';
}