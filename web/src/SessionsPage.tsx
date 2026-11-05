import { WarningFilled } from "@ant-design/icons";
import { Alert, Button, Flex, Popconfirm, Switch, Typography, theme } from "antd";
import { useCallback, useEffect, useState } from "react";

import type { Gateway, Session, Stop } from "./gateway";
import { arrange, flagsOf, howLong } from "./sessions";

/** Often enough to watch a lock pile up, and the look itself is one small query. */
const INTERVAL_MS = 2000;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** How long a session has been as it is: its query while running, its transaction while one is open, else since it went idle. */
function sinceText(session: Session): string {
  const seconds = session.state === "active" ? session.query_seconds : session.state?.startsWith("idle in transaction") ? session.transaction_seconds : session.state_seconds;
  return seconds === null ? "" : howLong(seconds);
}

/** Who is connected to the database and what each is doing, looked at again every few seconds, with ways to stop one. */
export function SessionsPage({ gateway, serverId, database }: { gateway: Gateway; serverId: string; database: string }) {
  const { token } = theme.useToken();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showIdle, setShowIdle] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  const look = useCallback(async () => {
    try {
      setSessions(await gateway.sessions(serverId, database));
      setProblem(null);
    } catch (failure) {
      setProblem(String(failure));
    }
  }, [gateway, serverId, database]);

  useEffect(() => {
    setSessions(null);
    void look();
    // A hidden window is not worth looking for.
    const timer = window.setInterval(() => !document.hidden && void look(), INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [look]);

  async function stop(session: Session, how: Stop) {
    try {
      const stopped = await gateway.stopSession(serverId, database, session.pid, how);
      setNotice(!stopped ? `${session.pid} had already ended` : how === "cancel" ? `Cancelled the query of ${session.pid}` : `Ended session ${session.pid}`);
      setProblem(null);
    } catch (failure) {
      setNotice(null);
      setProblem(String(failure));
      return;
    }
    await look();
  }

  const toggle = (pid: number) =>
    setOpen((now) => {
      const next = new Set(now);
      if (!next.delete(pid)) next.add(pid);
      return next;
    });

  const all = sessions ?? [];
  const { shown, idle } = arrange(all, showIdle);
  const blocked = all.filter((session) => session.blocked_by.length > 0).length;
  const cell = { padding: "6px 10px", borderBottom: `1px solid ${token.colorBorderSecondary}`, verticalAlign: "top" } as const;

  return (
    <Flex vertical style={{ height: "100%", minHeight: 0 }}>
      <Flex align="center" gap={12} wrap style={{ padding: "6px 12px", borderBottom: `1px solid ${token.colorBorderSecondary}`, fontSize: 12 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {sessions === null ? "Looking…" : `${plural(all.length, "session")} on ${database}${blocked > 0 ? ` · ${blocked} waiting on a lock` : ""} · every ${INTERVAL_MS / 1000} s`}
        </Typography.Text>
        {notice && (
          <Typography.Text role="status" style={{ fontSize: 12 }}>
            {notice}
          </Typography.Text>
        )}
        <Flex align="center" gap={6} style={{ marginLeft: "auto" }}>
          <Switch size="small" checked={showIdle} onChange={setShowIdle} aria-label={showIdle ? "Show idle" : `Show ${idle} idle`} />
          <Typography.Text aria-hidden style={{ fontSize: 12 }}>
            {showIdle ? "Showing idle" : `Show ${idle} idle`}
          </Typography.Text>
        </Flex>
      </Flex>
      {problem && <Alert type="error" showIcon title={problem} closable onClose={() => setProblem(null)} style={{ margin: 8 }} />}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {sessions !== null && shown.length === 0 ? (
          <Typography.Text type="secondary" style={{ display: "block", padding: 12 }}>
            Nothing running. {plural(idle, "idle session")}.
          </Typography.Text>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead style={{ position: "sticky", top: 0, background: token.colorBgContainer, zIndex: 1 }}>
              <tr style={{ textAlign: "left", color: token.colorTextSecondary }}>
                {["PID", "Who", "State", "For", "Query", "Stop"].map((name) => (
                  <th key={name} style={{ ...cell, fontWeight: 500, textAlign: name === "Stop" ? "right" : "left" }}>
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((session) => {
                const flags = flagsOf(session, all);
                const full = open.has(session.pid);
                return (
                  <tr key={session.pid} style={{ background: flags.length > 0 ? token.colorWarningBg : undefined }}>
                    <td style={{ ...cell, fontFamily: "var(--pg-mono)" }}>{session.pid}</td>
                    <td style={cell}>
                      <div>{session.user ?? "?"}</div>
                      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        {[session.application, session.client].filter(Boolean).join(" · ")}
                      </Typography.Text>
                    </td>
                    <td style={{ ...cell, whiteSpace: "nowrap" }}>
                      <div>{session.state ?? "hidden"}</div>
                      {session.wait_event && (
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          waits on {session.wait_event_type}: {session.wait_event}
                        </Typography.Text>
                      )}
                    </td>
                    <td style={{ ...cell, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{sinceText(session)}</td>
                    <td style={{ ...cell, width: "50%", maxWidth: 0 }}>
                      {flags.map((flag) => (
                        <div key={flag.kind} style={{ color: token.colorWarningText, marginBottom: 2 }}>
                          <WarningFilled aria-hidden style={{ marginRight: 4 }} />
                          {flag.text}
                        </div>
                      ))}
                      {session.query && (
                        <button
                          type="button"
                          title={full ? "Show less" : "Show all of it"}
                          onClick={() => toggle(session.pid)}
                          style={{
                            all: "unset",
                            cursor: "pointer",
                            display: "-webkit-box",
                            WebkitBoxOrient: "vertical",
                            WebkitLineClamp: full ? "unset" : 2,
                            overflow: "hidden",
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                            fontFamily: "var(--pg-mono)",
                            fontSize: 11,
                            color: session.state === "active" ? token.colorText : token.colorTextSecondary,
                          }}
                        >
                          {session.query}
                        </button>
                      )}
                    </td>
                    <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
                      {session.state === "active" && (
                        <Button size="small" type="text" onClick={() => stop(session, "cancel")}>
                          Cancel query
                        </Button>
                      )}
                      <Popconfirm
                        title={`End session ${session.pid}?`}
                        description="Its connection drops, and a transaction it has open is rolled back."
                        okText="End it"
                        okButtonProps={{ danger: true }}
                        cancelText="Keep it"
                        onConfirm={() => stop(session, "terminate")}
                      >
                        <Button size="small" type="text" danger>
                          End session
                        </Button>
                      </Popconfirm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Flex>
  );
}
