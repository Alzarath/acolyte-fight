import _ from 'lodash';
import pl from 'planck-js';
import * as Immutable from 'immutable';
import * as constants from './constants';
import * as vector from './vector';
import * as w from './world.model';
import { calculateMod } from './settings';

import { Categories, Matchmaking, HeroColors, TicksPerSecond } from './constants';

// Reset planck.js constants
{
	const settings = (pl as any).internal.Settings;

	// Planck.js considers collisions to be inelastic if below this threshold.
	// We want all thresholds to be elastic.
	settings.velocityThreshold = 0;

	// We need to adjust this because our scale is not a normal scale and the defaults let some small projectiles tunnel through others
	settings.linearSlop = 0.0005;
	settings.linearSlopSquared = Math.pow(settings.linearSlop, 2.0);
	settings.polygonRadius = (2.0 * settings.linearSlop);
}

export function initialWorld(mod: Object): w.World {
	const settings = calculateMod(mod);

	let world = {
		seed: null,
		tick: 0,
		startTick: constants.Matchmaking.MaxHistoryLength,

		occurrences: new Array<w.Occurrence>(),
		activePlayers: Immutable.Set<string>(), // hero IDs
		players: Immutable.Map<string, w.Player>(), // hero ID -> player
		scores: Immutable.Map<string, w.HeroScore>(), // hero ID -> score
		winner: null,

		objects: new Map(),
		physics: pl.World(),
		actions: new Map(),
		radius: settings.World.InitialRadius,

		nextObstacleId: 0,
		nextPositionId: 0,
		nextObjectId: 0,
		nextColorId: 0,

		settings,
		mod,

		ui: {
			myGameId: null,
			myHeroId: null,
			renderedTick: null,
			destroyed: [],
			events: new Array<w.WorldEvent>(),
			trails: [],
			notifications: [],
		} as w.UIState,
	} as w.World;

	return world;
}

export function hasGamePrestarted(world: w.World) {
	return world.startTick < constants.Matchmaking.MaxHistoryLength;
}

export function takeNotifications(world: w.World): w.Notification[] {
	const notifications = world.ui.notifications;
	if (notifications.length > 0) {
		world.ui.notifications = [];
	}
	return notifications;
}

function polygon(numPoints: number, extent: number) {
	let points = new Array<pl.Vec2>();
	for (let i = 0; i < numPoints; ++i) {
		const point = vector.multiply(vector.fromAngle((i / numPoints) * (2 * Math.PI)), extent);
		points.push(point);
	}
	return points;
}

function addObstacle(world: w.World, position: pl.Vec2, angle: number, points: pl.Vec2[], extent: number) {
	const Obstacle = world.settings.Obstacle;

	const obstacleId = "obstacle" + (world.nextObjectId++);
	const body = world.physics.createBody({
		userData: obstacleId,
		type: 'dynamic',
		position,
		angle,
		linearDamping: Obstacle.LinearDamping,
		angularDamping: Obstacle.AngularDamping,
	});

	body.createFixture(pl.Polygon(points), {
		density: Obstacle.Density,
		filterCategoryBits: Categories.Obstacle,
		filterMaskBits: Categories.All,
	});

	const obstacle: w.Obstacle = {
		id: obstacleId,
		category: "obstacle",
		categories: Categories.Obstacle,
		type: "polygon",
		body,
		extent,
		points,
		health: Obstacle.Health,
		maxHealth: Obstacle.Health,
		createTick: world.tick,
		growthTicks: 0,
		damagePerTick: 0,
	};

	// Obstacles start immovable
	if (world.tick < world.startTick) {
		body.setMassData({
			mass: 1e6,
			I: 0,
			center: vector.zero(),
		});
	}

	world.objects.set(obstacle.id, obstacle);
	return obstacle;
}

function addShield(world: w.World, hero: w.Hero, spell: ShieldSpell) {
	const shieldId = "shield" + (world.nextObjectId++);

	const body = world.physics.createBody({
		userData: shieldId,
		type: 'static',
		position: vector.clone(hero.body.getPosition()),
	});

	body.createFixture(pl.Circle(spell.radius), {
		filterCategoryBits: Categories.Shield,
		filterMaskBits: Categories.Hero | Categories.Projectile,
		filterGroupIndex: hero.filterGroupIndex,
	});

	const shield: w.Shield = {
		id: shieldId,
		category: "shield",
		categories: Categories.Shield,
		body,
		createTick: world.tick,
		expireTick: world.tick + spell.maxTicks,
		owner: hero.id,
		radius: spell.radius,
		color: spell.color,
	};

	world.objects.set(shield.id, shield);
	hero.shieldIds.add(shield.id);

	return shield;
}

function addHero(world: w.World, heroId: string) {
	const Hero = world.settings.Hero;

	const heroIndex = world.nextPositionId++;
	const filterGroupIndex = -(heroIndex + 1); // +1 because 0 means group index doesn't apply

	let position;
	let angle;
	{
		const radius = world.settings.World.HeroLayoutRadius;
		const center = pl.Vec2(0.5, 0.5);

		let posAngle = 2 * Math.PI * heroIndex / Matchmaking.MaxPlayers;
		position = vector.plus(vector.multiply(vector.fromAngle(posAngle), radius), center);

		angle = posAngle + Math.PI; // Face inward
	}

	let body = world.physics.createBody({
		userData: heroId,
		type: 'dynamic',
		position,
		angle,
		linearDamping: Hero.Damping,
		angularDamping: Hero.AngularDamping,
		allowSleep: false,
	} as pl.BodyDef);
	body.createFixture(pl.Circle(Hero.Radius), {
		filterCategoryBits: Categories.Hero,
		filterMaskBits: Categories.All ^ Categories.Shield,
		filterGroupIndex,
		density: Hero.Density,
		restitution: 1.0,
	});

	let hero = {
		id: heroId,
		category: "hero",
		type: "hero",
		filterGroupIndex,
		categories: Categories.Hero,
		collideWith: Categories.All,
		health: Hero.MaxHealth,
		maxHealth: Hero.MaxHealth,
		body,
		radius: Hero.Radius,
		additionalDamageMultiplier: Hero.AdditionalDamageMultiplier,
		additionalDamagePower: Hero.AdditionalDamagePower,
		moveSpeedPerSecond: Hero.MoveSpeedPerSecond,
		revolutionsPerTick: Hero.RevolutionsPerTick,
		casting: null,
		cooldowns: {},
		killerHeroId: null,
		assistHeroId: null,
		keysToSpells: new Map<string, string>(),
		spellsToKeys: new Map<string, string>(),
		shieldIds: new Set<string>(),
		strafeIds: new Set<string>(),
	} as w.Hero;
	world.objects.set(heroId, hero);
	world.scores = world.scores.set(heroId, initScore(heroId));

	return hero;
}

