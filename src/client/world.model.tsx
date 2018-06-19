import pl from 'planck-js';
import * as c from '../game/constants.model';

export interface World {
	tick: number;

	activePlayers: Set<string>;
	players: Map<string, Player>;

	objects: Map<string, WorldObject>,
	destroyed: WorldObject[];

	physics: pl.World;
	collisions: Collision[];

	radius: number;

	joinLeaveEvents: JoinOrLeaveEvent[];
	actions: Map<string, Action>,

	nextPositionId: number;
	nextBulletId: number;
	nextColorId: number;
	
	ui: UIState; // Temporary data which is visual-only and does not need to sync
};

export interface UIState {
	myGameId: string | null;
	myHeroId: string | null;

	trails: Trail[];

	notifications: Notification[];
}

export interface Player {
	heroId: string;
	name: string;
	color: string;
}

export type Notification = JoinNotification | LeaveNotification | KillNotification | MyHeroNotification;

export interface JoinNotification {
	type: "join";
	player: Player;
}

export interface LeaveNotification {
	type: "leave";
	player: Player;
}

export interface KillNotification {
	type: "kill";
	killed: Player;
	killer: Player | null;
	assist: Player | null;
}

export interface MyHeroNotification {
	type: "myHero";
	gameId: string;
	heroId: string;
}

export type JoinOrLeaveEvent = JoinEvent | LeaveEvent;

export interface JoinEvent {
	type: "join";
	heroId: string;
	playerName: string;
}

export interface LeaveEvent {
	type: "leave";
	heroId: string;
}

export interface WorldObjectBase {
	id: string;
	category: string;
	type: string;
	bullet?: boolean;
	body: pl.Body;
	destroyed?: boolean;
	step?: pl.Vec2;
}

export interface Hero extends WorldObjectBase {
	category: "hero";
	type: "hero";

	health: number;
	body: pl.Body;
	charging: Charging | null;
	cooldowns: Cooldowns;
	shieldTicks: number;

	killerHeroId: string | null;
	assistHeroId: string | null;
}

export interface Charging {
	action: Action;
	proportion: number;
	spell: string;
}

export interface Cooldowns {
	[spellId: string]: number;
}

export interface Projectile extends WorldObjectBase {
	category: "projectile";

	owner: string;
	body: pl.Body;

	targetId: string | null;
	damage: number;
	bounce?: c.BounceParameters;
	turnRate: number;

	expireTick: number;
	maxTicks: number;
	explodeOn: number;

	render: string;
    radius: number;
    color: string;
    trailTicks: number;

	uiPreviousPos: pl.Vec2; // is only used for the UI and not guaranteed to be sync'd across clients!
}

export type WorldObject = Hero | Projectile;

export interface Action {
	type: string;
	target?: pl.Vec2;
}

export type Trail = CircleTrail | LineTrail;

export interface TrailBase {
	remaining: number;
	max: number;
	fillStyle: string;
}

export interface CircleTrail extends TrailBase {
	type: "circle";
	pos: pl.Vec2;
	radius: number;
}

export interface LineTrail extends TrailBase {
	type: "line";
	from: pl.Vec2;
	to: pl.Vec2;
	width: number;
}

export interface Collision {
	object: WorldObject;
	other: WorldObject;
}