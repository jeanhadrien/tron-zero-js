import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import type { Logger as OtelLogger } from '@opentelemetry/api-logs';
import type { ECSGameRoom } from '../ECSGameRoom';

export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
  None = 4,
}

function parseEnvLevel(): LogLevel {
  const raw =
    (typeof process !== 'undefined' && process.env?.LOG_LEVEL) ||
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_LOG_LEVEL) ||
    '';
  const key = raw.toUpperCase();
  if (key in LogLevel) return LogLevel[key as keyof typeof LogLevel];
  return LogLevel.Info;
}

const SEVERITY_MAP: Record<LogLevel, SeverityNumber> = {
  [LogLevel.Debug]: SeverityNumber.DEBUG,
  [LogLevel.Info]: SeverityNumber.INFO,
  [LogLevel.Warn]: SeverityNumber.WARN,
  [LogLevel.Error]: SeverityNumber.ERROR,
  [LogLevel.None]: SeverityNumber.TRACE,
};

const CONSOLE_MAP: Record<LogLevel, 'debug' | 'info' | 'log' | 'warn' | 'error'> = {
  [LogLevel.Debug]: 'debug',
  [LogLevel.Info]: 'info',
  [LogLevel.Warn]: 'warn',
  [LogLevel.Error]: 'error',
  [LogLevel.None]: 'log',
};

function toAttributes(val: unknown): Record<string, unknown> {
  if (typeof val === 'object' && val !== null && !(val instanceof Error)) {
    return val as Record<string, unknown>;
  }
  return {};
}

export class Logger {
  private static globalLevel: LogLevel = parseEnvLevel();
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
    if (Logger.globalLevel > level) return;

    const firstArg = args[0];
    const body = typeof firstArg === 'string' ? firstArg : '';
    const callAttrs = args.length > 1 ? toAttributes(args[1]) : {};

    this.otelLogger.emit({
      severityNumber: SEVERITY_MAP[level],
      body,
      attributes: { tag: this.tag, ...this.attributes, ...callAttrs },
    });

    const consoleLevel = level > LogLevel.None ? LogLevel.None : level;
    const method = CONSOLE_MAP[consoleLevel as keyof typeof CONSOLE_MAP];
    console[method](`[${LogLevel[consoleLevel]}] [${this.tag}]`, ...args);
  }

  debug(...args: unknown[]): void {
    this.emit(LogLevel.Debug, args);
  }

  info(...args: unknown[]): void {
    this.emit(LogLevel.Info, args);
  }

  log(...args: unknown[]): void {
    this.emit(LogLevel.Info, args);
  }

  warn(...args: unknown[]): void {
    this.emit(LogLevel.Warn, args);
  }

  error(...args: unknown[]): void {
    this.emit(LogLevel.Error, args);
  }
}

export class RoomLogger extends Logger {
  private room: ECSGameRoom | null = null;

  constructor(tag: string, attributes?: Record<string, unknown>) {
    super(tag, attributes);
  }

  setRoom(room: ECSGameRoom): void {
    this.room = room;
  }

  private prefixArgs(args: unknown[]): unknown[] {
    if (this.room) return [`[${this.room.tick}] -`, ...args];
    return args;
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