export function cooldownRemaining(world: w.World, hero: w.Hero, spell: string) {
	let next = hero.cooldowns[spell] || 0;
	return Math.max(0, next - world.tick);
}

function setCooldown(world: w.World, hero: w.Hero, spell: string, waitTime: number) {
	hero.cooldowns[spell] = world.tick + waitTime;
}

function addProjectile(world: w.World, hero: w.Hero, target: pl.Vec2, spell: Spell, projectileTemplate: ProjectileTemplate) {
	let id = spell.id + (world.nextObjectId++);

	const from = hero.body.getPosition();
	let direction = vector.unit(vector.diff(target, from));
	if (direction.x === 0 && direction.y === 0) {
		direction = vector.fromAngle(hero.body.getAngle());
	}

	const offset = world.settings.Hero.Radius + projectileTemplate.radius + constants.Pixel;
	const position = vector.plus(hero.body.getPosition(), vector.multiply(direction, offset));
	const velocity = vector.multiply(direction, projectileTemplate.speed);
	const diff = vector.diff(target, position);

	const categories = projectileTemplate.categories === undefined ? (Categories.Projectile | Categories.Solid) : projectileTemplate.categories;
	const collideWith = projectileTemplate.collideWith !== undefined ? projectileTemplate.collideWith : Categories.All;

	let body = world.physics.createBody({
		userData: id,
		type: 'dynamic',
		position,
		linearVelocity: velocity,
		linearDamping: 0,
		bullet: true,
	});
	body.createFixture(pl.Circle(projectileTemplate.radius), {
		filterCategoryBits: categories,
		filterMaskBits: collideWith,
		density: projectileTemplate.density,
		restitution: 1.0,
	} as pl.FixtureDef);

	let targetObj = findNearest(world.objects, target, x => x.category === "hero" && x.id !== hero.id);

	let projectile = {
		id,
		owner: hero.id,
		category: "projectile",
		categories,
		type: spell.id,
		body,
		speed: projectileTemplate.speed,
		fixedSpeed: projectileTemplate.fixedSpeed !== undefined ? projectileTemplate.fixedSpeed : true,
		strafe: projectileTemplate.strafe,

		target,
		targetId: targetObj ? targetObj.id : null,
		alreadyHit: new Set<string>(),

		damage: projectileTemplate.damage,
		bounce: projectileTemplate.bounce,
		gravity: projectileTemplate.gravity,

		homing: projectileTemplate.homing && {
			turnRate: projectileTemplate.homing.revolutionsPerSecond * 2 * Math.PI,
			maxTurnProportion: projectileTemplate.homing.maxTurnProportion !== undefined ? projectileTemplate.homing.maxTurnProportion : 1.0,
			minDistanceToTarget: projectileTemplate.homing.minDistanceToTarget || 0,
			targetType: projectileTemplate.homing.targetType || w.HomingTargets.enemy,
			afterTick: world.tick + (projectileTemplate.homing.afterTicks || 0),
			redirectionTick: projectileTemplate.homing.redirect ? (world.tick + Math.floor(TicksPerSecond * vector.length(diff) / vector.length(velocity))) : null,
			speedWhenClose: projectileTemplate.homing.speedWhenClose,
		} as w.HomingParameters,
		link: projectileTemplate.link,
		detonate: projectileTemplate.detonate && {
			radius: projectileTemplate.detonate.radius,
			minImpulse: projectileTemplate.detonate.minImpulse,
			maxImpulse: projectileTemplate.detonate.maxImpulse,
			detonateTick: world.tick + ticksToDetonate(projectileTemplate, vector.length(diff), vector.length(velocity)),
			waitTicks: projectileTemplate.detonate.waitTicks || 0,
		} as w.DetonateParameters,
		lifeSteal: projectileTemplate.lifeSteal || 0.0,
		shieldTakesOwnership: projectileTemplate.shieldTakesOwnership !== undefined ? projectileTemplate.shieldTakesOwnership : true,

		createTick: world.tick,
		expireTick: world.tick + projectileTemplate.maxTicks,
		minTicks: projectileTemplate.minTicks || 0,
		maxTicks: projectileTemplate.maxTicks,
		collideWith,
		expireOn: projectileTemplate.expireOn !== undefined ? projectileTemplate.expireOn : (Categories.All ^ Categories.Shield),

		render: projectileTemplate.render,
		color: projectileTemplate.color,
		selfColor: projectileTemplate.selfColor,
		radius: projectileTemplate.radius,
		trailTicks: projectileTemplate.trailTicks,

		uiPath: [vector.clone(position)],
	} as w.Projectile;

	scaleDamagePacket(projectile, hero, projectileTemplate.damageScaling);

	world.objects.set(id, projectile);
	if (projectile.strafe) {
		hero.strafeIds.add(projectile.id);
	}

	return projectile;
}

function ticksToDetonate(projectileTemplate: ProjectileTemplate, distance: number, speed: number) {
	if (!projectileTemplate.detonate) {
		return 0;
	}

	let ticks = Math.floor(TicksPerSecond * distance / speed);
	ticks = Math.min(ticks, projectileTemplate.maxTicks - (projectileTemplate.detonate.waitTicks || 0));
	return ticks;
}

// Simulator
export function tick(world: w.World) {
	++world.tick;

	handleOccurences(world);
	handleActions(world);

	homingForce(world);
	linkForce(world);
	gravityForce(world);
	updateKnockback(world);

	shields(world);
	physicsStep(world);
	for (var contact = world.physics.getContactList(); !!contact; contact = contact.getNext()) {
		handleContact(world, contact);
	}

	applySpeedLimit(world);
	decayThrust(world);
	decayObstacles(world);
	detonate(world);
	applyLavaDamage(world);
	shrink(world);

	reap(world);
}

function physicsStep(world: w.World) {
	world.physics.step(1.0 / TicksPerSecond);
}

function applySpeedLimit(world: w.World) {
	world.objects.forEach(obj => {
		if (obj.category === "projectile" && obj.fixedSpeed) {
			const currentVelocity = obj.body.getLinearVelocity();
			const currentSpeed = vector.length(currentVelocity);

			const diff = obj.speed - currentSpeed;
			if (Math.abs(diff) > world.settings.World.ProjectileSpeedMaxError) {
				const newSpeed = currentSpeed + diff * world.settings.World.ProjectileSpeedDecayFactorPerTick;
				obj.body.setLinearVelocity(vector.relengthen(currentVelocity, newSpeed));
			}
		}
	});
}

