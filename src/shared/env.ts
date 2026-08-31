/**
 * Environment access, in one place, so that no script reads `process.env`
 * inline and every default is visible.
 */

const readOptionalEnv = (name: string): string | undefined => {
  const value = process.env[name];

  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
};

/** Reads a variable that the caller cannot work without. */
const readRequiredEnv = (name: string): string => {
  const value = readOptionalEnv(name);

  if (value === undefined) {
    throw new Error(`missing required environment variable ${name}`);
  }

  return value;
};

const readIntegerEnv = (name: string, fallback: number): number => {
  const raw = readOptionalEnv(name);

  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  return Number.isFinite(parsed) ? parsed : fallback;
};

const readBooleanEnv = (name: string, fallback: boolean): boolean => {
  const raw = readOptionalEnv(name)?.toLowerCase();

  if (raw === undefined) {
    return fallback;
  }

  return raw === '1' || raw === 'true' || raw === 'yes';
};

export { readBooleanEnv, readIntegerEnv, readOptionalEnv, readRequiredEnv };
