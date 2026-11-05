import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { Button, Input, Typography } from "antd";
import { useEffect, useRef, type KeyboardEvent } from "react";

import { CloseIcon } from "./CloseIcon";

interface Props {
  text: string;
  onText: (text: string) => void;
  /** How many columns match, and which of them is the one shown, counting from one. */
  count: number;
  position: number;
  onStep: (step: 1 | -1) => void;
  onClose: () => void;
}

/** A bar for finding a column by its name in a result with more of them than the window shows: type some of the name and the grid scrolls to the first that has it. */
export function ColumnFinder({ text, onText, count, position, onStep, onClose }: Props) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    // The grid listens for keys of its own, such as Backspace, which here belong to the text being typed.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      onStep(event.shiftKey ? -1 : 1);
    }
  }

  const none = text.trim() !== "" && count === 0;
  return (
    <div role="search" aria-label="Find a column" className="pg-colfind">
      <Input
        ref={field as never}
        size="small"
        aria-label="Find a column"
        placeholder="Find a column"
        value={text}
        status={none ? "error" : undefined}
        allowClear={{ clearIcon: <CloseIcon size={10} /> }}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={onKeyDown}
        style={{ width: 200 }}
      />
      <Typography.Text role="status" aria-live="polite" type={none ? "danger" : "secondary"} style={{ fontSize: 12, minWidth: 64, textAlign: "right" }}>
        {text.trim() === "" ? "" : none ? "No column" : `${position} of ${count}`}
      </Typography.Text>
      <Button size="small" type="text" aria-label="Previous column (Shift+Enter)" title="Previous column (Shift+Enter)" icon={<UpOutlined aria-hidden />} disabled={count < 2} onClick={() => onStep(-1)} />
      <Button size="small" type="text" aria-label="Next column (Enter)" title="Next column (Enter)" icon={<DownOutlined aria-hidden />} disabled={count < 2} onClick={() => onStep(1)} />
      <Button size="small" type="text" aria-label="Close (Escape)" title="Close (Escape)" icon={<CloseIcon />} onClick={onClose} />
    </div>
  );
}
