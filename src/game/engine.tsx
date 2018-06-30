import * as _ from 'lodash';
import pl from 'planck-js';
import * as constants from '../game/constants';
import * as vector from './vector';
import * as w from './world.model';

import { Hero, World, Spells, Obstacle, Categories, Choices, Matchmaking, TicksPerSecond } from '../game/constants';

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

export function initialWorld(): w.World {
	let world = {
		seed: null,
		tick: 0,
		startTick: constants.Matchmaking.MaxHistoryLength,

		occurrences: new Array<w.Occurrence>(),
		activePlayers: new Set<string>(),
		players: new Map<string, w.Player>(),
		scores: new Map<string, w.HeroScore>(),
		winner: null,

		objects: new Map(),
		physics: pl.World(),
		actions: new Map(),
		radius: World.InitialRadius,

		destroyed: [],
		explosions: new Array<w.Explosion>(),

		nextObstacleId: 0,
		nextPositionId: 0,
		nextBulletId: 0,
		nextColorId: 0,

		ui: {
			myGameId: null,
			myHeroId: null,
			trails: [],
			notifications: [],
		} as w.UIState,
	} as w.World;

	return world;
}

export function takeNotifications(world: w.World): w.Notification[] {
	const notifications = world.ui.notifications;
	if (notifications.length > 0) {
		world.ui.notifications = [];
	}
	return notifications;
}

function addObstacle(world: w.World, position: pl.Vec2, angle: number, extent: number, numPoints: number) {
	const obstacleId = "obstacle" + (world.nextObstacleId++);
	const body = world.physics.createBody({
		userData: obstacleId,
		type: 'static',
		position,
		angle,
		linearDamping: Obstacle.LinearDamping,
		angularDamping: Obstacle.AngularDamping,
	});

	let points = new Array<pl.Vec2>();
	for (let i = 0; i < numPoints; ++i) {
		const point = vector.multiply(vector.fromAngle((i / numPoints) * (2 * Math.PI)), extent);
		points.push(point);
	}

	body.createFixture(pl.Polygon(points), {
		filterCategoryBits: Categories.Obstacle,
		filterMaskBits: Categories.All,
		density: Obstacle.Density,
		restitution: 0.0,
	});

	const obstacle: w.Obstacle = {
		id: obstacleId,
		category: "obstacle",
		categories: Categories.Obstacle,
		type: "polygon",
		body,
		extent,
		points,
	};

	world.objects.set(obstacle.id, obstacle);
	return obstacle;
}

function addHero(world: w.World, heroId: string, playerName: string) {
	let position;
	let angle;
	{
		const radius = World.HeroLayoutRadius;
		const center = pl.Vec2(0.5, 0.5);

		const nextHeroIndex = world.nextPositionId++;

		let posAngle = 2 * Math.PI * nextHeroIndex / Matchmaking.MaxPlayers;
		position = vector.plus(vector.multiply(vector.fromAngle(posAngle), radius), center);

		angle = posAngle + Math.PI; // Face inward
	}

	let body = world.physics.createBody({
		userData: heroId,
		type: 'dynamic',
		position,
		angle,
		linearDamping: Hero.MaxDamping,
		angularDamping: Hero.AngularDamping,
		allowSleep: false,
	} as pl.BodyDef);
	body.createFixture(pl.Circle(Hero.Radius), {
		filterCategoryBits: Categories.Hero,
		filterMaskBits: Categories.All,
		density: Hero.Density,
		restitution: 1.0,
	});

	let hero = {
		id: heroId,
		name: playerName,
		category: "hero",
		type: "hero",
		categories: Categories.Hero,
		collideWith: Categories.All,
		health: Hero.MaxHealth,
		body,
		casting: null,
		cooldowns: {},
		hitTick: 0,
		shieldTicks: World.InitialShieldTicks,
		killerHeroId: null,
		assistHeroId: null,
		keysToSpells: new Map<string, string>(),
		spellsToKeys: new Map<string, string>(),
	} as w.Hero;
	world.objects.set(heroId, hero);
	world.scores.set(heroId, initScore(heroId));

	return hero;
}

export function cooldownRemaining(world: w.World, hero: w.Hero, spell: string) {
	let next = hero.cooldowns[spell] || 0;
	return Math.max(0, next - world.tick);
}