function handleOccurences(world: w.World) {
	world.occurrences.forEach(ev => {
		if (ev.type === "closing") {
			handleClosing(ev, world);
		} else if (ev.type === "botting") {
			handleBotting(ev, world);
		} else if (ev.type === "join") {
			handleJoining(ev, world);
		} else if (ev.type === "leave") {
			handleLeaving(ev, world);
		} else if (ev.type === "environment") {
			seedEnvironment(ev, world);
		}
	});
	world.occurrences = [];
}

function seedEnvironment(ev: w.EnvironmentSeed, world: w.World) {
	if (world.seed !== null) {
		return;
	}
	world.seed = ev.seed;
	console.log("Environment seed " + world.seed);

	const Layouts = world.settings.Layouts;

	const mapCenter = pl.Vec2(0.5, 0.5);
	const layouts = Object.keys(Layouts).map(key => Layouts[key]).filter(x => !!x);
	const layout = layouts[world.seed % layouts.length];
	layout.obstacles.forEach(obstacleTemplate => {
		const points = polygon(obstacleTemplate.numPoints, obstacleTemplate.extent);
		for (let i = 0; i < obstacleTemplate.numObstacles; ++i) {
			const proportion = i / obstacleTemplate.numObstacles;
			const baseAngle = proportion * (2 * Math.PI);
			const layoutAngleOffset = obstacleTemplate.layoutAngleOffsetInRevs * 2 * Math.PI;
			const orientationAngleOffset = obstacleTemplate.orientationAngleOffsetInRevs * 2 * Math.PI;
			const position = vector.plus(mapCenter, vector.multiply(vector.fromAngle(baseAngle + layoutAngleOffset), obstacleTemplate.layoutRadius));

			const orientationAngle = baseAngle + layoutAngleOffset + orientationAngleOffset;
			addObstacle(world, position, orientationAngle, points, obstacleTemplate.extent);
		}
	});
}

function handleClosing(ev: w.Closing, world: w.World) {
	world.startTick = ev.startTick;

	world.objects.forEach(obstacle => { // Obstacles movable now
		if (obstacle.category === "obstacle") {
			obstacle.body.resetMassData();
		}
	});

	world.ui.notifications.push({
		type: "closing",
		ticksUntilClose: world.startTick - world.tick,
	});
}

function handleBotting(ev: w.Botting, world: w.World) {
	console.log("Bot joined:", ev.heroId);

	let hero = world.objects.get(ev.heroId);
	if (!hero) {
		hero = addHero(world, ev.heroId);
	} else if (hero.category !== "hero") {
		throw "Player tried to join as non-hero: " + ev.heroId;
	}

	assignKeyBindingsToHero(hero, ev.keyBindings, world); 

	const player = {
		heroId: hero.id,
		name: Matchmaking.BotName,
		uiColor: HeroColors.BotColor,
		isBot: true,
		isSharedBot: true,
	} as w.Player;

	world.players = world.players.set(hero.id, player);
	world.activePlayers = world.activePlayers.delete(hero.id);

	world.ui.notifications.push({ type: "bot", player });
}

function handleJoining(ev: w.Joining, world: w.World) {
	console.log("Player joined:", ev.heroId);
	let hero = world.objects.get(ev.heroId);
	if (!hero) {
		hero = addHero(world, ev.heroId);
	} else if (hero.category !== "hero") {
		throw "Player tried to join as non-hero: " + ev.heroId;
	}

	assignKeyBindingsToHero(hero, ev.keyBindings, world);

	const player = {
		heroId: hero.id,
		name: ev.playerName,
		uiColor: chooseNewPlayerColor(ev.preferredColor, world),
		isBot: ev.isBot,
		isSharedBot: false,
		isMobile: ev.isMobile,
	} as w.Player;

	world.players = world.players.set(hero.id, player);
	world.activePlayers = world.activePlayers.add(hero.id);

	world.ui.notifications.push({ type: "join", player });
}

function chooseNewPlayerColor(preferredColor: string, world: w.World) {
	let alreadyUsedColors = new Set<string>();
	world.players.forEach(player => {
		if (world.activePlayers.has(player.heroId)) {
			alreadyUsedColors.add(player.uiColor);
		}
	});

	let uiColor = HeroColors.Colors[0];
	if (preferredColor && !alreadyUsedColors.has(preferredColor)) {
		uiColor = preferredColor;
	} else {
		for (let i = 0; i < HeroColors.Colors.length; ++i) {
			let candidate = HeroColors.Colors[i];
			if (!alreadyUsedColors.has(candidate)) {
				uiColor = candidate;
				break;
			}
		}
	}

	return uiColor;
}

function handleLeaving(ev: w.Leaving, world: w.World) {
	console.log("Player left:", ev.heroId);
	const player = world.players.get(ev.heroId);
	if (!player) {
		return;
	}

	world.activePlayers = world.activePlayers.delete(ev.heroId);

	world.ui.notifications.push({ type: "leave", player });

	const hero = world.objects.get(ev.heroId);
	if (hero && !world.winner) {
		// Replace leaving hero with bot
		const newPlayer = {
			...player,
			isBot: true,
			isSharedBot: true,
			isMobile: false,
		};

		world.players = world.players.set(ev.heroId, newPlayer);
	}
}

function handleActions(world: w.World) {
	let newActions = new Map();
	world.objects.forEach(hero => {
		if (hero.category !== "hero") { return; }
		let action = world.actions.get(hero.id);
		let completed = performHeroActions(world, hero, action);
		if (action && !completed) {
			newActions.set(hero.id, action);
		}
	});
	world.actions = newActions;
}

function assignKeyBindingsToHero(hero: w.Hero, keyBindings: KeyBindings, world: w.World) {
	const Choices = world.settings.Choices;

	let keysToSpells = new Map<string, string>();
	let spellsToKeys = new Map<string, string>();
	for (var key in Choices.Options) {
		let spellId = keyBindings[key];

		const validOptions = Choices.Options[key];
		if (!(validOptions.indexOf(spellId) >= 0)) {
			spellId = Choices.Defaults[key];
		}

		keysToSpells.set(key, spellId);
		spellsToKeys.set(spellId, key);
	}
	hero.keysToSpells = keysToSpells;
	hero.spellsToKeys = spellsToKeys;
}

