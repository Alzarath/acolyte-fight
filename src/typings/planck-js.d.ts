declare module "planck-js" {
    namespace PlanckJs {
        interface World {
            createBody(bodyDef: BodyDef): Body;
            destroyBody(body: Body): void;
            on(eventName: string, callback : any): void;
            step(timeSpan: number): void;
        }

        interface Body {
            createFixture(polygon: Polygon, fixtureDef: FixtureDef): void;
            getPosition(): Vec2;
            setPosition(pos: Vec2): void;
            getLinearVelocity(): Vec2;
            setLinearVelocity(velocity: Vec2): void;
            setLinearDamping(damping: number): void;
            applyLinearImpulse(impulse: Vec2, center: Vec2, unknown?: boolean): void;
            setMassData(massData: MassData): void;
            resetMassData(): void;
            getUserData(): any;
        }

        interface BodyDef {

        }

        interface MassData {
            mass: number;
            center: Vec2;
            I: number;
        }

        interface Fixture {
            getBody(): Body;
        }

        interface FixtureDef {

        }

        interface Polygon {

        }

        interface Vec2 {
            x: number;
            y: number;
        }

        interface Contact {
            isTouching(): boolean;
            getFixtureA(): Fixture;
            getFixtureB(): Fixture;
        }

        function Circle(radius: number): Polygon;
        function Vec2(x: number, y: number): Vec2;
        function World(): World;
    }

    export = PlanckJs;
}