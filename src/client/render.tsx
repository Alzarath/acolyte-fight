import * as constants from '../game/constants';
import * as c from '../game/constants.model';
import * as engine from './engine';
import * as vector from './vector';
import * as w from './world.model';

import { ButtonBar, ChargingIndicator, HealthBar, Hero, Spells } from '../game/constants';
import { Icons } from './icons';

// Rendering
export function calculateWorldRect(rect: ClientRect) {
	let size = Math.min(rect.width, rect.height);
	return {
		left: (rect.width - size) / 2.0,
		top: (rect.height - size) / 2.0,
		width: size,
		height: size,
	};
}

export function render(world: w.World, canvas: HTMLCanvasElement) {
	let rect = canvas.getBoundingClientRect();
	let ctx = canvas.getContext('2d');

	ctx.save();
	clearCanvas(ctx, rect);
	renderWorld(ctx, world, rect);
	renderInterface(ctx, world, rect);
	ctx.restore();
}

function clearCanvas(ctx: CanvasRenderingContext2D, rect: ClientRect) {
	ctx.save();

	ctx.fillStyle = '#000000';
	ctx.beginPath();
	ctx.rect(0, 0, rect.width, rect.height);
	ctx.fill();

	ctx.restore();
}

function renderWorld(ctx: CanvasRenderingContext2D, world: w.World, rect: ClientRect) {
	ctx.save();

	let worldRect = calculateWorldRect(rect);
	ctx.translate(worldRect.left, worldRect.top);
	ctx.scale(worldRect.width, worldRect.height);

	renderMap(ctx, world);

	world.objects.forEach(obj => renderObject(ctx, obj, world));
	world.destroyed.forEach(obj => renderDestroyed(ctx, obj, world));

	let newTrails = new Array<w.Trail>();
	world.ui.trails.forEach(trail => {
		let complete = true;
		complete = renderTrail(ctx, trail);
		if (!complete) {
			newTrails.push(trail);
		}
	});
	world.ui.trails = newTrails;

	ctx.restore();
}

function renderObject(ctx: CanvasRenderingContext2D, obj: w.WorldObject, world: w.World) {
	if (obj.category === "hero") {
		renderHero(ctx, obj, world);
	} else if (obj.category === "projectile") {
		const spell = Spells.all[obj.type] as c.ProjectileSpell;
		renderSpell(ctx, obj, world, spell);
	}
}

function renderDestroyed(ctx: CanvasRenderingContext2D, obj: w.WorldObject, world: w.World) {
	if (obj.category === "projectile") {
		const spell = Spells.all[obj.type] as c.ProjectileSpell;
		renderSpell(ctx, obj, world, spell);
	}
}

function renderSpell(ctx: CanvasRenderingContext2D, obj: w.Projectile, world: w.World, spell: c.ProjectileSpell) {
    if (!spell) {
        return;
    }

    switch (spell.render) {
        case 'projectile': renderProjectile(ctx, obj, world, spell);
        case 'ray': renderRay(ctx, obj, world, spell);
    }
}

function renderMap(ctx: CanvasRenderingContext2D, world: w.World) {
	ctx.save();

	ctx.translate(0.5, 0.5);

	ctx.fillStyle = '#333333';
	ctx.beginPath();
	ctx.arc(0, 0, world.radius, 0, 2 * Math.PI);
	ctx.fill();

	ctx.restore();
}

function renderHero(ctx: CanvasRenderingContext2D, hero: w.Hero, world: w.World) {
	if (hero.destroyed) {
		return;
	}

	let pos = hero.body.getPosition();

	ctx.save();
	ctx.translate(pos.x, pos.y);

	// Fill
	ctx.fillStyle = hero.fillStyle;
	if (!world.activePlayers.has(hero.id)) {
		ctx.fillStyle = '#666666';
	} else if (hero.id === world.ui.myHeroId) {
		ctx.fillStyle = Hero.MyHeroColor;
	}
	ctx.beginPath();
	ctx.arc(0, 0, Hero.Radius, 0, 2 * Math.PI);
	ctx.fill();

	// Charging
	if (hero.charging && hero.charging.spell && hero.charging.proportion > 0) {
		ctx.save();

		let spell = Spells.all[hero.charging.spell];
		ctx.globalAlpha = hero.charging.proportion;
		ctx.strokeStyle = spell.color;
		ctx.lineWidth = ChargingIndicator.Width;
		ctx.beginPath();
		ctx.arc(0, 0, Hero.Radius + ChargingIndicator.Margin, 0, 2 * Math.PI);
		ctx.stroke();

		ctx.restore();
	}

	// Shield
	if (hero.shieldTicks) {
		let spell = Spells.shield;
		let proportion = 1.0 * hero.shieldTicks / spell.maxTicks;

		ctx.save();

		ctx.globalAlpha = proportion;
		ctx.fillStyle = spell.color;
		ctx.beginPath();
		ctx.arc(0, 0, spell.radius, 0, 2 * Math.PI);
		ctx.fill();


		ctx.restore();
	}

	// Health bar
	ctx.fillStyle = 'black';
	ctx.beginPath();
	ctx.rect(-HealthBar.Radius, -Hero.Radius - HealthBar.Height - HealthBar.Margin, HealthBar.Radius * 2, HealthBar.Height);
	ctx.fill();

	let healthProportion = hero.health / Hero.MaxHealth;
	ctx.fillStyle = rgColor(healthProportion);
	ctx.beginPath();
	ctx.rect(-HealthBar.Radius, -Hero.Radius - HealthBar.Height - HealthBar.Margin, HealthBar.Radius * 2 * healthProportion, HealthBar.Height);
	ctx.fill();

	ctx.restore();
}

