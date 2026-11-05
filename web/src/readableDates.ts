import { useCallback, useState } from "react";

const STORED = "pgclient.readableDates";

export const isDateType = (dataType: string) => dataType === "date" || dataType.startsWith("timestamp");

const TIMESTAMP = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|[+-]\d\d(?::?\d\d)?)?)?$/;

/** A date or timestamp as Postgres writes it, such as "Sep 28, 2026, 12:44:08 PM UTC"; anything else, such as `infinity`, comes back as it was. A timestamp without a zone is not shifted to `zone`. */
export function readable(value: string, zone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const parts = TIMESTAMP.exec(value);
  if (!parts) return value;
  const [, year, month, day, hour, minute, second, offset] = parts;
  const time = hour !== undefined;
  const wall = `${year}-${month}-${day}T${time ? `${hour}:${minute}:${second}` : "00:00:00"}`;
  const instant = new Date(offset ? `${wall}${offset === "Z" ? "Z" : offset.replace(/^([+-]\d\d)$/, "$1:00").replace(/^([+-]\d\d)(\d\d)$/, "$1:$2")}` : `${wall}Z`);
  if (Number.isNaN(instant.getTime())) return value;
  const shifted = offset !== undefined;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: shifted ? zone : "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(time ? { hour: "numeric", minute: "2-digit", second: "2-digit" } : {}),
    ...(shifted ? { timeZoneName: "short" } : {}),
  }).format(instant);
}

/** Whether dates are shown readably, remembered between runs. It is how they are drawn only: what is edited or copied is the value itself. */
export function useReadableDates() {
  const [on, set] = useState(() => localStorage.getItem(STORED) === "true");
  const toggle = useCallback(() => {
    set((now) => {
      localStorage.setItem(STORED, String(!now));
      return !now;
    });
  }, []);
  return { on, toggle };
}
