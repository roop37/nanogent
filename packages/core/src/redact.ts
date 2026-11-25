const KEY_PATTERN = /\b(?:sk-ant-|sk-|ghp_)[A-Za-z0-9_-]+/g;
const BEARER_PATTERN = /\b(Bearer)[ \t]+[A-Za-z0-9._~+/-]+=*/gi;

/** Defense in depth for string log/event fields; never intentionally log credentials. */
export function redact(value: string): string {
  return value.replace(BEARER_PATTERN, "$1 [REDACTED]").replace(KEY_PATTERN, "[REDACTED]");
}
