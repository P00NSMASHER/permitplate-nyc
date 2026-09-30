export const RETRYABLE_SETTLEMENT_REASONS = new Set([
  "settlement_pending",
  "duplicate_settlement",
]);

export function normaliseQuery(raw) {
  const input = String(raw ?? "").trim();
  if (input.length > 200) {
    return { ok: false, reason: "query_too_long" };
  }
  const searchTerm = input.replace(/[%_]+/g, " ").replace(/\s+/g, " ").trim();
  if (searchTerm.length < 2) {
    return { ok: false, reason: "query_too_short" };
  }
  return { ok: true, value: searchTerm };
}

export function parseLimit(raw, fallback = 10) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { ok: true, value: fallback };
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return { ok: false, reason: "invalid_limit" };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1 || value > 25) {
    return { ok: false, reason: "invalid_limit" };
  }
  return { ok: true, value };
}

export function classifyVerify(status, body) {
  if (body && body.isValid === true) {
    return { kind: "valid", body };
  }
  if (body && body.isValid === false) {
    return {
      kind: "invalid",
      reason: String(body.invalidReason || "payment_verification_failed"),
      message: body.invalidMessage ? String(body.invalidMessage) : null,
      body,
    };
  }
  if (status === 429 || status >= 500) {
    return { kind: "unavailable", reason: "payment_verifier_unavailable", body };
  }
  return { kind: "unavailable", reason: "payment_verifier_malformed_response", body };
}

export function classifySettle(status, body) {
  if (body && body.success === true) {
    return { kind: "settled", body };
  }
  const reason = String(body?.errorReason || "");
  if (RETRYABLE_SETTLEMENT_REASONS.has(reason)) {
    return { kind: "unresolved", reason, body };
  }
  if (status === 429 || status >= 500) {
    return { kind: "unavailable", reason: reason || "payment_settlement_unavailable", body };
  }
  if (body && body.success === false) {
    return {
      kind: "terminal_failure",
      reason: reason || "payment_settlement_failed",
      message: body.errorMessage ? String(body.errorMessage) : null,
      body,
    };
  }
  return { kind: "unavailable", reason: "payment_settlement_malformed_response", body };
}

export function shouldIssueFresh402(classification) {
  return classification?.kind === "invalid" || classification?.kind === "terminal_failure";
}
