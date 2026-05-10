import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { logs } from '@opentelemetry/api-logs';
import { trace } from '@opentelemetry/api';

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: 'tron-zero-server',
});

const traceExporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces',
});

const tracerProvider = new BasicTracerProvider({
  resource,
  spanProcessors: [new BatchSpanProcessor(traceExporter)],
});
trace.setGlobalTracerProvider(tracerProvider);

const logExporter = new OTLPLogExporter({
  url: 'http://localhost:4318/v1/logs',
});

const loggerProvider = new LoggerProvider({
  resource,
  processors: [new BatchLogRecordProcessor(logExporter)],
});
logs.setGlobalLoggerProvider(loggerProvider);
