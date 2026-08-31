/**
 * Project-wide structured logger.
 *
 * Every line follows the exact same shape so that GitHub Actions logs stay
 * greppable:
 * `[LEVEL][FileName][functionName][line][HH:mm:ss] message`
 *
 * The file name is derived from the module URL passed to `createLogger`, and
 * the function name and line number are recovered from the call stack, so no
 * call site has to repeat them by hand.
 */

const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
} as const;
type LogLevel = typeof LogLevel[keyof typeof LogLevel];

const LEVEL_SEVERITIES: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 10,
  [LogLevel.INFO]: 20,
  [LogLevel.WARN]: 30,
  [LogLevel.ERROR]: 40,
};

const UNKNOWN_CALL_SITE_MARKER = '?';
const LOGGER_MODULE_MARKER = 'shared/logger.ts';

interface CallSite {
  functionName: string;
  line: string;
}

interface Logger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error: unknown) => void;
}

const FRAME_WITH_FUNCTION_NAME = /^\s*at\s+(?:async\s+)?([^\s(]+)\s+\((?:.*):(\d+):\d+\)\s*$/;
const FRAME_WITHOUT_FUNCTION_NAME = /^\s*at\s+(?:async\s+)?(?:.*):(\d+):\d+\s*$/;

/**
 * Turns a module URL, an absolute path or a bare name into a displayable file
 * name. Anything unusable falls back to the marker rather than throwing.
 */
const toFileName = (moduleSource: string): string => {
  const withoutQuery = moduleSource.split('?')[0] ?? moduleSource;
  const segments = withoutQuery.split('/');
  const lastSegment = segments[segments.length - 1];

  if (lastSegment === undefined || lastSegment.length === 0) {
    return UNKNOWN_CALL_SITE_MARKER;
  }

  return lastSegment;
};

/**
 * Reads a single V8 stack frame. Handles both named frames
 * (`at readFeed (/a/b.ts:12:3)`) and anonymous ones (`at /a/b.ts:12:3`).
 */
const parseStackFrame = (frame: string): CallSite => {
  const namedMatch = FRAME_WITH_FUNCTION_NAME.exec(frame);

  if (namedMatch !== null) {
    const rawName = namedMatch[1] ?? UNKNOWN_CALL_SITE_MARKER;
    const nameSegments = rawName.split('.');
    const lastNameSegment = nameSegments[nameSegments.length - 1];

    return {
      functionName:
        lastNameSegment !== undefined && lastNameSegment.length > 0
          ? lastNameSegment
          : rawName,
      line: namedMatch[2] ?? UNKNOWN_CALL_SITE_MARKER,
    };
  }

  const anonymousMatch = FRAME_WITHOUT_FUNCTION_NAME.exec(frame);

  if (anonymousMatch !== null) {
    return {
      functionName: 'anonymous',
      line: anonymousMatch[1] ?? UNKNOWN_CALL_SITE_MARKER,
    };
  }

  return { functionName: UNKNOWN_CALL_SITE_MARKER, line: UNKNOWN_CALL_SITE_MARKER };
};

/**
 * Finds the first stack frame outside of this module, which is the actual
 * caller of the logger.
 */
const findCallSite = (): CallSite => {
  const stack = new Error().stack;

  if (stack === undefined) {
    return { functionName: UNKNOWN_CALL_SITE_MARKER, line: UNKNOWN_CALL_SITE_MARKER };
  }

  const frames = stack.split('\n').slice(1);

  for (const frame of frames) {
    if (frame.includes(LOGGER_MODULE_MARKER)) {
      continue;
    }

    return parseStackFrame(frame);
  }

  return { functionName: UNKNOWN_CALL_SITE_MARKER, line: UNKNOWN_CALL_SITE_MARKER };
};

/** Formats a timestamp as `HH:mm:ss` in the runner's local time zone. */
const formatTime = (date: Date): string => {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
};

/**
 * Resolves the minimum severity to print, from the `LOG_LEVEL` environment
 * variable. Unknown values fall back to `INFO`.
 */
const resolveThreshold = (): number => {
  const configured = process.env.LOG_LEVEL?.toUpperCase();
  const known = Object.values(LogLevel).find((level) => level === configured);

  return LEVEL_SEVERITIES[known ?? LogLevel.INFO];
};

/** Builds the common `[LEVEL][File][fn][line][HH:mm:ss] message` string. */
const formatLine = (level: LogLevel, fileName: string, message: string): string => {
  const callSite = findCallSite();
  const time = formatTime(new Date());

  return `[${level}][${fileName}][${callSite.functionName}][${callSite.line}][${time}] ${message}`;
};

/**
 * Creates a logger bound to one module.
 *
 * @param moduleSource Usually `import.meta.url`; a bare file name also works.
 */
const createLogger = (moduleSource: string): Logger => {
  const fileName = toFileName(moduleSource);

  const isEnabled = (level: LogLevel): boolean => {
    return LEVEL_SEVERITIES[level] >= resolveThreshold();
  };

  return {
    debug: (message: string): void => {
      if (!isEnabled(LogLevel.DEBUG)) {
        return;
      }

      console.log(formatLine(LogLevel.DEBUG, fileName, message));
    },
    info: (message: string): void => {
      if (!isEnabled(LogLevel.INFO)) {
        return;
      }

      console.log(formatLine(LogLevel.INFO, fileName, message));
    },
    warn: (message: string): void => {
      if (!isEnabled(LogLevel.WARN)) {
        return;
      }

      console.log(formatLine(LogLevel.WARN, fileName, message));
    },
    error: (message: string, error: unknown): void => {
      console.log(formatLine(LogLevel.ERROR, fileName, message), error);
    },
  };
};

export { createLogger, LogLevel };
export type { Logger };
