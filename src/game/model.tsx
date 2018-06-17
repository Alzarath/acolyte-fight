import pl from 'planck-js';
import * as vector from './vector';

import * as Icons from './icons';
import { TicksPerSecond } from './constants';

export const HeroColors = [
	"#bfad8f",
	"#7db37d",
	"#d0c16b",
	"#6d89cc",
	"#cb8fc1",
	"#56b5bf",
	"#a69a7c",
	"#557e6c",
	"#a18e4c",
	"#41569e",
	"#9d6d95",
	"#2bafca",
];

export const MoveSpeedPerTick = 0.12 / TicksPerSecond;
export const HeroRadius = 0.01;
export const HeroDensity = 1;
export const HeroMaxDamping = 5;
export const HeroMinDamping = 0.25;
export const HeroMaxHealth = 100;

export const AllCategories = 0xFFFF;
export const HeroCategory = 1;
export const ProjectileCategory = 2;

export const LavaDamagePerTick = 0.25;
export const ShrinkPerTick = 0.00005;

export const Pixel = 0.001;

export const Spells = {
	move: {
		id: 'move',
		cooldown: 0,
		action: moveAction,
	},
	fireball: {
		id: 'fireball',
		density: 25,
		radius: 0.005,
		speed: 0.4,
		chargeTicks: 0,
		maxTicks: 1 * TicksPerSecond,
		cooldown: 1 * TicksPerSecond,
		damage: 10,
		explodesOnImpact: true,

		key: 'q',
		icon: Icons.thunderball,

		trailTicks: 30,
		fillStyle: '#ff8800',

		action: spawnProjectileAction,
		render: "projectile",
	},
	meteor: {
		id: 'meteor',
		density: 10000,
		radius: 0.03,
		speed: 0.2,
		chargeTicks: 0.1 * TicksPerSecond,
		maxTicks: 12 * TicksPerSecond,
		cooldown: 12 * TicksPerSecond,
		damage: 1,

		key: 'r',
		icon: Icons.meteorImpact,

		trailTicks: 15,
		fillStyle: '#ff0000',

		action: spawnProjectileAction,
		render: "projectile",
	},
	lightning: {
		id: 'lightning',
		density: 3,
		radius: 0.0025,
		speed: 3.0,
		chargeTicks: 0,
		maxTicks: 0.5 * TicksPerSecond,
		cooldown: 10 * TicksPerSecond,
		damage: 1,
		explodesOnImpact: true,

		key: 'w',
		icon: Icons.lightningHelix,

		trailTicks: 30,
		fillStyle: '#00ddff',

		action: spawnProjectileAction,
		render: "ray",
	},
	homing: {
		id: 'homing',
		density: 25,
		radius: 0.003,
		speed: 0.15,
		chargeTicks: 0,
		maxTicks: 6.0 * TicksPerSecond,
		cooldown: 20 * TicksPerSecond,
		damage: 20,
		turnRate: 0.05,
		explodesOnImpact: true,

		key: 'e',
		icon: Icons.boltSaw,

		trailTicks: 30,
		fillStyle: '#44ffcc',

		action: spawnProjectileAction,
		render: "projectile",
	},
	bouncer: {
		id: 'bouncer',
		density: 2,
		radius: 0.001,
		speed: 0.75,
		chargeTicks: 0,
		maxTicks: 3.0 * TicksPerSecond,
		cooldown: 10 * TicksPerSecond,
		damage: 2,
		turnRate: 0.025,
		explodesOnImpact: true,
		bounceDamage: 0.95,

		key: 'd',
		icon: Icons.divert,

		trailTicks: 1.0 * TicksPerSecond,
		fillStyle: '#88ee22',

		action: spawnProjectileAction,
		render: "ray",
	},
	scourge: {
		id: 'scourge',
		radius: HeroRadius * 5,
		chargeTicks: 0.5 * TicksPerSecond,
		maxTicks: 1,
		cooldown: 10 * TicksPerSecond,
		damage: 20,
		selfDamage: 10,
		minImpulseMagnitude: 0.0002,
		maxImpulseMagnitude: 0.0005,

		key: 'f',
		icon: Icons.deadlyStrike,

		trailTicks: 30,
		fillStyle: '#ddbb00',

		action: scourgeAction,
	},
	shield: {
		id: 'shield',
		mass: 100000,
		chargeTicks: 0,
		maxTicks: 1 * TicksPerSecond,
		cooldown: 20 * TicksPerSecond,
		radius: HeroRadius * 2,

		key: 'x',
		icon: Icons.shield,

		fillStyle: '#3366ff',

		action: shieldAction,
	},
	teleport: {
		id: 'teleport',
		maxRange: 0.35,
		chargeTicks: 3,
		cooldown: 15 * TicksPerSecond,

		key: 'z',
		icon: Icons.teleport,

		fillStyle: '#6666ff',

		action: teleportAction,
	},
};

