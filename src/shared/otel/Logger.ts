import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import type { Logger as OtelLogger } from '@opentelemetry/api-logs';
import type { ECSGameWorld } from '../ECSGameWorld';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

const SEVERITY_MAP: Record<LogLevel, SeverityNumber> = {
  [LogLevel.DEBUG]: SeverityNumber.DEBUG,
  [LogLevel.INFO]: SeverityNumber.INFO,
  [LogLevel.WARN]: SeverityNumber.WARN,
  [LogLevel.ERROR]: SeverityNumber.ERROR,
  [LogLevel.NONE]: SeverityNumber.TRACE,
};

const CONSOLE_MAP: Record<LogLevel, 'debug' | 'info' | 'log' | 'warn' | 'error'> = {
  [LogLevel.DEBUG]: 'debug',
  [LogLevel.INFO]: 'info',
  [LogLevel.WARN]: 'warn',
  [LogLevel.ERROR]: 'error',
  [LogLevel.NONE]: 'log',
};

function toAttributes(val: unknown): Record<string, unknown> {
  if (typeof val === 'object' && val !== null && !(val instanceof Error)) {
    return val as Record<string, unknown>;
  }
  return {};
}

export class Logger {
  private static globalLevel: LogLevel = LogLevel.DEBUG;
  private tag: string;
  private attributes: Record<string, unknown>;
  private otelLogger: OtelLogger;

  constructor(tag: string, attributes?: Record<string, unknown>) {
    this.tag = tag;
    this.attributes = attributes ?? {};
    this.otelLogger = logs.getLogger('tron-zero');
  }

  static setLevel(level: LogLevel): void {
    Logger.globalLevel = level;
  }

  static getLevel(): LogLevel {
    return Logger.globalLevel;
  }

  private emit(level: LogLevel, args: unknown[]): void {
    const firstArg = args[0];
    const body = typeof firstArg === 'string' ? firstArg : '';
    const callAttrs = args.length > 1 ? toAttributes(args[1]) : {};

    this.otelLogger.emit({
      severityNumber: SEVERITY_MAP[level],
      body,
      attributes: { tag: this.tag, ...this.attributes, ...callAttrs },
    });

    const consoleLevel = level > LogLevel.NONE ? LogLevel.NONE : level;
    if (Logger.globalLevel <= consoleLevel) {
      const method = CONSOLE_MAP[consoleLevel as keyof typeof CONSOLE_MAP];
      console[method](`[${this.tag}]`, ...args);
    }
  }

  debug(...args: unknown[]): void {
    this.emit(LogLevel.DEBUG, args);
  }

  info(...args: unknown[]): void {
    this.emit(LogLevel.INFO, args);
  }

  log(...args: unknown[]): void {
    this.emit(LogLevel.INFO, args);
  }

  warn(...args: unknown[]): void {
    this.emit(LogLevel.WARN, args);
  }

  error(...args: unknown[]): void {
    this.emit(LogLevel.ERROR, args);
  }
}

export class TickLogger extends Logger {
  private world: ECSGameWorld;

  constructor(tag: string, world: ECSGameWorld, attributes?: Record<string, unknown>) {
    super(tag, attributes);
    this.world = world;
  }

  private prefixArgs(args: unknown[]): unknown[] {
    return [`[tick:${this.world.tick}]`, ...args];
  }

  debug(...args: unknown[]): void {
    super.debug(...this.prefixArgs(args));
  }

  info(...args: unknown[]): void {
    super.info(...this.prefixArgs(args));
  }

  log(...args: unknown[]): void {
    super.log(...this.prefixArgs(args));
  }

  warn(...args: unknown[]): void {
    super.warn(...this.prefixArgs(args));
  }

  error(...args: unknown[]): void {
    super.error(...this.prefixArgs(args));
  }
}