function setCooldown(world: w.World, hero: w.Hero, spell: string, waitTime: number) {
	hero.cooldowns[spell] = world.tick + waitTime;
}

function addProjectile(world : w.World, hero : w.Hero, target: pl.Vec2, spell: w.Spell, projectileTemplate: w.ProjectileTemplate) {
	let id = spell.id + (world.nextBulletId++);

	let from = hero.body.getPosition();

	let direction = vector.unit(vector.diff(target, from));
	if (spell.action === "projectile" && spell.fireTowardsCurrentHeading) {
		direction = vector.fromAngle(hero.body.getAngle());
	}

	const offset = Hero.Radius + projectileTemplate.radius + constants.Pixel;
	const position = vector.plus(hero.body.getPosition(), vector.multiply(direction, offset));
	const velocity = vector.multiply(direction, projectileTemplate.speed);
	const diff = vector.diff(target, position);

	const categories = projectileTemplate.categories === undefined ? Categories.Projectile : projectileTemplate.categories;
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

	let targetObj = findNearest(world.objects, target, x => x.type === "hero" && x.id !== hero.id);

	let projectile = {
		id,
		owner: hero.id,
		category: "projectile",
		categories,
		type: spell.id,
		body,
		maxSpeed: projectileTemplate.maxSpeed || null,

		target,
		targetId: targetObj ? targetObj.id : null,
		alreadyHit: new Set<string>(),

		damage: projectileTemplate.damage,
		bounce: projectileTemplate.bounce,
		gravity: projectileTemplate.gravity,

		homing: projectileTemplate.homing && {
			turnRate: projectileTemplate.homing.turnRate,
			maxTurnProportion: projectileTemplate.homing.maxTurnProportion !== undefined ? projectileTemplate.homing.maxTurnProportion : 1.0,
			minDistanceToTarget: projectileTemplate.homing.minDistanceToTarget || 0,
			targetType: projectileTemplate.homing.targetType || w.HomingTargets.enemy,
			redirectionTick: projectileTemplate.homing.redirect ? (world.tick + Math.floor(TicksPerSecond * vector.length(diff) / vector.length(velocity))) : null,
			speedWhenClose: projectileTemplate.homing.speedWhenClose,
		} as w.HomingParameters,
		link: projectileTemplate.link && {
			strength: projectileTemplate.link.strength,
			linkTicks: projectileTemplate.link.linkTicks,
			heroId: null,
		} as w.LinkParameters,
		lifeSteal: projectileTemplate.lifeSteal || 0.0,
		shieldTakesOwnership: projectileTemplate.shieldTakesOwnership !== undefined ? projectileTemplate.shieldTakesOwnership : true,

		createTick: world.tick,
		expireTick: world.tick + projectileTemplate.maxTicks,
		maxTicks: projectileTemplate.maxTicks,
		collideWith,
		explodeOn: projectileTemplate.explodeOn,

		render: projectileTemplate.render,
		color: projectileTemplate.color,
		selfColor: projectileTemplate.selfColor,
		radius: projectileTemplate.radius,
		trailTicks: projectileTemplate.trailTicks,

		uiPreviousPos: vector.clone(position),
	} as w.Projectile;
	world.objects.set(id, projectile);

	return projectile;
}

// Simulator
export function tick(world: w.World) {
	++world.tick;
	world.destroyed = [];
	world.explosions = [];

	handleOccurences(world);
	handleActions(world);

	homingForce(world);
	linkForce(world);
	gravityForce(world);
	updateKnockback(world);

	physicsStep(world);
	for (var contact = world.physics.getContactList(); !!contact; contact = contact.getNext()) {
		handleContact(world, contact);
	}

	applySpeedLimit(world);
	decayShields(world);
	decayThrust(world);
	applyLavaDamage(world);
	shrink(world);

	reap(world);
}

function physicsStep(world: w.World) {
	world.physics.step(1.0 / TicksPerSecond);
}

function applySpeedLimit(world: w.World) {
	world.objects.forEach(obj => {
		if (obj.category === "projectile" && obj.maxSpeed) {
			const currentVelocity = obj.body.getLinearVelocity();
			if (vector.length(currentVelocity) > obj.maxSpeed) {
				obj.body.setLinearVelocity(vector.relengthen(currentVelocity, obj.maxSpeed));
			}
		}
	});
}

