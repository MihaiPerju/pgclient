import type { Session } from "./gateway";

/** Something about a session that is often why the database is in trouble. */
export interface Flag {
  kind: "blocking" | "blocked" | "idle-in-transaction" | "long" | "long-transaction";
  text: string;
}

/** Long enough to be worth a look: a query running, or a transaction left open, this many seconds. */
const LONG_SECONDS = 60;

/** Seconds in the two biggest units that fit, such as "3 min 5 s". */
export function howLong(seconds: number): string {
  if (seconds < 1) return `${seconds.toFixed(1)} s`;
  const units: [string, number][] = [
    ["d", 86400],
    ["h", 3600],
    ["min", 60],
    ["s", 1],
  ];
  let left = Math.floor(seconds);
  const parts: string[] = [];
  for (const [name, size] of units) {
    const amount = Math.floor(left / size);
    left -= amount * size;
    if (amount > 0 || parts.length > 0) parts.push(`${amount} ${name}`);
    if (parts.length === 2) break;
  }
  return parts.filter((part) => !part.startsWith("0 ")).join(" ");
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function flagsOf(session: Session, all: Session[]): Flag[] {
  const flags: Flag[] = [];
  const waiting = all.filter((other) => other.blocked_by.includes(session.pid)).length;
  if (waiting > 0) flags.push({ kind: "blocking", text: `Blocking ${plural(waiting, "session")}` });
  if (session.blocked_by.length > 0) flags.push({ kind: "blocked", text: `Waiting for a lock held by ${session.blocked_by.join(", ")}` });
  const idleLong = session.state?.startsWith("idle in transaction") && (session.state_seconds ?? 0) >= LONG_SECONDS;
  if (idleLong) {
    flags.push({ kind: "idle-in-transaction", text: `Idle in a transaction for ${howLong(session.state_seconds!)}, keeping its locks` });
  }
  if (session.state === "active" && session.blocked_by.length === 0 && (session.query_seconds ?? 0) >= LONG_SECONDS) {
    flags.push({ kind: "long", text: `Running for ${howLong(session.query_seconds!)}` });
  }
  // Said only when the transaction began before what the session is doing now, so a slow query on its own is not said twice.
  const since = session.state === "active" ? session.query_seconds : session.state_seconds;
  const open = session.transaction_seconds ?? 0;
  if (!idleLong && open >= LONG_SECONDS && open > (since ?? 0) + 1) {
    flags.push({ kind: "long-transaction", text: `In a transaction open for ${howLong(open)}` });
  }
  return flags;
}

/** Where a session goes in the list: what holds others up first, then what waits, what runs, what sits in a transaction, and the idle last. */
function rank(session: Session, all: Session[]): number {
  if (all.some((other) => other.blocked_by.includes(session.pid))) return 0;
  if (session.blocked_by.length > 0) return 1;
  if (session.state === "active") return 2;
  if (session.state?.startsWith("idle in transaction")) return 3;
  return 4;
}

/** Within a rank, the longest first, by transaction where one is open, except the idle, which go most recently busy first. */
function age(session: Session, place: number): number {
  if (place === 3) return -(session.transaction_seconds ?? 0);
  if (place === 4) return session.state_seconds ?? 0;
  return -(session.transaction_seconds ?? session.query_seconds ?? 0);
}

/** The sessions in the order to look at them, and how many idle ones are left out unless asked for. */
export function arrange(sessions: Session[], showIdle: boolean): { shown: Session[]; idle: number } {
  const placed = sessions.map((session) => ({ session, place: rank(session, sessions) }));
  placed.sort((a, b) => a.place - b.place || age(a.session, a.place) - age(b.session, b.place));
  const shown = placed.filter(({ place }) => showIdle || place < 4).map(({ session }) => session);
  return { shown, idle: sessions.length - shown.length };
}
