type LogMeta = Record<string, unknown> | unknown;

const SENSITIVE_KEYWORDS = ["password", "pwd", "secret", "token", "signature", "authorization"];

function shouldMaskKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYWORDS.some(keyword => normalized.includes(keyword));
}

function sanitize(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value;
  if (typeof value !== "object") return value;

  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map(item => sanitize(item, seen));
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(input)) {
    if (shouldMaskKey(key)) {
      output[key] = "***";
      continue;
    }
    output[key] = sanitize(item, seen);
  }
  return output;
}

function print(level: "INFO" | "ERROR", message: string, meta?: LogMeta): void {
  const payload = meta === undefined ? "" : sanitize(meta);
  if (level === "INFO") {
    console.log(`[${level}] ${message}`, payload);
  } else {
    console.error(`[${level}] ${message}`, payload);
  }
}

export const logger = {
  info: (message: string, meta?: LogMeta) => {
    print("INFO", message, meta);
  },
  error: (message: string, meta?: LogMeta) => {
    print("ERROR", message, meta);
  },
};
