import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Floor } from '../../../mock/floor';

const UNIT = 'A-1042';
let floor: Floor;
let release: ReturnType<typeof vi.fn>;
let arrive: ReturnType<typeof vi.fn>;

beforeEach(() => {
  floor = new Floor();
  release = vi.fn(async () => undefined);
  arrive = vi.fn(async () => undefined);
});

describe('Floor', () => {
  it('holds an offered unit until a receiver expects it', async () => {
    await floor.offer(UNIT, 'edge-01', release);
    expect(floor.holder(UNIT)).toBe('edge-01');
    expect(release).not.toHaveBeenCalled();
  });

  it('moves the unit when the receiver expects it from its holder', async () => {
    await floor.offer(UNIT, 'edge-01', release);
    await floor.expect(UNIT, 'edge-01', 'mount-01', arrive);
    expect(release).toHaveBeenCalledWith('mount-01');
    expect(arrive).toHaveBeenCalledTimes(1);
    expect(release.mock.invocationCallOrder[0]).toBeLessThan(arrive.mock.invocationCallOrder[0]);
    expect(floor.holder(UNIT)).toBeUndefined();
  });

  it('moves the unit when the offer comes after the receiver is waiting', async () => {
    await floor.expect(UNIT, 'edge-01', 'mount-01', arrive);
    expect(arrive).not.toHaveBeenCalled();
    await floor.offer(UNIT, 'edge-01', release);
    expect(arrive).toHaveBeenCalledTimes(1);
  });

  it('keeps the unit when the receiver expects it from another station', async () => {
    await floor.offer(UNIT, 'edge-01', release);
    await floor.expect(UNIT, 'mount-01', 'inspect-01', arrive);
    expect(release).not.toHaveBeenCalled();
    expect(floor.holder(UNIT)).toBe('edge-01');
  });

  it('moves each unit once', async () => {
    await floor.offer(UNIT, 'edge-01', release);
    await floor.expect(UNIT, 'edge-01', 'mount-01', arrive);
    await floor.offer(UNIT, 'edge-01', release);
    expect(arrive).toHaveBeenCalledTimes(1);
    expect(floor.holder(UNIT)).toBe('edge-01');
  });

  it('forgets a receiver whose job is gone', async () => {
    await floor.expect(UNIT, 'edge-01', 'mount-01', arrive);
    floor.forget(UNIT, 'mount-01');
    await floor.offer(UNIT, 'edge-01', release);
    expect(arrive).not.toHaveBeenCalled();
  });

  it('keeps a receiver when another station forgets the unit', async () => {
    await floor.expect(UNIT, 'edge-01', 'mount-01', arrive);
    floor.forget(UNIT, 'inspect-01');
    await floor.offer(UNIT, 'edge-01', release);
    expect(arrive).toHaveBeenCalledTimes(1);
  });
});