export let world = {
	tick: 0,

	numPlayers: 0,
	joining: [],
	leaving: [],
	activePlayers: new Set(),

	objects: new Map(),
	physics: pl.World(),
	actions: new Map(),
	radius: 0.4,

	collisions: [],
	destroyed: [],

	nextHeroId: 0,
	nextBulletId: 0,

	trails: [],
	ui: {
		myGameId: null,
		myHeroId: null,
	}
};
world.physics.on('post-solve', onCollision);

// Model
function nextHeroPosition(world) {
	let nextHeroIndex = world.numPlayers;
	let numHeroes = world.numPlayers + 1;
	let radius = 0.25;
	let center = new pl.Vec2(0.5, 0.5);

	let angle = 2 * Math.PI * nextHeroIndex / numHeroes;
	let pos = vector.plus(vector.multiply(pl.Vec2(Math.cos(angle), Math.sin(angle)), radius), center);
	return pos;
}

function addHero(world, position, heroId) {
	let body = world.physics.createBody({
		userData: heroId,
		type: 'dynamic',
		position,
		linearDamping: HeroMaxDamping,
	});
	body.createFixture(pl.Circle(HeroRadius), {
		filterCategoryBits: HeroCategory,
		density: HeroDensity,
		restitution: 0.1,
	});

	let hero = {
		id: heroId,
		type: "hero",
		health: HeroMaxHealth,
		body,
		charging: {},
		cooldowns: {},
		fillStyle: HeroColors[world.numPlayers % HeroColors.length],
	};
	world.objects.set(heroId, hero);

	++world.numPlayers;

	return hero;
}

function deactivateHero(world, heroId) {
	world.objects.forEach(obj => {
		if (obj.type === "hero" && obj.id === heroId) {
			obj.fillStyle = '#666666';
		}
	});
}

export function cooldownRemaining(world, hero, spell) {
	let next = hero.cooldowns[spell] || 0;
	return Math.max(0, next - world.tick);
}

function setCooldown(world, hero, spell, waitTime) {
	hero.cooldowns[spell] = world.tick + waitTime;
}

function addProjectile(world, hero, target, spell) {
	let id = spell.id + (world.nextBulletId++);

	let from = hero.body.getPosition();
	let position = vector.towards(from, target, HeroRadius + spell.radius + Pixel);
	let velocity = vector.direction(target, from, spell.speed);

	let body = world.physics.createBody({
		userData: id,
		type: 'dynamic',
		position,
		linearVelocity: velocity,
		linearDamping: 0,
		bullet: true,
	});
	body.createFixture(pl.Circle(spell.radius), {
		filterCategoryBits: ProjectileCategory,
		filterMaskBits: AllCategories ^ (spell.passthrough ? ProjectileCategory : 0),
		density: spell.density,
		restitution: 1.0,
	});

	let enemy = findNearest(world.objects, target, x => x.type === "hero" && x.id !== hero.id);

	let projectile = {
		id,
		owner: hero.id,
		type: spell.id,
		body,
		uiPreviousPos: vector.clone(position), // uiPreviousPos is only used for the UI and not guaranteed to be sync'd across clients!
		expireTick: world.tick + spell.maxTicks,
		bullet: true,
		targetId: enemy ? enemy.id : null,
	};
	world.objects.set(id, projectile);

	return projectile;
}

// Simulator
export function tick(world) {
	++world.tick;
	world.destroyed = [];

	handlePlayerJoinLeave(world);

	let newActions = new Map();
	world.objects.forEach(hero => {
		if (hero.type !== "hero") { return; }
		let action = world.actions.get(hero.id);
		let completed = performHeroActions(world, hero, action);
		if (action && !completed) {
			newActions.set(hero.id, action);
		}
	});
	world.actions = newActions;

	physicsStep(world);

	if (world.collisions.length > 0) {
		handleCollisions(world, world.collisions);
	}
	world.collisions = [];

	homingForce(world);
	decayShields(world);
	applyLavaDamage(world);
	shrink(world);
	updateKnockback(world);

	reap(world);
}

function physicsStep(world) {
	world.objects.forEach(obj => {
		if (obj.step) {
			obj.body.setLinearVelocity(vector.plus(obj.body.getLinearVelocity(), obj.step));
		}
	});

	world.physics.step(1.0 / TicksPerSecond);

	world.objects.forEach(obj => {
		if (obj.step) {
			obj.body.setLinearVelocity(vector.diff(obj.step, obj.body.getLinearVelocity())); // Why is this backwards? I don't know, but it works.
			obj.step = null;
		}
	});
}

