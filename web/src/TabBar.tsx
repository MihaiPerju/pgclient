import { ColumnWidthOutlined, PlusOutlined, SwapOutlined } from "@ant-design/icons";
import { Button, Spin } from "antd";
import type { KeyboardEvent, MouseEvent } from "react";

import { CloseIcon } from "./CloseIcon";
import type { Environment } from "./gateway";
import { palette } from "./palette";
import { useTheme } from "./theme";

export interface TabView {
  id: string;
  label: string;
  /** The whole name, for when the label is cut short. */
  title: string;
  environment: Environment | null;
  /** A statement is running in it. */
  busy: boolean;
}

interface Props {
  tabs: TabView[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  /** Opens this pane's front tab beside it as a pane of its own. Left out where the window is split already. */
  onSplit?: () => void;
  /** Moves a tab to the other pane. */
  onMove?: (id: string) => void;
  /** Whether the window is split, in which case a tab can be sent to the other side. */
  split?: boolean;
}

/** The databases that are open, one tab each. A tab wears the colour of its environment, so a production one is not mistaken for another. */
export function TabBar({ tabs, activeId, onSelect, onClose, onNew, onSplit, onMove, split = false }: Props) {
  const { dark } = useTheme();
  // The last tab of the window cannot be closed, and a pane's last one closes the pane, which is only when there are two.
  const closable = tabs.length > 1 || split;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    onSelect(next.id);
    (event.currentTarget.parentElement?.querySelector(`[data-tab="${CSS.escape(next.id)}"]`) as HTMLElement | null)?.focus();
  }

  // A click with the middle button closes the tab, as in a browser.
  const onAuxClick = (event: MouseEvent, id: string) => {
    if (event.button !== 1 || !closable) return;
    event.preventDefault();
    onClose(id);
  };

  return (
    <div className="pg-tabs" role="tablist" aria-label="Open databases">
      {tabs.map((tab, index) => {
        const active = tab.id === activeId;
        const accent = palette(dark, tab.environment).accent;
        return (
          <div
            key={tab.id}
            role="tab"
            data-tab={tab.id}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={tab.title}
            className="pg-tab"
            data-active={active}
            style={{ "--tab-accent": accent } as React.CSSProperties}
            onClick={() => onSelect(tab.id)}
            onAuxClick={(event) => onAuxClick(event, tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span aria-hidden className="pg-tab-dot" />
            <span className="pg-tab-label">{tab.label}</span>
            {tab.busy && <Spin size="small" aria-label="Running" />}
            {closable && (
              <button
                type="button"
                className="pg-tab-close"
                aria-label={`Close ${tab.label}`}
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <CloseIcon size={10} />
              </button>
            )}
          </div>
        );
      })}
      <Button type="text" size="small" icon={<PlusOutlined aria-hidden />} aria-label="New tab" title="New tab on this database" onClick={onNew} />
      <span style={{ flex: 1 }} />
      {onSplit && (
        <Button type="text" size="small" icon={<ColumnWidthOutlined aria-hidden />} aria-label="Split" title="Open this tab beside the others" onClick={onSplit} />
      )}
      {split && onMove && (
        <Button type="text" size="small" icon={<SwapOutlined aria-hidden />} aria-label="Move tab to the other side" title="Move the tab in front to the other side" onClick={() => onMove(activeId)} />
      )}
    </div>
  );
}