function performHeroActions(world: w.World, hero: w.Hero, nextAction: w.Action) {
	let action = nextAction;
	if (hero.casting && hero.casting.uninterruptible) {
		action = hero.casting.action;
	}
	if (!action || !isValidAction(action, hero)) {
		return true; // Nothing to do
	}
	const spell = world.settings.Spells[action.type];
	const uninterruptible = !spell.interruptible;

	// Start casting a new spell
	if (!hero.casting || action !== hero.casting.action) {
		hero.casting = { action: action, color: spell.color, stage: w.CastStage.Cooldown };
	}

	const angleDiff = spell.untargeted ? 0 : turnTowards(hero, action.target);

	if (hero.casting.stage === w.CastStage.Cooldown) {
		if (spell.cooldown && cooldownRemaining(world, hero, spell.id) > 0) {
			return false; // Cannot perform action, waiting for cooldown
		}
		++hero.casting.stage;
	}

	if (hero.casting.stage === w.CastStage.Orientating) {
		hero.casting.uninterruptible = uninterruptible;

		if (spell.maxAngleDiffInRevs !== undefined && angleDiff > spell.maxAngleDiffInRevs * 2 * Math.PI) {
			return false; // Wait until are facing the target
		}

		hero.casting.uninterruptible = false;
		++hero.casting.stage;
	}

	if (hero.casting.stage === w.CastStage.Charging) {
		// Entering charging stage
		if (!hero.casting.chargeStartTick) {
			hero.casting.chargeStartTick = world.tick;
			hero.casting.uninterruptible = uninterruptible;
		}
		
		// Waiting for charging to complete
		const ticksCharging = world.tick - hero.casting.chargeStartTick;
		if (spell.chargeTicks && ticksCharging < spell.chargeTicks) {
			hero.casting.proportion = 1.0 * ticksCharging / spell.chargeTicks;
			return false;
		}

		// Exiting charging stage
		hero.casting.proportion = null;
		hero.casting.uninterruptible = false;
		++hero.casting.stage;
	}

	let done = false;
	if (hero.casting.stage === w.CastStage.Channelling) {
		// Start channelling
		if (!hero.casting.channellingStartTick) {
			hero.casting.channellingStartTick = world.tick;
			hero.casting.uninterruptible = uninterruptible;
			hero.casting.initialPosition = vector.clone(hero.body.getPosition());
			hero.casting.initialAngle = hero.body.getAngle();

			if (spell.cooldown) {
				setCooldown(world, hero, spell.id, spell.cooldown);
			}
		}

		let cancelled = false;
		if (!cancelled && spell.knockbackCancel) {
			cancelled = 
				Math.abs(vector.angleDelta(hero.casting.initialAngle, hero.body.getAngle())) > spell.maxAngleDiffInRevs * 2 * Math.PI
				|| vector.distance(hero.casting.initialPosition, hero.body.getPosition()) > constants.Pixel;
		}
		if (!cancelled) {
			done = applyAction(world, hero, action, spell);
		} else {
			done = true;
		}

		if (done) {
			hero.casting.uninterruptible = false;
			++hero.casting.stage;
		}
	}

	if (hero.casting.stage === w.CastStage.Complete) {
		hero.casting = null;
	}

	// Only mark nextAction as completed if we actually did it and not the uninterruptible action
	return action === nextAction && done;
}

function turnTowards(hero: w.Hero, target: pl.Vec2) {
	const targetAngle = vector.angle(vector.diff(target, hero.body.getPosition()));
	const currentAngle = hero.body.getAngle();

	const newAngle = vector.turnTowards(currentAngle, targetAngle, hero.revolutionsPerTick * 2 * Math.PI);
	hero.body.setAngle(newAngle);

	return Math.abs(vector.angleDelta(newAngle, targetAngle));
}

function isValidAction(action: w.Action, hero: w.Hero) {
	if (action.type === "move") {
		return true;
	} else {
		return hero.spellsToKeys.has(action.type);
	}
}

function applyAction(world: w.World, hero: w.Hero, action: w.Action, spell: Spell): boolean {
	switch (spell.action) {
		case "move": return moveAction(world, hero, action, spell);
		case "projectile": return spawnProjectileAction(world, hero, action, spell);
		case "spray": return sprayProjectileAction(world, hero, action, spell);
		case "scourge": return scourgeAction(world, hero, action, spell);
		case "teleport": return teleportAction(world, hero, action, spell);
		case "thrust": return thrustAction(world, hero, action, spell);
		case "wall": return wallAction(world, hero, action, spell);
		case "shield": return shieldAction(world, hero, action, spell);
	}
}

function handleContact(world: w.World, contact: pl.Contact) {
	if (!contact.isTouching()) {
		return;
	}

	let objA = world.objects.get(contact.getFixtureA().getBody().getUserData());
	let objB = world.objects.get(contact.getFixtureB().getBody().getUserData());
	const collisionPoint = vector.average(contact.getWorldManifold().points);
	if (objA && objB) {
		handleCollision(world, objA, objB, collisionPoint);
		handleCollision(world, objB, objA, collisionPoint);
	}
}

function handleCollision(world: w.World, object: w.WorldObject, hit: w.WorldObject, collisionPoint: pl.Vec2) {
	if (object.category === "projectile") {
		object.uiPath.push(collisionPoint);

		if (hit.category === "hero") {
			handleProjectileHitHero(world, object, hit);
		} else if (hit.category === "projectile") {
			handleProjectileHitProjectile(world, object, hit);
		} else if (hit.category === "obstacle") {
			handleProjectileHitObstacle(world, object, hit);
		} else if (hit.category === "shield") {
			handleProjectileHitShield(world, object, hit);
		}
	} else if (object.category === "hero") {
		if (hit.category === "hero") {
			handleHeroHitHero(world, object, hit);
		} else if (hit.category === "projectile") {
			handleHeroHitProjectile(world, object, hit);
		} else if (hit.category === "obstacle") {
			handleHeroHitObstacle(world, object, hit);
		} else if (hit.category === "shield") {
			handleHeroHitShield(world, object, hit);
		}
	}
}

function handleHeroHitShield(world: w.World, hero: w.Hero, other: w.Shield) {
	if (hero.thrust) {
		// Thrust into shield means the hero bounces off
		hero.thrust.nullified = true;
	}
}

function handleHeroHitHero(world: w.World, hero: w.Hero, other: w.Hero) {
	const Hero = world.settings.Hero;

	// Push back other heroes
	const pushbackDirection = vector.unit(vector.diff(hero.body.getPosition(), other.body.getPosition()));
	const repelDistance = Hero.Radius * 2 - vector.distance(hero.body.getPosition(), other.body.getPosition());
	if (repelDistance > 0) {
		const step = vector.multiply(pushbackDirection, repelDistance);
		const impulse = vector.multiply(step, Hero.SeparationImpulsePerTick);
		hero.body.applyLinearImpulse(impulse, hero.body.getWorldPoint(vector.zero()), true);
	}

	// If using thrust, cause damage
	if (hero.thrust) {
		if (!hero.thrust.alreadyHit.has(other.id)) {
			hero.thrust.alreadyHit.add(other.id);
			applyDamage(other, hero.thrust, hero.id, world);
		}
	}
}

