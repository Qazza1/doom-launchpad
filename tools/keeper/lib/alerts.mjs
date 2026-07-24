import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const EMPTY_ALERT_STATE = {
  schema: "doom.keeper-alert-state.v1",
  active: {},
};

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(alert) {
  return createHash("sha256")
    .update(
      canonicalJson({
        severity: alert.severity,
        title: alert.title,
        summary: alert.summary,
        details: alert.details ?? [],
        action: alert.action ?? null,
      }),
    )
    .digest("hex");
}

function repeatSeconds(severity, thresholds) {
  if (severity === "critical") return thresholds.criticalRepeatSeconds;
  if (severity === "warning") return thresholds.warningRepeatSeconds;
  return thresholds.infoRepeatSeconds;
}

export function reconcileAlerts(alerts, previousState, observedAt, thresholds) {
  if (previousState?.schema !== EMPTY_ALERT_STATE.schema) throw new Error("Unsupported alert-state schema");
  const sorted = [...alerts].sort((left, right) => left.id.localeCompare(right.id));
  const seen = new Set();
  const notifications = [];
  const active = {};

  for (const alert of sorted) {
    if (!["critical", "warning", "info"].includes(alert.severity)) {
      throw new Error(`Invalid severity for ${alert.id}`);
    }
    if (seen.has(alert.id)) throw new Error(`Duplicate alert ID: ${alert.id}`);
    seen.add(alert.id);
    const currentFingerprint = fingerprint(alert);
    const previous = previousState.active[alert.id];
    const changed = previous?.fingerprint !== currentFingerprint;
    const repeatDue =
      previous !== undefined &&
      observedAt - previous.lastSentAt >= repeatSeconds(alert.severity, thresholds);
    const shouldSend = previous === undefined || changed || repeatDue;
    if (shouldSend) notifications.push({ ...alert, notificationKind: previous === undefined ? "opened" : changed ? "changed" : "repeat" });
    active[alert.id] = {
      alert,
      fingerprint: currentFingerprint,
      firstObservedAt: previous?.firstObservedAt ?? observedAt,
      lastObservedAt: observedAt,
      lastSentAt: shouldSend ? observedAt : previous.lastSentAt,
    };
  }

  for (const [id, previous] of Object.entries(previousState.active)) {
    if (!seen.has(id)) {
      notifications.push({
        id: `resolved:${id}`,
        severity: "info",
        title: `Resolved: ${previous.alert.title}`,
        summary: "The condition is no longer present in the latest keeper check.",
        details: [`Previously active since ${new Date(previous.firstObservedAt * 1000).toISOString()}`],
        notificationKind: "resolved",
      });
    }
  }

  notifications.sort((left, right) => left.id.localeCompare(right.id));
  return {
    notifications,
    nextState: { schema: EMPTY_ALERT_STATE.schema, active },
  };
}

export async function readAlertState(path) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    if (state?.schema !== EMPTY_ALERT_STATE.schema || typeof state.active !== "object") {
      throw new Error("Unsupported alert-state schema");
    }
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(EMPTY_ALERT_STATE);
    throw error;
  }
}

export async function writeAlertState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, path);
}