function handleOccurences(world: w.World) {
	world.occurrences.forEach(ev => {
		if (ev.type === "join") {
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

	const mapCenter = pl.Vec2(0.5, 0.5);
	const layout = World.Layouts[world.seed % World.Layouts.length];
	layout.obstacles.forEach(obstacleTemplate => {
		for (let i = 0; i < obstacleTemplate.numObstacles; ++i) {
			const proportion = i / obstacleTemplate.numObstacles;
			const baseAngle = proportion * (2 * Math.PI);
			const position = vector.plus(mapCenter, vector.multiply(vector.fromAngle(baseAngle + obstacleTemplate.layoutAngleOffset), obstacleTemplate.layoutRadius));

			const orientationAngle = baseAngle + obstacleTemplate.layoutAngleOffset + obstacleTemplate.orientationAngleOffset;
			addObstacle(world, position, orientationAngle, obstacleTemplate.extent, obstacleTemplate.numPoints);
		}
	});
}

function handleJoining(ev: w.Joining, world: w.World) {
	console.log("Player joined:", ev.heroId);
	let hero = world.objects.get(ev.heroId);
	if (!hero) {
		hero = addHero(world, ev.heroId, ev.playerName);
	} else if (hero.category !== "hero") {
		throw "Player tried to join as non-hero: " + ev.heroId;
	}

	assignKeyBindingsToHero(hero, ev.keyBindings);

	const player = {
		heroId: hero.id,
		name: ev.playerName,
		color: Hero.Colors[world.nextColorId++ % Hero.Colors.length],
	} as w.Player;
	world.players.set(hero.id, player);
	world.activePlayers.add(hero.id);

	world.ui.notifications.push({ type: "join", player });

}

function handleLeaving(ev: w.Leaving, world: w.World) {
	console.log("Player left:", ev.heroId);
	const player = world.players.get(ev.heroId);
	world.activePlayers.delete(ev.heroId);

	if (player) {
		world.ui.notifications.push({ type: "leave", player });
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

function assignKeyBindingsToHero(hero: w.Hero, keyBindings: w.KeyBindings) {
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
	const spell = constants.Spells.all[action.type];

	// Start casting a new spell
	if (!hero.casting || action !== hero.casting.action) {
		hero.casting = { action: action, color: spell.color, stage: w.CastStage.Cooldown };
	}

	const angleDiff = turnTowards(hero, action.target);

	if (hero.casting.stage === w.CastStage.Cooldown) {
		if (spell.cooldown && cooldownRemaining(world, hero, spell.id) > 0) {
			return false; // Cannot perform action, waiting for cooldown
		}
		++hero.casting.stage;
	}

	if (hero.casting.stage === w.CastStage.Orientating) {
		hero.casting.uninterruptible = true;

		if (spell.maxAngleDiff !== undefined && angleDiff > spell.maxAngleDiff) {
			return false; // Wait until are facing the target
		}

		hero.casting.uninterruptible = false;
		++hero.casting.stage;
	}

	if (hero.casting.stage === w.CastStage.Charging) {
		// Entering charging stage
		if (!hero.casting.chargeStartTick) {
			hero.casting.chargeStartTick = world.tick;
			hero.casting.uninterruptible = spell.uninterruptible || false;
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
			hero.casting.uninterruptible = spell.uninterruptible || false;

			if (spell.cooldown) {
				setCooldown(world, hero, spell.id, spell.cooldown);
			}
		}

		const cancelled = spell.knockbackCancel && hero.hitTick > hero.casting.channellingStartTick;
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

	const newAngle = vector.turnTowards(currentAngle, targetAngle, Hero.TurnRate);
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

function applyAction(world: w.World, hero: w.Hero, action: w.Action, spell: w.Spell): boolean {
	switch (spell.action) {
		case "move": return moveAction(world, hero, action, spell);
		case "projectile": return spawnProjectileAction(world, hero, action, spell);
		case "spray": return sprayProjectileAction(world, hero, action, spell);
		case "scourge": return scourgeAction(world, hero, action, spell);
		case "teleport": return teleportAction(world, hero, action, spell);
		case "thrust": return thrustAction(world, hero, action, spell);
		case "shield": return shieldAction(world, hero, action, spell);
	}
}

function handleContact(world: w.World, contact: pl.Contact) {
	if (!contact.isTouching()) {
		return;
	}

	let objA = world.objects.get(contact.getFixtureA().getBody().getUserData());
	let objB = world.objects.get(contact.getFixtureB().getBody().getUserData());
	if (objA && objB) {
		handleCollision(world, objA, objB);
		handleCollision(world, objB, objA);
	}
}

function handleCollision(world: w.World, object: w.WorldObject, hit: w.WorldObject) {
	if (object.category === "projectile") {
		if (hit.category === "hero") {
			handleProjectileHitHero(world, object, hit);
		} else if (hit.category === "projectile") {
			handleProjectileHitProjectile(world, object, hit);
		} else if (hit.category === "obstacle") {
			handleProjectileHitObstacle(world, object, hit);
		}
	} else if (object.category === "hero") {
		if (hit.category === "hero") {
			handleHeroHitHero(world, object, hit);
		} else if (hit.category === "projectile") {
			handleHeroHitProjectile(world, object, hit);
		} else if (hit.category === "obstacle") {
			handleHeroHitObstacle(world, object, hit);
		}
	}
}

function handleHeroHitHero(world: w.World, hero: w.Hero, other: w.Hero) {
	// Push back other heroes
	const pushbackDirection = vector.unit(vector.diff(hero.body.getPosition(), other.body.getPosition()));
	const repelDistance = Hero.Radius * 2 - vector.distance(hero.body.getPosition(), other.body.getPosition());
	if (repelDistance > 0) {
		const step = vector.multiply(pushbackDirection, repelDistance);
		const impulse = vector.multiply(step, Hero.SeparationStrength);
		hero.body.applyLinearImpulse(impulse, hero.body.getWorldPoint(vector.zero()), true);
	}

	// Mark other hero as hit - cancel any channelling
	if (!other.shieldTicks) {
		other.hitTick = world.tick;
	}

	// If using thrust, cause damage
	if (hero.thrust) {
		if (other.shieldTicks) {
			// Thrust into shield means the hero bounces off
			hero.thrust.nullified = true;
		} else {
			if (!hero.thrust.alreadyHit.has(other.id)) {
				hero.thrust.alreadyHit.add(other.id);
				applyDamage(other, Spells.thrust.damage, hero.id, world);
			}
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
		hero.thrust.nullified = true;
	}
}

function handleProjectileHitObstacle(world: w.World, projectile: w.Projectile, obstacle: w.Obstacle) {
	if (projectile.bounce) { // Only bounce off heroes, not projectiles
		bounceToNext(projectile, obstacle, world);
	} else if (projectile.explodeOn & obstacle.categories) {
		destroyObject(world, projectile);
	}
}

function handleProjectileHitProjectile(world: w.World, projectile: w.Projectile, other: w.Projectile) {
	if (projectile.explodeOn & other.categories) {
		destroyObject(world, projectile);
	}
}

function handleProjectileHitHero(world: w.World, projectile: w.Projectile, hero: w.Hero) {
	if (hero.shieldTicks > 0) {
		if (projectile.shieldTakesOwnership && projectile.owner !== hero.id) { // Stop double redirections cancelling out
			// Redirect back to owner
			projectile.targetId = projectile.owner;
			projectile.owner = hero.id;
		}

		projectile.expireTick = world.tick + projectile.maxTicks; // Make the spell last longer when deflected
	} else {
		hero.hitTick = world.tick;

		if (hero.id !== projectile.owner && !projectile.alreadyHit.has(hero.id)) {
			projectile.alreadyHit.add(hero.id);

			const damage = projectile.damage;
			applyDamage(hero, damage, projectile.owner, world);
			lifeSteal(damage, projectile, world);
			linkToHero(projectile, hero, world);
			projectile.hit = true;
		}

		if (projectile.bounce) { // Only bounce off heroes, not projectiles
			bounceToNext(projectile, hero, world);
		} else if (projectile.explodeOn & hero.categories) {
			destroyObject(world, projectile);
		}
	}
}

function lifeSteal(damage: number, projectile: w.Projectile, world: w.World) {
	if (!projectile.lifeSteal) {
		return;
	}

	const owner = world.objects.get(projectile.owner);
	if (owner && owner.category === "hero") {
		owner.health = Math.min(Hero.MaxHealth, owner.health + damage * projectile.lifeSteal);
	}
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


function linkToHero(projectile: w.Projectile, hero: w.WorldObject, world: w.World) {
	if (!projectile.link) {
		return;
	}

	if (projectile.link.heroId) {
		return; // Already linked
	}

	projectile.expireTick = world.tick + projectile.link.linkTicks;
	projectile.link.heroId = hero.id;

	// Destroy fixtures on this link so it stops colliding with things
	let fixturesToDestroy = new Array<pl.Fixture>();
	for (let fixture = projectile.body.getFixtureList(); !!fixture; fixture = fixture.getNext()) {
		fixturesToDestroy.push(fixture);
	}
	fixturesToDestroy.forEach(fixture => projectile.body.destroyFixture(fixture));
}

function bounceToNext(projectile: w.Projectile, hit: w.WorldObject, world: w.World) {
	if (!projectile.bounce) {
		return;
	}

	let nextTarget = findNearest(
		world.objects,
		projectile.body.getPosition(),
		x => !!(x.categories & projectile.collideWith) && x.id !== hit.id);
	if (!nextTarget) {
		return;
	}

	projectile.targetId = nextTarget.id;
	projectile.damage *= projectile.bounce.damageFactor || 1.0;

	let currentSpeed = vector.length(projectile.body.getLinearVelocity());
	let newDirection = vector.unit(vector.diff(nextTarget.body.getPosition(), projectile.body.getPosition()));
	let newVelocity = vector.multiply(newDirection, currentSpeed);
	projectile.body.setLinearVelocity(newVelocity);

	projectile.alreadyHit.clear();
}

function gravityForce(world: w.World) {
	world.objects.forEach(orb => {
		if (!(orb.category === "projectile" && orb.gravity)) {
			return;
		}

		const target = world.objects.get(orb.targetId) || orb;
		world.objects.forEach(other => {
			if (other.id === orb.id || other.type === "gravity") {
				return;
			}

			const towardsOrb = vector.diff(orb.body.getPosition(), other.body.getPosition());
			const distanceTo = vector.length(towardsOrb);
			if (distanceTo >= orb.gravity.radius) {
				return;
			}

			const proportion = Math.pow(1.0 - distanceTo / orb.gravity.radius, orb.gravity.power);
			if (other.category === "hero") {
				const strength = orb.gravity.strength * proportion;

				const impulse = vector.multiply(vector.unit(towardsOrb), strength);
				other.body.applyLinearImpulse(impulse, other.body.getWorldPoint(vector.zero()), true);

				applyDamage(other, orb.damage * proportion, orb.owner, world);

				if (distanceTo <= orb.radius) {
					// If you get hit by the projectile itself, that counts as knockback
					other.hitTick = world.tick;
				}
			} else if (other.category === "projectile") {
				const towardsTarget = vector.diff(target.body.getPosition(), other.body.getPosition());
				const currentVelocity = other.body.getLinearVelocity();
				const currentAngle = vector.angle(currentVelocity);
				const targetAngle = vector.angle(towardsTarget);
				const newAngle = vector.turnTowards(currentAngle, targetAngle, orb.gravity.turnRate * proportion);
				const newVelocity = vector.redirect(currentVelocity, vector.fromAngle(newAngle));
				other.body.setLinearVelocity(newVelocity);
			}
		});
	});
}

function homingForce(world: w.World) {
	world.objects.forEach(obj => {
		if (!(obj.category === "projectile" && obj.homing)) {
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
	const minDistance = Hero.Radius * 2;
	const maxDistance = 0.25;
	world.objects.forEach(obj => {
		if (!(obj.category === "projectile" && obj.link && obj.link.heroId)) {
			return;
		}

		const owner = world.objects.get(obj.owner);
		const target = world.objects.get(obj.link.heroId);
		if (!(owner && target && owner.category === "hero" && target.category === "hero")) {
			return;
		}

		if (owner.shieldTicks > 0 || target.shieldTicks > 0) {
			obj.expireTick = world.tick;
			return;
		}

		const diff = vector.diff(target.body.getPosition(), owner.body.getPosition());
		const distance = vector.length(diff);
		const strength = obj.link.strength * Math.max(0, distance - minDistance) / (maxDistance - minDistance);
		if (strength <= 0) {
			return;
		}

		const toTarget = vector.multiply(vector.unit(diff), strength);
		owner.body.applyLinearImpulse(toTarget, owner.body.getWorldPoint(vector.zero()), true);
		target.body.applyLinearImpulse(vector.negate(toTarget), target.body.getWorldPoint(vector.zero()), true);
	});
}

function decayShields(world: w.World) {
	world.objects.forEach(obj => {
		if (obj.category === "hero" && obj.shieldTicks > 0) {
			--obj.shieldTicks;
		}
	});
}

function decayThrust(world: w.World) {
	world.objects.forEach(obj => {
		if (obj.category === "hero" && obj.thrust) {
			--obj.thrust.ticks;
			if (obj.thrust.ticks <= 0) {
				obj.body.setLinearVelocity(vector.zero());
				obj.thrust = null;
			}
		}
	});
}

function updateKnockback(world: w.World) {
	world.objects.forEach(obj => {
		if (obj.category === "hero") {
			// Damping
			let damping = Hero.MinDamping + (Hero.MaxDamping - Hero.MinDamping) * obj.health / Hero.MaxHealth;
			if (obj.thrust) {
				damping = 0;
			}
			obj.body.setLinearDamping(damping);

			// Mass
			let mass = null;
			if (obj.shieldTicks) {
				mass = Spells.shield.mass;
			}

			if (mass !== obj.massOverride) {
				obj.massOverride = mass;
				if (mass) {
					obj.body.setMassData({ mass, center: vector.zero(), I: 0 });
				} else {
					obj.body.resetMassData();
				}
			}
		}
	});
}

function applyLavaDamage(world: w.World) {
	world.objects.forEach(obj => {
		if (obj.category === "hero") {
			let position = obj.body.getPosition();
			if (vector.distance(position, pl.Vec2(0.5, 0.5)) > world.radius) {
				const damage = world.tick < world.startTick ? World.PreGameLavaDamagePerTick : World.LavaDamagePerTick;
				applyDamage(obj, damage, null, world);
			}
		}
	});
}

function shrink(world: w.World) {
	if (world.activePlayers.size > 1) {
		world.radius = Math.max(0, world.radius - World.ShrinkPerTick);
	}
}

function reap(world: w.World) {
	let heroKilled = false;
	world.objects.forEach(obj => {
		if (obj.category === "hero") {
			if (obj.health <= 0) {
				world.explosions.push({
					pos: obj.body.getPosition(),
					type: w.ExplosionType.HeroDeath,
				});
				destroyObject(world, obj);
				notifyKill(obj, world);
				heroKilled = true;
			}
		} else if (obj.category === "projectile") {
			if (world.tick >= obj.expireTick) {
				destroyObject(world, obj);
			}
			if (obj.hit) {
				notifyHit(obj, world);
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

	world.winner = bestScore.heroId;
	world.ui.notifications.push({
		type: "win",
		winner: world.players.get(bestScore.heroId),
		mostDamage: world.players.get(mostDamage.heroId),
		mostDamageAmount: mostDamage.damage,
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
		score.deathTick = world.tick;
	}
	if (hero.killerHeroId) {
		const score = world.scores.get(hero.killerHeroId);
		++score.kills;
	}
	if (hero.assistHeroId) {
		const score = world.scores.get(hero.assistHeroId);
		++score.assists;
	}
}

function notifyHit(obj: w.Projectile, world: w.World) {
	if (!(obj.hit && obj.owner && obj.type === Spells.fireball.id)) {
		return;
	}

	const score = world.scores.get(obj.owner);
	++score.numFireballsHit;
}

function destroyObject(world: w.World, object: w.WorldObject) {
	world.objects.delete(object.id);
	world.physics.destroyBody(object.body);

	object.destroyed = true;
	world.destroyed.push(object);
}

function moveAction(world: w.World, hero: w.Hero, action: w.Action, spell: w.MoveSpell) {
	if (!action.target) { return true; }

	let current = hero.body.getPosition();
	let target = action.target;

	const idealStep = vector.truncate(vector.diff(target, current), Hero.MoveSpeedPerTick);
	const facing = vector.fromAngle(hero.body.getAngle());
	const step = vector.multiply(vector.unit(idealStep), vector.dot(idealStep, facing)); // Project onto the direction we're facing

	hero.body.setPosition(vector.plus(hero.body.getPosition(), step));

	return vector.distance(current, target) < constants.Pixel;
}

function spawnProjectileAction(world: w.World, hero: w.Hero, action: w.Action, spell: w.ProjectileSpell) {
	if (!action.target) { return true; }

	addProjectile(world, hero, action.target, spell, spell.projectile);

	if (spell.id === Spells.fireball.id) {
		let score = world.scores.get(hero.id);
		++score.numFireballsShot;
	}

	return true;
}

function sprayProjectileAction(world: w.World, hero: w.Hero, action: w.Action, spell: w.SpraySpell) {
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

function teleportAction(world: w.World, hero: w.Hero, action: w.Action, spell: w.TeleportSpell) {
	if (!action.target) { return true; }

	let currentPosition = hero.body.getPosition();
	let newPosition = vector.towards(currentPosition, action.target, Spells.teleport.maxRange);
	hero.body.setPosition(newPosition);

	return true;
}

function thrustAction(world: w.World, hero: w.Hero, action: w.Action, spell: w.ThrustSpell) {
	if (!action.target) { return true; }

	if (world.tick == hero.casting.channellingStartTick) {
		const diff = vector.diff(action.target, hero.body.getPosition());
		const distancePerTick = spell.speed / TicksPerSecond;
		const ticksToTarget = Math.floor(vector.length(diff) / distancePerTick);
		const velocity = vector.multiply(vector.unit(diff), spell.speed);
		hero.thrust = {
			velocity,
			ticks: Math.min(spell.maxTicks, ticksToTarget),
			nullified: false,
			alreadyHit: new Set<string>(),
		};
	}

	if (hero.thrust && !hero.thrust.nullified) {
		hero.body.setLinearVelocity(hero.thrust.velocity);
	}

	return !hero.thrust;
}

function scourgeAction(world: w.World, hero: w.Hero, action: w.Action, spell: w.ScourgeSpell) {
	applyDamage(hero, spell.selfDamage, hero.id, world);

	let heroPos = hero.body.getPosition();
	world.objects.forEach(obj => {
		if (obj.id === hero.id) { return; }

		let objPos = obj.body.getPosition();
		let diff = vector.diff(objPos, heroPos);
		let proportion = 1.0 - (vector.length(diff) / (spell.radius + Hero.Radius)); // +HeroRadius because only need to touch the edge
		if (proportion <= 0.0) { return; } 

		if (obj.category === "hero") {
			applyDamage(obj, spell.damage, hero.id, world);
		}

		let magnitude = spell.minImpulse + proportion * (spell.maxImpulse - spell.minImpulse);
		let impulse = vector.multiply(vector.unit(diff), magnitude);
		obj.body.applyLinearImpulse(impulse, obj.body.getWorldPoint(vector.zero()), true);
	});

	world.explosions.push({
		pos: hero.body.getPosition(),
		type: w.ExplosionType.Scourge,
	});

	return true;
}

function shieldAction(world: w.World, hero: w.Hero, action: w.Action, spell: w.ShieldSpell) {
	hero.shieldTicks = Math.max(hero.shieldTicks || 0, spell.maxTicks);
	return true;
}

function applyDamage(toHero: w.Hero, amount: number, fromHeroId: string, world: w.World) {
	if (world.tick < world.startTick && fromHeroId) {
		// No damage from other heroes until game started
		return;
	}

	if (fromHeroId && fromHeroId !== toHero.id) {
		const score = world.scores.get(fromHeroId);
		score.damage += amount;
	}

	toHero.health -= amount;
	if (fromHeroId && toHero.killerHeroId !== fromHeroId && fromHeroId !== toHero.id) {
		toHero.assistHeroId = toHero.killerHeroId || toHero.assistHeroId;
		toHero.killerHeroId = fromHeroId;
	}
}

export function initScore(heroId: string): w.HeroScore {
	return {
		heroId,
		kills: 0,
		assists: 0,
		damage: 0,
		numFireballsShot: 0,
		numFireballsHit: 0,
		deathTick: null,
	};
}