function handleHeroHitProjectile(world: w.World, hero: w.Hero, projectile: w.Projectile) {
	if (hero.thrust) {
		if (projectile.categories & Categories.Massive) {
			hero.thrust.nullified = true;
		}
	}
}

function handleHeroHitObstacle(world: w.World, hero: w.Hero, obstacle: w.Obstacle) {
	if (hero.thrust) {
		applyDamageToObstacle(obstacle, hero.thrust.damage, world);
		hero.thrust.nullified = true;
	}
}

function handleProjectileHitObstacle(world: w.World, projectile: w.Projectile, obstacle: w.Obstacle) {
	if (!projectile.alreadyHit.has(obstacle.id)) {
		projectile.alreadyHit.add(obstacle.id);
		applyDamageToObstacle(obstacle, projectile.damage, world);
	}

	if (expireOn(world, projectile, obstacle)) {
		destroyObject(world, projectile);
	}
}

function handleProjectileHitProjectile(world: w.World, projectile: w.Projectile, other: w.Projectile) {
	if (expireOn(world, projectile, other)) {
		destroyObject(world, projectile);
	}
}

function handleProjectileHitShield(world: w.World, projectile: w.Projectile, shield: w.Shield) {
	const myProjectile = shield.owner === projectile.owner;

	if (!myProjectile && projectile.shieldTakesOwnership) { // Stop double redirections cancelling out
		// Redirect back to owner
		projectile.targetId = projectile.owner;
		projectile.owner = shield.owner;
	}

	projectile.expireTick = world.tick + projectile.maxTicks; // Make the spell last longer when deflected

	if (projectile.bounce) {
		bounceToNext(projectile, shield.owner, world);
	}
	if (!myProjectile && expireOn(world, projectile, shield)) { // Every projectile is going to hit its owner's shield on the way out
		destroyObject(world, projectile);
	}
}

function handleProjectileHitHero(world: w.World, projectile: w.Projectile, hero: w.Hero) {
	if ((projectile.collideWith & Categories.Shield) && isHeroShielded(hero, world)) {
		return;
	}

	if (hero.id !== projectile.owner && !projectile.alreadyHit.has(hero.id)) {
		projectile.alreadyHit.add(hero.id);

		applyDamage(hero, projectile, projectile.owner, world);
		linkTo(projectile, hero, world);
		projectile.hit = true;
	}

	if (projectile.gravity) {
		applyGravity(projectile, hero, world);
	}
	if (projectile.bounce) {
		bounceToNext(projectile, hero.id, world);
	}
	if (expireOn(world, projectile, hero)) {
		destroyObject(world, projectile);
	}
}

function isHeroShielded(hero: w.Hero, world: w.World) {
	for (const shieldId of hero.shieldIds) {
		if (world.objects.has(shieldId)) {
			return true;
		} else {
			hero.shieldIds.delete(shieldId);
		}
	}
	return false;
}

function expireOn(world: w.World, projectile: w.Projectile, other: w.WorldObject) {
	return (projectile.expireOn & other.categories) && (world.tick >= projectile.createTick + projectile.minTicks);
}

function findNearest(objects: Map<string, w.WorldObject>, target: pl.Vec2, predicate: (obj: w.WorldObject) => boolean): w.WorldObject {
	let nearestDistance = Infinity;
	let nearest: w.WorldObject = null;
	objects.forEach(obj => {
		if (!predicate(obj)) {
			return;
		}

		let distance = vector.distance(target, obj.body.getPosition());
		if (distance < nearestDistance) {
			nearestDistance = distance;
			nearest = obj;
		}
	});
	return nearest;
}

function applyGravity(projectile: w.Projectile, target: w.WorldObject, world: w.World) {
	if (!projectile.gravity || target.category !== "hero") {
		return;
	}
	projectile.expireTick = world.tick;

	target.gravity = {
		spellId: projectile.type,
		expireTick: world.tick + projectile.gravity.ticks,
		location: vector.clone(projectile.body.getPosition()),
		strength: projectile.gravity.impulsePerTick,
		radius: projectile.gravity.radius,
		power: projectile.gravity.power,
	};
}

function linkTo(projectile: w.Projectile, target: w.WorldObject, world: w.World) {
	if (!projectile.link) {
		return;
	}
	projectile.expireTick = world.tick;

	const owner = world.objects.get(projectile.owner);
	if (!(target && owner && owner.category === "hero")) {
		return;
	}

	owner.link = {
		targetId: target.id,
		minDistance: projectile.link.minDistance,
		maxDistance: projectile.link.maxDistance,
		strength: projectile.link.impulsePerTick,
		lifeSteal: projectile.link.lifeSteal,
		expireTick: world.tick + projectile.link.linkTicks,
		color: projectile.color,
	};
}

function bounceToNext(projectile: w.Projectile, hitId: string, world: w.World) {
	if (!projectile.bounce) {
		return;
	}

	let nextTarget = findNearest(
		world.objects,
		projectile.body.getPosition(),
		x => x.category === "hero" && x.id !== hitId);
	if (!nextTarget) {
		return;
	}

	projectile.targetId = nextTarget.id;
	projectile.damage *= projectile.bounce.damageFactor || 1.0;

	let currentSpeed = vector.length(projectile.body.getLinearVelocity());
	let newDirection = vector.unit(vector.diff(nextTarget.body.getPosition(), projectile.body.getPosition()));
	let newVelocity = vector.multiply(newDirection, currentSpeed);
	projectile.body.setLinearVelocity(newVelocity);

	projectile.alreadyHit.delete(nextTarget.id);
}

function gravityForce(world: w.World) {
	world.objects.forEach(hero => {
		if (!(hero.category === "hero" && hero.gravity)) {
			return;
		}
		if (world.tick >= hero.gravity.expireTick) {
			hero.gravity = null;
			return;
		}

		const towardsOrb = vector.diff(hero.gravity.location, hero.body.getPosition());
		const distanceTo = vector.length(towardsOrb);
		if (distanceTo >= hero.gravity.radius) {
			hero.gravity = null;
			return;
		}

		const proportion = Math.pow(1.0 - distanceTo / hero.gravity.radius, hero.gravity.power);
		const strength = hero.gravity.strength * proportion;

		const impulse = vector.multiply(vector.unit(towardsOrb), strength);
		hero.body.applyLinearImpulse(impulse, hero.body.getWorldPoint(vector.zero()), true);
	});
}

