import { ExclamationCircleOutlined, EyeInvisibleOutlined } from "@ant-design/icons";
import { Flex, Typography, theme } from "antd";
import type { ReactNode } from "react";

import { formatDuration, formatRate, tone, type Tone } from "./metrics";
import type { MetricsState } from "./useMetrics";

const LIMITED_VIEW =
  "You can see how many connections there are, but not what other people's sessions are doing, so active, longest query, longest transaction, blocked and idle in transaction cover only your own.";

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const width = 44;
  const height = 14;
  const low = Math.min(...values);
  const high = Math.max(...values);
  // A line that does not change is drawn across the middle, not divided by nothing.
  const y = (value: number) => (high === low ? height / 2 : height - 1 - ((value - low) / (high - low)) * (height - 2));
  const points = values.map((value, index) => `${((index / (values.length - 1)) * width).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return (
    <svg className="pg-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

interface ChipProps {
  label: string;
  value: ReactNode;
  description: string;
  tone: Tone;
  graph?: ReactNode;
}

/** One number with its name, a dot in the colour of how it is doing, and the same said in words for whoever cannot see the colour. */
function Chip({ label, value, description, tone: how, graph }: ChipProps) {
  const { token } = theme.useToken();
  const colors: Record<Tone, string> = { ok: token.colorSuccess, warn: token.colorWarning, bad: token.colorError, quiet: token.colorTextQuaternary };
  return (
    <Flex gap={6} align="center" aria-label={description} data-tone={how} style={{ whiteSpace: "nowrap" }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: colors[how], flexShrink: 0 }} />
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {label}
      </Typography.Text>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500, color: how === "warn" || how === "bad" ? colors[how] : token.colorTextHeading }}>{value}</span>
      {graph}
    </Flex>
  );
}

export function MetricsBar({ state }: { state: MetricsState }) {
  const { token } = theme.useToken();
  const { now, history, error } = state;

  if (now === null && error !== null) {
    return (
      <Typography.Text type="secondary" aria-label="Metrics unavailable" title={error} style={{ fontSize: 12 }}>
        <ExclamationCircleOutlined aria-hidden /> Metrics unavailable
      </Typography.Text>
    );
  }

  const sparkColor = token.colorTextTertiary;
  const dash = "—";
  return (
    <Flex role="group" aria-label="Database metrics" aria-busy={now === null} wrap gap="2px 12px" align="center" style={{ fontSize: 12, minWidth: 0 }}>
      <Chip
        label="Conn"
        description={now ? `Connections: ${now.connections} of ${now.maxConnections}` : "Connections: not known yet"}
        value={now ? `${now.connections}/${now.maxConnections}` : dash}
        tone={now ? tone("connections", now) : "quiet"}
        graph={<Sparkline values={history.connections} color={sparkColor} />}
      />
      <Chip
        label="Active"
        description={now ? `Active queries: ${now.active}${now.longestActive !== null ? `, the longest running for ${formatDuration(now.longestActive)}` : ""}` : "Active queries: not known yet"}
        value={now ? `${now.active}${now.longestActive !== null ? ` · ${formatDuration(now.longestActive)}` : ""}` : dash}
        tone={now ? tone("longest", now) : "quiet"}
      />
      <Chip
        label="Longest tx"
        description={now ? `Longest open transaction: ${now.longestTransaction !== null ? formatDuration(now.longestTransaction) : "none open"}` : "Longest open transaction: not known yet"}
        value={now ? (now.longestTransaction !== null ? formatDuration(now.longestTransaction) : "none") : dash}
        tone={now ? tone("transaction", now) : "quiet"}
      />
      <Chip label="Blocked" description={now ? `Blocked sessions: ${now.blocked}` : "Blocked sessions: not known yet"} value={now ? now.blocked : dash} tone={now ? tone("blocked", now) : "quiet"} />
      <Chip
        label="Cache"
        description={now?.cacheHit != null ? `Cache hit ratio: ${now.cacheHit.toFixed(1)}%` : "Cache hit ratio: not known yet"}
        value={now?.cacheHit != null ? `${now.cacheHit.toFixed(1)}%` : dash}
        tone={now ? tone("cache", now) : "quiet"}
      />
      <Chip
        label="TPS"
        description={now?.tps != null ? `Transactions per second: ${formatRate(now.tps)}` : "Transactions per second: not known yet"}
        value={now?.tps != null ? formatRate(now.tps) : dash}
        tone="quiet"
        graph={<Sparkline values={history.tps} color={sparkColor} />}
      />
      {now && now.idleInTransaction > 0 && (
        <Chip label="Idle in tx" description={`Idle in transaction: ${now.idleInTransaction}`} value={now.idleInTransaction} tone={tone("idleInTransaction", now)} />
      )}
      {now && now.newDeadlocks > 0 && <Chip label="Deadlocks" description={`New deadlocks: ${now.newDeadlocks}`} value={`+${now.newDeadlocks}`} tone={tone("deadlocks", now)} />}
      {now && !now.fullView && (
        <Typography.Text type="secondary" aria-label="Limited view" title={LIMITED_VIEW} style={{ fontSize: 11, whiteSpace: "nowrap" }}>
          <EyeInvisibleOutlined aria-hidden /> Limited view
        </Typography.Text>
      )}
      {now && error !== null && (
        <Typography.Text type="warning" aria-label="Metrics could not be refreshed" title={error} style={{ fontSize: 11 }}>
          <ExclamationCircleOutlined aria-hidden />
        </Typography.Text>
      )}
    </Flex>
  );
}