function handlePlayerJoinLeave(world) {
	if (world.joining.length > 0) {
		world.joining.forEach(heroId => {
			console.log("Player joined:", heroId);
			let hero = find(world.objects, x => x.id === heroId);
			if (!hero) {
				hero = addHero(world, nextHeroPosition(world), heroId);
			}
			world.activePlayers.add(heroId);
		});
		world.joining = [];
	}

	if (world.leaving.length > 0) {
		world.leaving.forEach(heroId => {
			console.log("Player left:", heroId);
			world.activePlayers.delete(heroId);
		});
		world.leaving = [];
	}
}

function performHeroActions(world, hero, nextAction) {
	if (hero.charging && hero.charging.action) {
		let chargingAction = hero.charging.action;
		let chargingSpell = Spells[chargingAction.type];
		hero.charging.proportion += 1.0 / chargingSpell.chargeTicks;
		if (hero.charging.proportion < 1.0) {
			return false; // Blocked charging, cannot perform action
		} else {
			hero.charging = {};
			applyAction(world, hero, chargingAction, chargingSpell);
			return false; // Cannot perform new action, handling charging action
		}
	} else if (!nextAction) {
		// Nothing to do
		return true;
	} else {
		let nextSpell = Spells[nextAction.type];
		if (!nextAction) {
			return true;
		}

		if (nextSpell.cooldown) {
			if (cooldownRemaining(world, hero, nextSpell.id) > 0) {
				return false; // Cannot perform action, waiting for cooldown
			}
		}

		if (nextSpell.chargeTicks > 0) {
			hero.charging = { spell: nextSpell.id, proportion: 0.0, action: nextAction };
			return true; // Action now charging
		} else {
			return applyAction(world, hero, nextAction, nextSpell); // Performed action immediately without charging
		}
	}
}

function applyAction(world, hero, action, spell) {
	if (spell.cooldown) {
		setCooldown(world, hero, spell.id, spell.cooldown);
	}

	return spell.action(world, hero, action, spell);
}

function onCollision(contact) {
	let objA = world.objects.get(contact.getFixtureA().getBody().getUserData());
	let objB = world.objects.get(contact.getFixtureB().getBody().getUserData());
	if (objA.type === "hero" && objB.bullet) {
		world.collisions.push({ hero: objA, projectile: objB });
	} else if (objA.bullet && objB.type === "hero") {
		world.collisions.push({ hero: objB, projectile: objA });
	} else if (objA.bullet && objB.bullet) {
		world.collisions.push({ projectile: objA, other: objB });
		world.collisions.push({ projectile: objB, other: objA });
	}
}

function handleCollisions(world, collision) {
	world.collisions.forEach(collision => {
		if (collision.projectile) {
			let spell = Spells[collision.projectile.type];
			if (collision.hero && collision.hero.shieldTicks > 0) {
				let heroPos = collision.hero.body.getPosition();
				let currentPos = collision.projectile.body.getPosition();
				let currentVelocity = collision.projectile.body.getLinearVelocity();
				let speed = spell.speed || vector.length(currentVelocity); // Return to initial speed because collision will absorb speed
				let newVelocity = vector.multiply(vector.unit(vector.diff(currentPos, heroPos)), speed);
				collision.projectile.body.setLinearVelocity(newVelocity);

				if (spell.maxTicks) {
					collision.projectile.expireTick = world.tick + spell.maxTicks; // Make the spell last longer
				}

				if (collision.projectile.owner !== collision.hero.id) { // Stop double redirections cancelling out
					// Redirect back to owner
					collision.projectile.targetId = collision.projectile.owner;
					collision.projectile.owner = collision.hero.id;
				}
			} else {
				if (collision.hero && !(collision.hero.id == collision.projectile.owner) && !collision.hero.shield) {
					collision.hero.health -= spell.damage * (collision.projectile.damageMultiplier || 1.0);
				}
				if (spell.bounceDamage && collision.hero) { // Only bounce off heroes, not projectiles
					bounceToNext(collision.projectile, collision.hero || collision.other, spell, world);
				} else if (spell.explodesOnImpact) {
					destroyObject(world, collision.projectile);
				}
			}
		}
	});
}

function find(objects, predicate) {
	let found = null;
	objects.forEach(x => {
		if (predicate(x)) {
			found = x;
		}
	});
	return found;
}

