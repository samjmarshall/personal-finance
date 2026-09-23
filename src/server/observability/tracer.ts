import { trace } from "@opentelemetry/api";
import { env } from "~/env";

// The one app tracer, keyed on the OTel service name. A no-op proxy until the SDK
// registers (otel.ts), so importing it at module load is safe everywhere.
export const tracer = trace.getTracer(env.PROJECT_NAME);
