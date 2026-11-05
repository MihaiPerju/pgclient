import { Table } from "antd";
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { ago, bandPath, linePath, nearest, scaleFor, stack, ticks, type Frame } from "./chartGeometry";
import { MagnifyButton, type Magnify } from "./Magnified";
import { ceiling, type Line } from "./series";
import { useTheme } from "./theme";

/** The colours the marks wear, by what they stand for, so the same thing is the same colour on every chart. Checked against the surfaces the app draws on. */
export const SERIES = {
  light: { blue: "#3274d9", orange: "#fa6400", aqua: "#37872d" },
  dark: { blue: "#5794f2", orange: "#ff9830", aqua: "#73bf69" },
} as const;
export type Hue = keyof typeof SERIES.light;

export interface Series extends Line {
  hue: Hue;
}

interface Props {
  title: string;
  /** What the numbers are, said under the title. */
  caption: string;
  /** The time of each point, seconds by the server's clock. */
  times: number[];
  series: Series[];
  /** Stacked areas, for a whole made of parts; lines, for things that are compared. */
  kind: "area" | "line";
  /** How a value is said in the tooltip and on the axis. */
  format: (value: number) => string;
  /** A line across the chart that the values must not pass, such as the most connections allowed. */
  limit?: { value: number; label: string };
  /** Said in the tooltip under the values, for what is worked out from them. */
  extra?: (index: number) => string | null;
  /** Where to start the scale from: the least the top of it can be, so a quiet chart is not blown up to fill its box. */
  floor?: number;
  /** Put before the title, such as what the chart is dragged by. */
  handle?: ReactNode;
  /** With it, the chart can be grown over the window. */
  magnify?: Magnify;
}

const HEIGHT = 168;
const FRAME: Omit<Frame, "width"> = { height: HEIGHT, left: 46, right: 12, top: 10, bottom: 22 };
const TICKS = 5;
const WIDTH = 560;