function findNearest(objects, target, predicate) {
	let nearestDistance = Infinity;
	let nearest = null;
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

function bounceToNext(projectile, hit, spell, world) {
	let nextTarget = findNearest(
		world.objects,
		projectile.body.getPosition(),
		x => x.type === "hero" && x.id !== hit.id);
	if (!nextTarget) {
		return;
	}

	projectile.targetId = nextTarget.id;

	let newDirection = vector.unit(vector.diff(nextTarget.body.getPosition(), projectile.body.getPosition()));
	let newVelocity = vector.multiply(newDirection, spell.speed);
	projectile.body.setLinearVelocity(newVelocity);

	projectile.damageMultiplier = (projectile.damageMultiplier || 1.0) * spell.bounceDamage;
}

function homingForce(world) {
	world.objects.forEach(obj => {
		if (!(obj.bullet && obj.targetId)) {
			return;
		}

		let spell = Spells[obj.type];
		if (!(spell && spell.turnRate)) {
			return;
		}

		let target = find(world.objects, x => x.id === obj.targetId);
		if (target) {
			let currentSpeed = vector.length(obj.body.getLinearVelocity());
			let currentDirection = vector.unit(obj.body.getLinearVelocity());
			let idealDirection = vector.unit(vector.diff(target.body.getPosition(), obj.body.getPosition()));
			let newDirection = vector.unit(vector.plus(currentDirection, vector.multiply(idealDirection, spell.turnRate)));
			let newVelocity = vector.multiply(newDirection, currentSpeed);
			obj.body.setLinearVelocity(newVelocity);
		}
	});
}

function decayShields(world) {
	world.objects.forEach(obj => {
		if (obj.type === "hero" && obj.shieldTicks > 0) {
			--obj.shieldTicks;
			if (obj.shieldTicks === 0) {
				obj.body.resetMassData();
			}
		}
	});
}

function updateKnockback(world) {
	world.objects.forEach(obj => {
		if (obj.type === "hero") {
			let damping = HeroMinDamping + (HeroMaxDamping - HeroMinDamping) * obj.health / HeroMaxHealth;
			obj.body.setLinearDamping(damping);
		}
	});
}

function applyLavaDamage(world) {
	world.objects.forEach(obj => {
		if (obj.type === "hero") {
			let position = obj.body.getPosition();
			if (vector.distance(position, pl.Vec2(0.5, 0.5)) > world.radius) {
				obj.health -= LavaDamagePerTick;
			}
		}
	});
}

function shrink(world) {
	if (world.activePlayers.size > 1) {
		world.radius = Math.max(0, world.radius - ShrinkPerTick);
	}
}

function reap(world) {
	world.objects.forEach(obj => {
		if (obj.type === "hero") {
			if (obj.health <= 0) {
				destroyObject(world, obj);
			}
		} else if (obj.bullet) {
			let pos = obj.body.getPosition();
			if (world.tick >= obj.expireTick || pos.x < 0 || pos.x > 1 || pos.y < 0 || pos.y > 1) {
				destroyObject(world, obj);
			}
		}
	});
}

function destroyObject(world, object) {
	world.objects.delete(object.id);
	world.physics.destroyBody(object.body);

	object.destroyed = true;
	world.destroyed.push(object);
}

function moveAction(world, hero, action, spell) {
	let current = hero.body.getPosition();
	let target = action.target;
	hero.step = vector.multiply(vector.truncate(vector.diff(target, current), MoveSpeedPerTick), TicksPerSecond);

	return vector.distance(current, target) < Pixel;
}

function spawnProjectileAction(world, hero, action, spell) {
	addProjectile(world, hero, action.target, spell);
	return true;
}

function teleportAction(world, hero, action, spell) {
	let currentPosition = hero.body.getPosition();
	let newPosition = vector.towards(currentPosition, action.target, Spells.teleport.maxRange);
	hero.body.setPosition(newPosition);
	return true;
}

function scourgeAction(world, hero, action, spell) {
	hero.health -= spell.selfDamage;

	let heroPos = hero.body.getPosition();
	world.objects.forEach(obj => {
		if (obj.id === hero.id) { return; }

		let objPos = obj.body.getPosition();
		let diff = vector.diff(objPos, heroPos);
		let proportion = 1.0 - (vector.length(diff) / (spell.radius + HeroRadius)); // +HeroRadius because only need to touch the edge
		if (proportion <= 0.0) { return; } 

		if (obj.type === "hero") {
			obj.health -= spell.damage;
		}

		let magnitude = spell.minImpulseMagnitude + proportion * (spell.maxImpulseMagnitude - spell.minImpulseMagnitude);
		let impulse = vector.multiply(vector.unit(diff), magnitude);
		obj.body.applyLinearImpulse(impulse, vector.zero(), true);
	});

	world.trails.push({
		type: "circle",
		remaining: spell.trailTicks,
		max: spell.trailTicks, 
		pos: vector.clone(hero.body.getPosition()),
		fillStyle: 'white',
		radius: spell.radius,
	});

	return true;
}

function shieldAction(world, hero, action, spell) {
	hero.shieldTicks = spell.maxTicks;
	hero.body.setMassData({
		mass: Spells.shield.mass,
		center: vector.zero(),
		I: 0,
	});

	return true;
}