function homingForce(world: w.World) {
	world.objects.forEach(obj => {
		if (!(obj.category === "projectile" && obj.homing && world.tick >= obj.homing.afterTick)) {
			return;
		}

		let target: pl.Vec2 = null;
		if (obj.homing.targetType === w.HomingTargets.self) {
			const targetObj = world.objects.get(obj.owner);
			if (targetObj) {
				target = targetObj.body.getPosition();
			}
		} else if (obj.homing.targetType === w.HomingTargets.enemy) {
			const targetObj = world.objects.get(obj.targetId);
			if (targetObj) {
				target = targetObj.body.getPosition();
			}
		} else if (obj.homing.targetType === w.HomingTargets.cursor) {
			target = obj.target;
		}
		if (!target) {
			return;
		}

		const diff = vector.diff(target, obj.body.getPosition());
		const distanceToTarget = vector.length(diff);
		if (distanceToTarget <= obj.homing.minDistanceToTarget) {
			if (obj.homing.speedWhenClose !== undefined) {
				obj.body.setLinearVelocity(vector.relengthen(obj.body.getLinearVelocity(), obj.homing.speedWhenClose));
			}
			return;
		}

		if (obj.homing.redirectionTick && world.tick >= obj.homing.redirectionTick) {
			obj.homing.redirectionTick = null;

			// Redirect directly towards target
			const currentVelocity = obj.body.getLinearVelocity();
			obj.body.setLinearVelocity(vector.redirect(currentVelocity, diff));
		} else {
			// Home to target
			const currentVelocity = obj.body.getLinearVelocity();

			const currentAngle = vector.angle(currentVelocity);
			const idealAngle = vector.angle(diff);

			const maxTurnRate = obj.homing.maxTurnProportion * Math.abs(vector.angleDelta(currentAngle, idealAngle));
			const turnRate = Math.min(obj.homing.turnRate, maxTurnRate);
			const newAngle = vector.turnTowards(currentAngle, idealAngle, turnRate);

			const currentSpeed = vector.length(currentVelocity);
			const newVelocity = vector.multiply(vector.fromAngle(newAngle), currentSpeed);

			obj.body.setLinearVelocity(newVelocity);
		}
	});
}

function linkForce(world: w.World) {
	world.objects.forEach(owner => {
		if (!(owner.category === "hero" && owner.link)) {
			return;
		}

		if (world.tick >= owner.link.expireTick) {
			owner.link = null;
			return;
		}

		const target = world.objects.get(owner.link.targetId);
		if (!(owner && target)) {
			return;
		}

		const minDistance = owner.link.minDistance;
		const maxDistance = owner.link.maxDistance;

		const diff = vector.diff(target.body.getPosition(), owner.body.getPosition());
		const distance = vector.length(diff);
		const strength = owner.link.strength * Math.max(0, distance - minDistance) / (maxDistance - minDistance);
		if (strength <= 0) {
			return;
		}

		owner.body.applyLinearImpulse(
			vector.relengthen(diff, strength * owner.body.getMass()),
			owner.body.getWorldPoint(vector.zero()), true);

		if (target.category === "hero") {
			target.body.applyLinearImpulse(
				vector.relengthen(vector.negate(diff), strength * target.body.getMass()),
				target.body.getWorldPoint(vector.zero()), true);
		}
	});
}

function shields(world: w.World) {
	world.objects.forEach(shield => {
		if (shield.category === "shield" && world.tick < shield.expireTick) {
			const hero = world.objects.get(shield.owner);
			if (hero) {
				shield.body.setPosition(vector.clone(hero.body.getPosition()));
			} else {
				shield.expireTick = world.tick;
			}
		}
	});
}

function updateKnockback(world: w.World) {
	world.objects.forEach(hero => {
		if (hero.category === "hero") {
			if (hero.thrust) {
				updateMaskBits(hero.body.getFixtureList(), Categories.All);
			} else {
				updateMaskBits(hero.body.getFixtureList(), Categories.All ^ Categories.Shield);
			}
		}
	});
}

function updateMaskBits(fixture: pl.Fixture, newMaskBits: number) {
	if (fixture.getFilterMaskBits() !== newMaskBits) {
		fixture.setFilterData({
			groupIndex: fixture.getFilterGroupIndex(),
			categoryBits: fixture.getFilterCategoryBits(),
			maskBits: newMaskBits,
		});
	}
}

function decayThrust(world: w.World) {
	world.objects.forEach(hero => {
		if (hero.category === "hero" && hero.thrust) {
			--hero.thrust.ticks;
			if (hero.thrust.ticks <= 0) {
				hero.body.setLinearVelocity(vector.zero());
				hero.thrust = null;
			}
		}
	});
}

function decayObstacles(world: w.World) {
	world.objects.forEach(obj => {
		if (obj.category === "obstacle" && obj.damagePerTick) {
			obj.health -= obj.damagePerTick;
		}
	});
}

function detonate(world: w.World) {
	const Hero = world.settings.Hero;

	world.objects.forEach(obj => {
		if (!(obj.category === "projectile" && obj.detonate)) {
			return;
		}

		if (world.tick === obj.detonate.detonateTick) {
			obj.body.setLinearVelocity(vector.zero());
		}

		if (world.tick === obj.detonate.detonateTick + obj.detonate.waitTicks) {
			// Apply damage
			world.objects.forEach(other => {
				if (other.category === "hero") {
					const diff = vector.diff(other.body.getPosition(), obj.body.getPosition());
					const distance = vector.length(diff);
					if (other.id !== obj.owner && distance <= obj.detonate.radius + other.radius) {
						applyDamage(other, obj, obj.owner, world);

						const proportion = 1.0 - (distance / (obj.detonate.radius + other.radius)); // +HeroRadius because only need to touch the edge
						const magnitude = obj.detonate.minImpulse + proportion * (obj.detonate.maxImpulse - obj.detonate.minImpulse);
						other.body.applyLinearImpulse(
							vector.relengthen(diff, magnitude),
							other.body.getWorldPoint(vector.zero()),
							true);
					}
				} else if (other.category === "obstacle") {
					if (vector.distance(obj.body.getPosition(), other.body.getPosition()) <= obj.detonate.radius + other.extent) {
						applyDamageToObstacle(other, obj.damage, world);
					}
				}
			});

			world.ui.events.push({
				type: "detonate",
				pos: vector.clone(obj.body.getPosition()),
				radius: obj.detonate.radius,
			});
			destroyObject(world, obj);
		}
	});
}