/** A chart of how things changed over the last half hour: stacked areas or lines, a hover that reads off every one of them at that moment, a legend, and the same numbers as a table. */
export function TimeChart({ title, caption, times, series, kind, format, limit, extra, floor = 1, handle, magnify }: Props) {
  const { dark } = useTheme();
  const colors = dark ? SERIES.dark : SERIES.light;
  const ink = dark ? { text: "#D0D6E0", muted: "#8A8F98", grid: "rgba(255, 255, 255, 0.08)", axis: "rgba(255, 255, 255, 0.16)", surface: "#0F1011" } : { text: "#1F2328", muted: "#6B7280", grid: "rgba(0, 0, 0, 0.07)", axis: "rgba(0, 0, 0, 0.16)", surface: "#FFFFFF" };
  const id = useId();
  const box = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const frame: Frame = { ...FRAME, width: WIDTH };
  const stacked = kind === "area" ? stack(series) : null;
  const top = ceiling(stacked ? stacked.map((values, index) => ({ ...series[index], values })) : series, limit ? Math.max(floor, limit.value) : floor);
  const scale = scaleFor(frame, times, top);
  const last = times.length - 1;
  const latest = times[last] ?? 0;
  const empty = times.length < 2;

  function at(event: PointerEvent<SVGSVGElement>) {
    const rect = box.current!.getBoundingClientRect();
    return nearest(times, scale, ((event.clientX - rect.left) / rect.width) * WIDTH);
  }

  function onKey(event: KeyboardEvent<SVGSVGElement>) {
    if (empty) return;
    const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (step === 0 && event.key !== "Escape") return;
    event.preventDefault();
    setHover(event.key === "Escape" ? null : Math.min(last, Math.max(0, (hover ?? last) + step)));
  }

  const rows = times.map((time, index) => ({ key: index, when: ago(latest - time), ...Object.fromEntries(series.map((one) => [one.key, one.values[index]])) }));
  const hovered = hover !== null && hover <= last ? hover : null;

  return (
    <figure
      aria-label={title}
      className="pg-chart"
      style={{ margin: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, padding: "8px 10px 6px", border: "1px solid var(--pg-border-secondary)", borderRadius: 8, background: "var(--pg-container)" }}
    >
      <figcaption style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 20 }}>
        <span className="pg-chart-actions">{handle}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--pg-secondary)" }}>{title}</span>
        <span style={{ fontSize: 11, color: "var(--pg-tertiary)" }}>{caption}</span>
        <span className="pg-chart-actions" style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" className="pg-link" aria-pressed={table} onClick={() => setTable((now) => !now)}>
            {table ? "Chart" : "Table"}
          </button>
          {magnify && <MagnifyButton magnify={magnify} />}
        </span>
      </figcaption>
      {table ? (
        <Table
          size="small"
          pagination={{ pageSize: 8, size: "small", showSizeChanger: false, hideOnSinglePage: true }}
          rowKey="key"
          dataSource={[...rows].reverse()}
          columns={[{ title: "When", dataIndex: "when" }, ...series.map((one) => ({ title: one.label, dataIndex: one.key, render: (value: number | null) => (value === null ? "—" : format(value)) }))]}
        />
      ) : (
        <div style={{ position: "relative" }}>
          <svg
            ref={box}
            role="img"
            tabIndex={0}
            aria-label={`${title}: ${empty ? "not enough readings yet" : `${times.length} readings, use the arrow keys to read them`}`}
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            style={{ width: "100%", height: "auto", display: "block", overflow: "visible", outline: "none" }}
            onPointerMove={(event) => !empty && setHover(at(event))}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
          >
            {[0, 0.5, 1].map((share) => (
              <g key={share}>
                <line x1={FRAME.left} x2={WIDTH - FRAME.right} y1={scale.y(top * share)} y2={scale.y(top * share)} stroke={share === 0 ? ink.axis : ink.grid} strokeWidth={1} />
                <text x={FRAME.left - 6} y={scale.y(top * share) + 3} textAnchor="end" fontSize={11} fill={ink.muted}>
                  {format(top * share)}
                </text>
              </g>
            ))}
            {!empty &&
              ticks(times[0], latest, TICKS).map((time, index, all) => (
                <g key={time}>
                  {index > 0 && index < all.length - 1 && <line x1={scale.x(time)} x2={scale.x(time)} y1={FRAME.top} y2={HEIGHT - FRAME.bottom} stroke={ink.grid} strokeWidth={1} />}
                  <text x={scale.x(time)} y={HEIGHT - 6} textAnchor={index === 0 ? "start" : index === all.length - 1 ? "end" : "middle"} fontSize={11} fill={ink.muted}>
                    {ago(latest - time)}
                  </text>
                </g>
              ))}
            {limit && (
              <g>
                <line x1={FRAME.left} x2={WIDTH - FRAME.right} y1={scale.y(limit.value)} y2={scale.y(limit.value)} stroke={ink.muted} strokeWidth={1} strokeDasharray="2 3" />
                <text x={WIDTH - FRAME.right} y={scale.y(limit.value) - 3} textAnchor="end" fontSize={11} fill={ink.muted}>
                  {limit.label}
                </text>
              </g>
            )}
            <clipPath id={`${id}-plot`}>
              <rect x={FRAME.left} y={FRAME.top - 1} width={WIDTH - FRAME.left - FRAME.right} height={HEIGHT - FRAME.top - FRAME.bottom + 2} />
            </clipPath>
            <g clipPath={`url(#${id}-plot)`}>
              {stacked
                ? series.map((one, index) => (
                    <g key={one.key}>
                      <path d={bandPath(times, stacked[index], index === 0 ? null : stacked[index - 1], scale)} fill={colors[one.hue]} fillOpacity={0.22} stroke={ink.surface} strokeWidth={2} />
                      <path d={linePath(times, stacked[index], scale)} fill="none" stroke={colors[one.hue]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    </g>
                  ))
                : series.map((one) => <path key={one.key} d={linePath(times, one.values, scale)} fill="none" stroke={colors[one.hue]} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />)}
            </g>
            {hovered !== null && (
              <g pointerEvents="none">
                <line x1={scale.x(times[hovered])} x2={scale.x(times[hovered])} y1={FRAME.top} y2={HEIGHT - FRAME.bottom} stroke={ink.muted} strokeWidth={1} />
                {series.map((one, index) => {
                  const value = stacked ? stacked[index][hovered] : one.values[hovered];
                  return value === null ? null : <circle key={one.key} cx={scale.x(times[hovered])} cy={scale.y(value)} r={4} fill={colors[one.hue]} stroke={ink.surface} strokeWidth={2} />;
                })}
              </g>
            )}
          </svg>
          {empty && (
            <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 12, color: "var(--pg-secondary)" }}>Waiting for a second reading…</span>
          )}
          {hovered !== null && (
            <div
              role="status"
              style={{
                position: "absolute",
                top: 6,
                ...(scale.x(times[hovered]) > WIDTH / 2 ? { right: `${((WIDTH - scale.x(times[hovered])) / WIDTH) * 100 + 2}%` } : { left: `${(scale.x(times[hovered]) / WIDTH) * 100 + 2}%` }),
                padding: "6px 8px",
                background: "var(--pg-elevated, var(--pg-container))",
                border: "1px solid var(--pg-border)",
                fontSize: 11,
                pointerEvents: "none",
                minWidth: 120,
              }}
            >
              <div style={{ color: "var(--pg-secondary)", marginBottom: 3 }}>{ago(latest - times[hovered])}</div>
              {series.map((one) => (
                <div key={one.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span aria-hidden style={{ width: 10, height: 2, background: colors[one.hue] }} />
                  <strong style={{ color: "var(--pg-heading)", fontWeight: 600 }}>{one.values[hovered] === null ? "—" : format(one.values[hovered]!)}</strong>
                  <span style={{ color: "var(--pg-secondary)" }}>{one.label}</span>
                </div>
              ))}
              {extra?.(hovered) && <div style={{ color: "var(--pg-secondary)", marginTop: 3 }}>{extra(hovered)}</div>}
            </div>
          )}
        </div>
      )}
      <ul aria-label={`${title}, key`} style={{ display: "flex", flexWrap: "wrap", gap: "1px 12px", margin: 0, padding: "0 4px", listStyle: "none", fontSize: 11 }}>
        {series.map((one) => (
          <li key={one.key} style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--pg-secondary)" }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: colors[one.hue] }} />
            {one.label}
          </li>
        ))}
      </ul>
    </figure>
  );
}
