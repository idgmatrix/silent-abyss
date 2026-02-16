import { describe, expect, it } from 'vitest';
import {
  BehaviorState,
  SimulationEngine,
  SimulationTarget,
  TargetType,
} from '../src/simulation.js';

describe('SimulationTarget math and behavior', () => {
  it('initializes Cartesian position from polar config', () => {
    const target = new SimulationTarget('t1', {
      distance: 10,
      angle: Math.PI / 2,
      speed: 0,
      isPatrolling: false,
    });

    expect(target.x).toBeCloseTo(0, 6);
    expect(target.z).toBeCloseTo(10, 6);
  });

  it('computes bearing in 0-360 with north=0 east=90', () => {
    const east = new SimulationTarget('east', { x: 1, z: 0, speed: 0, isPatrolling: false });
    const south = new SimulationTarget('south', { x: 0, z: 1, speed: 0, isPatrolling: false });
    const west = new SimulationTarget('west', { x: -1, z: 0, speed: 0, isPatrolling: false });
    const north = new SimulationTarget('north', { x: 0, z: -1, speed: 0, isPatrolling: false });

    expect(east.bearing).toBeCloseTo(90, 6);
    expect(south.bearing).toBeCloseTo(180, 6);
    expect(west.bearing).toBeCloseTo(270, 6);
    expect(north.bearing).toBeCloseTo(0, 6);
  });

  it('computes radial velocity sign from course vs line-of-sight angle', () => {
    const target = new SimulationTarget('t2', {
      x: 10,
      z: 0,
      speed: 2,
      course: Math.PI,
      isPatrolling: false,
    });

    expect(target.velocity).toBeCloseTo(-2, 6);
  });

  it('increases acoustic signature with rpm and speed', () => {
    const quiet = new SimulationTarget('quiet', {
      type: TargetType.SHIP,
      rpm: 60,
      speed: 0.2,
      isPatrolling: false,
    });

    const loud = new SimulationTarget('loud', {
      type: TargetType.SHIP,
      rpm: 180,
      speed: 0.8,
      isPatrolling: false,
    });

    expect(loud.getAcousticSignature()).toBeGreaterThan(quiet.getAcousticSignature());
  });

  it('switches behavior states when reacting to ping by target type', () => {
    const submarine = new SimulationTarget('sub', { type: TargetType.SUBMARINE });
    const torpedo = new SimulationTarget('torp', { type: TargetType.TORPEDO });
    const biological = new SimulationTarget('bio', { type: TargetType.BIOLOGICAL });

    submarine.reactToPing();
    torpedo.reactToPing();
    biological.reactToPing();

    expect(submarine.behaviorState).toBe(BehaviorState.EVADE);
    expect(torpedo.behaviorState).toBe(BehaviorState.INTERCEPT);
    expect(biological.behaviorState).toBe(BehaviorState.NORMAL);
  });

  it('applies capped turning rate per update step', () => {
    const target = new SimulationTarget('turn', {
      x: 0,
      z: 0,
      speed: 0,
      course: 0,
      targetCourse: Math.PI,
      turnRate: 1,
      isPatrolling: false,
    });

    target.update(0.5, () => 0.5);

    expect(target.course).toBeCloseTo(0.5, 6);
  });
});

describe('SimulationEngine fixed-step loop', () => {
  it('advances in deterministic fixed ticks', () => {
    const engine = new SimulationEngine(123);
    const target = new SimulationTarget('runner', {
      x: 0,
      z: 0,
      speed: 1,
      course: 0,
      targetCourse: 0,
      turnRate: 0,
      isPatrolling: false,
    });

    let ticks = 0;
    engine.addTarget(target);
    engine.onTick = () => {
      ticks += 1;
    };

    engine.start(100);
    engine.update(1000); // initialize baseline timestamp
    engine.update(1250); // 0.25s elapsed => 2 ticks of 0.1s

    expect(ticks).toBe(2);
    expect(target.x).toBeCloseTo(0.2, 6);
  });
});