function applyLavaDamage(world: w.World) {
	const lavaDamagePerTick = world.settings.World.LavaDamagePerSecond / TicksPerSecond;
	const mapCenter = pl.Vec2(0.5, 0.5);
	world.objects.forEach(obj => {
		if (obj.category === "hero") {
			if (vector.distance(obj.body.getPosition(), mapCenter) > world.radius) {
				applyDamage(obj, { damage: lavaDamagePerTick }, null, world);
			}
		} else if (obj.category === "obstacle") {
			if (vector.distance(obj.body.getPosition(), mapCenter) > world.radius) {
				applyDamageToObstacle(obj, lavaDamagePerTick, world);
			}
		}
	});
}

function shrink(world: w.World) {
	const World = world.settings.World;
	if (world.tick >= world.startTick && !world.winner) {
		const seconds = (world.tick - world.startTick) / TicksPerSecond;
		const proportion = Math.max(0, 1.0 - seconds / World.SecondsToShrink);
		world.radius = World.InitialRadius * Math.pow(proportion, World.ShrinkPower);
	}
}

function reap(world: w.World) {
	let heroKilled = false;
	world.objects.forEach(obj => {
		if (obj.category === "hero") {
			if (obj.health <= 0) {
				destroyObject(world, obj);
				notifyKill(obj, world);
				heroKilled = true;
			}
		} else if (obj.category === "projectile") {
			if (world.tick >= obj.expireTick) {
				destroyObject(world, obj);
			}
		} else if (obj.category === "obstacle") {
			if (obj.health <= 0) {
				destroyObject(world, obj);
			}
		} else if (obj.category === "shield") {
			if (world.tick >= obj.expireTick) {
				destroyObject(world, obj);
			}
		}
	});

	if (heroKilled) {
		notifyWin(world);
	}
}

function notifyWin(world: w.World) {
	if (world.winner) {
		return;
	}

	let numAlive = 0;
	world.objects.forEach(hero => {
		if (hero.category === "hero") {
			++numAlive;
		}
	});
	if (numAlive > 1) {
		return;
	}

	let bestScore: w.HeroScore = null;
	world.scores.forEach(score => {
		if (!(score.deathTick >= 0)) {
			++numAlive;
		}
		if (!bestScore) {
			bestScore = score;
			return;
		}

		const myDeathTick = score.deathTick || Infinity;
		const bestDeathTick = bestScore.deathTick || Infinity;
		if (myDeathTick > bestDeathTick) {
			bestScore = score;
		}
	});
	if (!bestScore) {
		return;
	}

	let mostDamage: w.HeroScore = null;
	world.scores.forEach(score => {
		if (!mostDamage) {
			mostDamage = score;
			return;
		}

		if (score.damage > mostDamage.damage) {
			mostDamage = score;
		}
	});
	if (!mostDamage) {
		return;
	}

	let mostKills: w.HeroScore = null;
	world.scores.forEach(score => {
		if (!mostKills) {
			mostKills = score;
			return;
		}

		if (score.kills > mostKills.kills) {
			mostKills = score;
		}
	});
	if (!mostKills) {
		return;
	}

	world.winner = bestScore.heroId;
	world.ui.notifications.push({
		type: "win",
		winner: world.players.get(bestScore.heroId),
		mostDamage: world.players.get(mostDamage.heroId),
		mostDamageAmount: mostDamage.damage,
		mostKills: world.players.get(mostKills.heroId),
		mostKillsCount: mostKills.kills,
	});
}

function notifyKill(hero: w.Hero, world: w.World) {
	const killed = world.players.get(hero.id);
	if (!killed) {
		return;
	}

	const killer = hero.killerHeroId && world.players.get(hero.killerHeroId) || null;
	const assist = hero.assistHeroId && world.players.get(hero.assistHeroId) || null;
	world.ui.notifications.push({ type: "kill", killed, killer, assist });

	if (hero) {
		const score = world.scores.get(hero.id);
		world.scores = world.scores.set(hero.id, { ...score, deathTick: world.tick });
	}
	if (hero.killerHeroId) {
		const score = world.scores.get(hero.killerHeroId);
		world.scores = world.scores.set(hero.killerHeroId, { ...score, kills: score.kills + 1 });
	}
	if (hero.assistHeroId) {
		const score = world.scores.get(hero.assistHeroId);
		world.scores = world.scores.set(hero.assistHeroId, { ...score, assists: score.assists + 1 });
	}
}

function destroyObject(world: w.World, object: w.WorldObject) {
	world.objects.delete(object.id);
	world.physics.destroyBody(object.body);

	object.destroyed = true;
	world.ui.destroyed.push(object);
}

function moveAction(world: w.World, hero: w.Hero, action: w.Action, spell: MoveSpell) {
	if (!action.target) { return true; }

	let current = hero.body.getPosition();
	let target = action.target;

	const idealStep = vector.truncate(vector.diff(target, current), hero.moveSpeedPerSecond / TicksPerSecond);
	const facing = vector.fromAngle(hero.body.getAngle());
	const step = vector.multiply(vector.unit(idealStep), vector.dot(idealStep, facing)); // Project onto the direction we're facing

	hero.body.setPosition(vector.plus(hero.body.getPosition(), step));

	hero.strafeIds.forEach(projectileId => {
		const projectile = world.objects.get(projectileId);
		if (projectile) {
			if (projectile.category === "projectile" && projectile.strafe && projectile.owner === hero.id) {
				projectile.body.setPosition(vector.plus(projectile.body.getPosition(), step));
			}
		} else {
			hero.strafeIds.delete(projectileId); // Yes you can delete from a set while iterating in ES6
		}
	});

	return vector.distance(current, target) < constants.Pixel;
}

function spawnProjectileAction(world: w.World, hero: w.Hero, action: w.Action, spell: ProjectileSpell) {
	if (!action.target) { return true; }

	addProjectile(world, hero, action.target, spell, spell.projectile);

	return true;
}

function sprayProjectileAction(world: w.World, hero: w.Hero, action: w.Action, spell: SpraySpell) {
	if (!action.target) { return true; }

	const currentLength = world.tick - hero.casting.channellingStartTick;
	if (currentLength % spell.intervalTicks === 0) {
		const currentAngle = vector.angle(hero.body.getPosition());

		const projectileIndex = Math.floor(currentLength / spell.intervalTicks);
		const numProjectiles = spell.lengthTicks / spell.intervalTicks;
		const newAngle = currentAngle + 2 * Math.PI * projectileIndex / numProjectiles;

		const jitterRadius = vector.distance(hero.body.getPosition(), action.target) * spell.jitterRatio;
		const newTarget = vector.plus(action.target, vector.multiply(vector.fromAngle(newAngle), jitterRadius));

		addProjectile(world, hero, newTarget, spell, spell.projectile);
	}
	return currentLength >= spell.lengthTicks;
}