function rgColor(proportion: number) {
	let hue = proportion * 120.0;
	return 'hsl(' + Math.round(hue) + ', 100%, 50%)';
}

function renderRay(ctx: CanvasRenderingContext2D, projectile: w.Projectile, world: w.World, spell: c.ProjectileSpell) {
	let pos = projectile.body.getPosition();
	let previous = projectile.uiPreviousPos;
	projectile.uiPreviousPos = vector.clone(pos);

	if (!previous) {
		renderProjectile(ctx, projectile, world, spell);
		return;
	}

	world.ui.trails.push({
		type: 'line',
		remaining: spell.trailTicks,
		max: spell.trailTicks, 
		from: vector.clone(previous),
		to: vector.clone(pos),
		fillStyle: spell.color,
		width: spell.radius * 2,
	} as w.LineTrail);
}

function renderProjectile(ctx: CanvasRenderingContext2D, projectile: w.Projectile, world: w.World, spell: c.ProjectileSpell) {
	let pos = projectile.body.getPosition();

	world.ui.trails.push({
		type: 'circle',
		remaining: spell.trailTicks,
		max: spell.trailTicks, 
		pos: vector.clone(pos),
		fillStyle: spell.color,
		radius: spell.radius,
	} as w.CircleTrail);
}

function renderTrail(ctx: CanvasRenderingContext2D, trail: w.Trail) {
	let proportion = 1.0 * trail.remaining / trail.max;
	if (proportion <= 0) {
		return true;
	}


	ctx.save(); 

	ctx.globalAlpha = proportion;
	ctx.fillStyle = trail.fillStyle;
	ctx.strokeStyle = trail.fillStyle;

	if (trail.type === "circle") {
		ctx.beginPath();
		ctx.arc(trail.pos.x, trail.pos.y, proportion * trail.radius, 0, 2 * Math.PI);
		ctx.fill();
	} else if (trail.type === "line") {
		ctx.lineWidth = proportion * trail.width;
		ctx.beginPath();
		ctx.moveTo(trail.from.x, trail.from.y);
		ctx.lineTo(trail.to.x, trail.to.y);
		ctx.stroke();
	}

	ctx.restore();

	--trail.remaining;
	return trail.remaining <= 0;
}

function renderInterface(ctx: CanvasRenderingContext2D, world: w.World, rect: ClientRect) {
	let myHero = world.objects.get(world.ui.myHeroId) as w.Hero;
	if (myHero) {
		const heroAction = world.actions.get(myHero.id);
		renderButtons(ctx, ButtonBar.List, world, myHero, heroAction, rect);
	}
}

function renderButtons(ctx: CanvasRenderingContext2D, buttons: string[], world: w.World, hero: w.Hero, heroAction: w.Action, rect: ClientRect) {
	let selectedAction = heroAction && heroAction.type;

	let buttonBarWidth = buttons.length * ButtonBar.Size + (buttons.length - 1) * ButtonBar.Spacing;

	ctx.save();
	ctx.translate(rect.width / 2.0 - buttonBarWidth / 2.0, rect.height - ButtonBar.Size - ButtonBar.Margin);

	for (let i = 0; i < buttons.length; ++i) {
		let spell = Spells.all[buttons[i]];
		if (!spell) {
			continue;
		}

		let isSelected = selectedAction === spell.id;
		let isCharging = hero.charging && hero.charging.spell === spell.id;
		let remainingInSeconds = engine.cooldownRemaining(world, hero, spell.id) / constants.TicksPerSecond;

		ctx.save();
		ctx.translate((ButtonBar.Size + ButtonBar.Spacing) * i, 0);
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';

		// Button
		{
			ctx.save();

			ctx.fillStyle = spell.color;
			if (remainingInSeconds > 0) {
				ctx.fillStyle = isSelected ? '#cccccc' : '#444444';
			} else if (isCharging) {
				ctx.fillStyle = 'white';
			}

			ctx.beginPath();
			ctx.rect(0, 0, ButtonBar.Size, ButtonBar.Size);
			ctx.fill();

			ctx.restore();
		}
		
		// Icon
		if (spell.icon) {
			ctx.save();

			ctx.globalAlpha = 0.6;
			ctx.fillStyle = 'white';
			ctx.scale(ButtonBar.Size / 512, ButtonBar.Size / 512);
			ctx.fill(Icons[spell.icon]);

			ctx.restore();
		}

		if (remainingInSeconds > 0) {
		// Cooldown
			let cooldownText = remainingInSeconds > 1 ? remainingInSeconds.toFixed(0) : remainingInSeconds.toFixed(1);

			ctx.font = 'bold ' + (ButtonBar.Size - 1) + 'px sans-serif';
			renderTextWithShadow(ctx, cooldownText, ButtonBar.Size / 2, ButtonBar.Size / 2);
		} else {
			// Keyboard shortcut
			ctx.save();

			ctx.font = 'bold ' + (ButtonBar.Size / 2 - 1) + 'px sans-serif';
			renderTextWithShadow(ctx, spell.key.toUpperCase(), ButtonBar.Size / 4, ButtonBar.Size * 3 / 4);

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



