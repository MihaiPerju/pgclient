import { ConfigProvider, theme as antTheme } from "antd";

import type { Environment } from "./gateway";
import { CloseIcon, ErrorIcon } from "./CloseIcon";
import { cssVariables, themeFor } from "./palette";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  /** What was chosen. System means whatever the operating system is using at the moment. */
  mode: ThemeMode;
  dark: boolean;
  setMode: (mode: ThemeMode) => void;
  /** The chosen server's, which takes the place of the indigo accent everywhere. */
  environment: Environment | null;
  setEnvironment: (environment: Environment | null) => void;
}

const KEY = "pgclient.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const ThemeContext = createContext<ThemeState>({ mode: "system", dark: false, setMode: () => {}, environment: null, setEnvironment: () => {} });

export const useTheme = () => useContext(ThemeContext);

function stored(): ThemeMode {
  const value = localStorage.getItem(KEY);
  return value === "light" || value === "dark" ? value : "system";
}

/** Gives the page the colours of the theme, which antd's components take care of for themselves but a bare page does not. */
function Surface({ dark, environment, children }: { dark: boolean; environment: Environment | null; children: ReactNode }) {
  const { token } = antTheme.useToken();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = dark ? "dark" : "light";
    root.style.colorScheme = dark ? "dark" : "light";
    document.body.style.background = token.colorBgLayout;
    document.body.style.color = token.colorText;
    for (const [name, value] of Object.entries(cssVariables(dark, environment))) root.style.setProperty(name, value);
  }, [dark, environment, token.colorBgLayout, token.colorText]);
  return <>{children}</>;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(stored);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const follow = () => setSystemDark(query.matches);
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  const dark = mode === "system" ? systemDark : mode === "dark";
  const value = useMemo<ThemeState>(
    () => ({
      mode,
      dark,
      setMode: (next) => {
        localStorage.setItem(KEY, next);
        setModeState(next);
      },
      environment,
      setEnvironment,
    }),
    [mode, dark, environment],
  );

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider theme={themeFor(dark, environment)} modal={{ closeIcon: <CloseIcon /> }} alert={{ closeIcon: <CloseIcon />, errorIcon: <ErrorIcon /> }}>
        <Surface dark={dark} environment={environment}>{children}</Surface>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
