/**
 * Time as a dependency. Nothing in the domain reads the system clock directly,
 * which is what keeps the use cases testable and the repository free of any
 * hard-coded date.
 */
interface Clock {
  now: () => Date;
}

export type { Clock };