function teleportAction(world: w.World, hero: w.Hero, action: w.Action, spell: TeleportSpell) {
	if (!action.target) { return true; }

	let currentPosition = hero.body.getPosition();
	let newPosition = vector.towards(currentPosition, action.target, spell.maxRange);
	hero.body.setPosition(newPosition);

	return true;
}

function thrustAction(world: w.World, hero: w.Hero, action: w.Action, spell: ThrustSpell) {
	if (!action.target) { return true; }

	if (world.tick == hero.casting.channellingStartTick) {
		const diff = vector.diff(action.target, hero.body.getPosition());
		const distancePerTick = spell.speed / TicksPerSecond;
		const ticksToTarget = Math.floor(vector.length(diff) / distancePerTick);
		const velocity = vector.multiply(vector.unit(diff), spell.speed);

		let thrust: w.ThrustState = {
			damage: spell.damage,
			velocity,
			ticks: Math.min(spell.maxTicks, ticksToTarget),
			nullified: false,
			alreadyHit: new Set<string>(),
		} as w.ThrustState;
		scaleDamagePacket(thrust, hero, spell.damageScaling);

		hero.thrust = thrust;
	}

	if (hero.thrust && !hero.thrust.nullified) {
		hero.body.setLinearVelocity(hero.thrust.velocity);
	}

	return !hero.thrust;
}

function scourgeAction(world: w.World, hero: w.Hero, action: w.Action, spell: ScourgeSpell) {
	const selfPacket: DamagePacket = { damage: spell.selfDamage };
	const damagePacket: DamagePacket = { damage: spell.damage };
	scaleDamagePacket(damagePacket, hero, spell.damageScaling)

	applyDamage(hero, selfPacket, hero.id, world);

	let heroPos = hero.body.getPosition();
	world.objects.forEach(obj => {
		if (obj.category !== "hero" || obj.id === hero.id) { return; }

		let objPos = obj.body.getPosition();
		let diff = vector.diff(objPos, heroPos);
		let proportion = 1.0 - (vector.length(diff) / (spell.radius + obj.radius)); // +HeroRadius because only need to touch the edge
		if (proportion <= 0.0) { return; } 

		if (obj.category === "hero") {
			applyDamage(obj, damagePacket, hero.id, world);
		}

		let magnitude = spell.minImpulse + proportion * (spell.maxImpulse - spell.minImpulse);
		let impulse = vector.multiply(vector.unit(diff), magnitude);
		obj.body.applyLinearImpulse(impulse, obj.body.getWorldPoint(vector.zero()), true);
	});

	world.ui.events.push({
		heroId: hero.id,
		pos: hero.body.getPosition(),
		type: "scourge",
		radius: spell.radius,
	});

	return true;
}

function wallAction(world: w.World, hero: w.Hero, action: w.Action, spell: WallSpell) {
	const halfWidth = spell.width / 2;
	const halfLength = spell.length / 2;
	let points = [
		pl.Vec2(-halfWidth, -halfLength),
		pl.Vec2(halfWidth, -halfLength),
		pl.Vec2(halfWidth, halfLength),
		pl.Vec2(-halfWidth, halfLength),
	];

	const diff = vector.truncate(vector.diff(action.target, hero.body.getPosition()), spell.maxRange);
	const angle = 0.5 * Math.PI + vector.angle(diff);

	const position = vector.plus(hero.body.getPosition(), diff);
	let obstacle = addObstacle(world, position, angle, points, Math.min(halfWidth, halfLength));

	const health = spell.health;
	obstacle.health = health;
	obstacle.maxHealth = health;
	obstacle.damagePerTick = obstacle.maxHealth / spell.maxTicks;
	obstacle.growthTicks = 5;

	return true;
}

function shieldAction(world: w.World, hero: w.Hero, action: w.Action, spell: ShieldSpell) {
	addShield(world, hero, spell);
	return true;
}

function scaleDamagePacket(packet: DamagePacket, fromHero: w.Hero, damageScaling: boolean = true) {
	let scaleFactor = 1.0;
	if (fromHero && damageScaling) {
		const fromHeroHealth = fromHero ? fromHero.health : 0; // Dead hero has 0 health
		scaleFactor += Math.pow(1.0 - fromHeroHealth / fromHero.maxHealth, fromHero.additionalDamagePower) * fromHero.additionalDamageMultiplier;
	}
	packet.damage *= scaleFactor;

	if (fromHero && fromHero.link && !packet.lifeSteal) {
		packet.lifeSteal = fromHero.link.lifeSteal;
	}
}

function applyDamage(toHero: w.Hero, packet: DamagePacket, fromHeroId: string, world: w.World) {
	// Need to be careful - fromHeroId may still be set, even if fromHero is null, due to the hero being dead
	if (!toHero) { return; }

	if (world.tick < world.startTick) {
		// No damage until game started
		return;
	}

	// Apply damage
	let amount = Math.min(toHero.health, packet.damage);
	toHero.health -= amount;

	// Apply lifesteal
	if (fromHeroId && packet.lifeSteal) {
		const fromHero = world.objects.get(fromHeroId);
		if (fromHero && fromHero.category === "hero") {
			fromHero.health = Math.min(fromHero.maxHealth, fromHero.health + amount * packet.lifeSteal);
			world.ui.events.push({ type: "lifeSteal", owner: fromHero.id });
		}
	}

	// Update scores
	if (fromHeroId && fromHeroId !== toHero.id) {
		const score = world.scores.get(fromHeroId);
		world.scores = world.scores.set(fromHeroId, { ...score, damage: score.damage + amount });
	}
	if (fromHeroId && toHero.killerHeroId !== fromHeroId && fromHeroId !== toHero.id) {
		toHero.assistHeroId = toHero.killerHeroId || toHero.assistHeroId;
		toHero.killerHeroId = fromHeroId;
	}
}

function applyDamageToObstacle(obstacle: w.Obstacle, damage: number, world: w.World) {
	if (world.tick < world.startTick) {
		// No damage until game started
		return;
	}
	obstacle.health = Math.max(0, obstacle.health - damage);
}

export function initScore(heroId: string): w.HeroScore {
	return {
		heroId,
		kills: 0,
		assists: 0,
		damage: 0,
		deathTick: null,
	};
}