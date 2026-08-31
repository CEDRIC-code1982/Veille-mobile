import type { Clock } from '../domain/ports/Clock';

/**
 * The only place in the codebase that reads the real clock.
 */
const systemClock: Clock = {
  now: (): Date => new Date(),
};

export { systemClock };
