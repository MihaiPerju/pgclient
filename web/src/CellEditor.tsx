import { json } from "@codemirror/lang-json";
import CodeMirror from "@uiw/react-codemirror";
import { Button, Checkbox, Flex, Input, Modal, Typography } from "antd";
import { useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type { EditorView } from "@codemirror/view";

import { editorTheme } from "./editorTheme";
import type { Cell, SourceColumn } from "./gateway";
import { looksLikeJson, prettyJson } from "./json";
import { MONO } from "./palette";
import { CornerGrip, useBoxSize, type Box } from "./resize";
import { useTheme } from "./theme";

export interface Editing {
  row: number;
  column: number;
  value: Cell;
  source: SourceColumn;
}

interface Props {
  editing: Editing | null;
  onSave: (value: Cell) => void;
  onClose: () => void;
}

const SIZE_KEY = "pgclient.cellEditorSize";
const DEFAULT_WIDTH = 720;
/** Room the pop-up keeps for what is around the editor: its title, its buttons and the gap above it. */
const CHROME = 280;
const MIN_BOX: Box = { width: 420, height: 120 };
const MARGIN = 48;

const defaultBox = (): Box => ({ width: DEFAULT_WIDTH, height: Math.round(window.innerHeight * 0.4) });
const largestBox = (): Box => ({ width: Math.max(MIN_BOX.width, window.innerWidth - MARGIN), height: Math.max(MIN_BOX.height, window.innerHeight - CHROME) });

const isJsonColumn = (type: string) => type === "json" || type === "jsonb";

function validJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Whether a value is JSON, by its column or by how it reads, and so is edited in the code editor and not in the cell. */
export const isJsonValue = (value: Cell, dataType: string) => isJsonColumn(dataType) || (value !== null && looksLikeJson(value));

const editsAsJson = ({ value, source }: Editing) => isJsonValue(value, source.data_type);

/** A cell opened for editing, as pgAdmin does: its value in a pop-up, laid out and highlighted when it is JSON, and saved only if it changed. */
export function CellEditor({ editing, onSave, onClose }: Props) {
  const { box, setBox, reset } = useBoxSize(SIZE_KEY);
  const shown = box ?? defaultBox();
  const asJson = editing !== null && editsAsJson(editing);
  return (
    <Modal
      open={editing !== null}
      title={editing && `Edit ${editing.source.name}`}
      width={asJson ? shown.width : DEFAULT_WIDTH}
      destroyOnHidden
      footer={null}
      onCancel={onClose}
    >
      {editing && <Form key={`${editing.row}:${editing.column}`} editing={editing} box={shown} onBox={setBox} onResetBox={reset} onSave={onSave} onClose={onClose} />}
    </Modal>
  );
}

interface FormProps {
  editing: Editing;
  box: Box;
  onBox: (box: Box) => void;
  onResetBox: () => void;
  onSave: (value: Cell) => void;
  onClose: () => void;
}

function Form({ editing, box, onBox, onResetBox, onSave, onClose }: FormProps) {
  const { dark } = useTheme();
  const { value, source } = editing;
  const asJson = editsAsJson(editing);
  const initial = value === null ? "" : asJson ? (prettyJson(value) ?? value) : value;
  const [text, setText] = useState(initial);
  const [isNull, setIsNull] = useState(value === null);
  const extensions = useMemo(() => [json(), ...editorTheme(dark)], [dark]);
  const view = useRef<EditorView | null>(null);

  /** The editor listens only to clicks on its text, which is as tall as what is written, so a click lower in the frame puts the cursor at the end. */
  function focusEditor(event: MouseEvent<HTMLDivElement>) {
    const editor = view.current;
    if (!editor || isNull || (event.target as HTMLElement).closest(".cm-content, .cm-gutters")) return;
    event.preventDefault();
    editor.focus();
    editor.dispatch({ selection: { anchor: editor.state.doc.length }, scrollIntoView: true });
  }

  const broken = asJson && !isNull && !validJson(text);
  const changed = isNull ? value !== null : value === null || text !== initial;
  const save = () => onSave(isNull ? null : text);

  return (
    <Flex vertical gap={12} style={{ position: "relative" }}>
      <Typography.Text type="secondary">
        {source.data_type}
        {source.nullable ? "" : " · not null"}
      </Typography.Text>
      {asJson ? (
        <div role="group" aria-label={`${source.name} JSON`} className="pg-json-editor" style={{ "--editor-height": `${box.height}px`, height: box.height, overflow: "hidden", border: "1px solid var(--pg-border)", borderRadius: 6, opacity: isNull ? 0.5 : 1, background: "var(--pg-container)" } as CSSProperties} onMouseDown={focusEditor}>
          <CodeMirror value={text} theme="none" editable={!isNull} basicSetup={{ foldGutter: true, highlightActiveLine: false }} extensions={extensions} onChange={setText} onCreateEditor={(created) => (view.current = created)} />
        </div>
      ) : (
        <Input.TextArea aria-label={source.name} value={text} disabled={isNull} autoSize={{ minRows: 3, maxRows: 14 }} style={{ fontFamily: MONO, fontSize: 12 }} onChange={(event) => setText(event.target.value)} />
      )}
      {broken && <Typography.Text type="danger">This is not valid JSON.</Typography.Text>}
      <Flex justify="space-between" align="center">
        {source.nullable ? (
          <Checkbox checked={isNull} onChange={(event) => setIsNull(event.target.checked)}>
            NULL
          </Checkbox>
        ) : (
          <span />
        )}
        <Flex gap={8}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" disabled={!changed || broken} onClick={save}>
            Save
          </Button>
        </Flex>
      </Flex>
      {asJson && <CornerGrip label="Resize editor" size={() => box} min={MIN_BOX} max={largestBox} widthPerPixel={2} onResize={onBox} onReset={onResetBox} />}
    </Flex>
  );
}
