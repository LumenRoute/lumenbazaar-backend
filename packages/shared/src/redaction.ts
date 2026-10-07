const sensitiveValuePatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/giu,
  /\bS[A-Z2-7]{55}\b/gu,
  /\b(secret|seed|token|password|api[_-]?key|private[_-]?key|signing[_-]?key)\s*[=:]\s*[^\s,;]+/giu
];

export function redactSensitiveText(value: string) {
  return sensitiveValuePatterns.reduce(
    (sanitized, pattern) => sanitized.replace(pattern, "[redacted]"),
    value
  );
}
