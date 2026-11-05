import { FullscreenExitOutlined, FullscreenOutlined } from "@ant-design/icons";
import { Button, theme } from "antd";
import { useRef, type CSSProperties, type ReactNode } from "react";

import { useMagnify } from "./magnify";

export type Magnify = ReturnType<typeof useMagnify>;

/** A result, table or graph, that a pinch grows over the window from where it is. Its place in the layout is kept while it is lifted off it, and
 * what is in it stays as it was, so it can be switched between table and graph while big. */
export function Magnified({ label, children }: { label: string; children: (magnify: Magnify) => ReactNode }) {
  const { token } = theme.useToken();
  const place = useRef<HTMLDivElement>(null);
  const magnify = useMagnify(place);
  return (
    <div ref={place} style={{ height: "100%", minHeight: 0 }}>
      {magnify.lifted && <div aria-hidden onClick={magnify.close} style={{ ...magnify.backdrop, background: token.colorBgMask }} />}
      <div
        role={magnify.lifted ? "dialog" : undefined}
        aria-label={magnify.lifted ? label : undefined}
        style={
          magnify.surface
            ? { ...magnify.surface, overflow: "hidden", background: token.colorBgContainer, border: `1px solid ${token.colorBorder}`, borderRadius: 8, boxShadow: token.boxShadowSecondary }
            : { height: "100%", minHeight: 0 }
        }
      >
        {children(magnify)}
      </div>
    </div>
  );
}

/** The button that grows a result to fill the window, and puts it back. */
export function MagnifyButton({ magnify, style }: { magnify: Magnify; style?: CSSProperties }) {
  return (
    <Button
      size="small"
      type="text"
      aria-label="Full screen"
      aria-pressed={magnify.full}
      title={magnify.lifted ? "Put back (Esc)" : "Fill the window, or pinch to grow it"}
      icon={magnify.lifted ? <FullscreenExitOutlined aria-hidden /> : <FullscreenOutlined aria-hidden />}
      style={style}
      onClick={magnify.lifted ? magnify.close : magnify.open}
    />
  );
}
