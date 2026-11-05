import { DesktopOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Segmented } from "antd";

import { useTheme, type ThemeMode } from "./theme";

const LABELS: Record<ThemeMode, string> = { light: "Light", system: "System", dark: "Dark" };

export function ThemeSwitch() {
  const { mode, setMode } = useTheme();
  return (
    <Segmented<ThemeMode>
      aria-label="Theme"
      value={mode}
      onChange={setMode}
      options={[
        { value: "light", label: <SunOutlined aria-label={LABELS.light} />, title: LABELS.light },
        { value: "system", label: <DesktopOutlined aria-label={LABELS.system} />, title: LABELS.system },
        { value: "dark", label: <MoonOutlined aria-label={LABELS.dark} />, title: LABELS.dark },
      ]}
    />
  );
}
