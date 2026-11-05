import { theme } from "antd";
import type { ReactNode } from "react";

/** A key, drawn as a keycap beside what it does, so the shortcut is learnt by seeing it. Screen readers get the shortcut from `aria-keyshortcuts`. */
export function Kbd({ children }: { children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <kbd
      aria-hidden
      style={{
        marginLeft: 2,
        padding: "0 4px",
        border: `1px solid ${token.colorBorder}`,
        borderBottomWidth: 2,
        borderRadius: 4,
        fontFamily: "inherit",
        fontSize: 10,
        lineHeight: "14px",
        color: token.colorTextSecondary,
      }}
    >
      {children}
    </kbd>
  );
}
