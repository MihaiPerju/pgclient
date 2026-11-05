import { CopyOutlined } from "@ant-design/icons";
import { Button, Modal } from "antd";

import { prettyJson, tokenizeJson, type JsonTokenKind } from "./json";
import { MONO, palette } from "./palette";
import { useTheme } from "./theme";

export function JsonModal({ value, onClose }: { value: string | null; onClose: () => void }) {
  const { dark } = useTheme();
  const colors = palette(dark);
  const pretty = value === null ? null : prettyJson(value);
  const color: Record<JsonTokenKind, string> = { key: colors.type, string: colors.string, number: colors.number, literal: colors.keyword, plain: colors.text };

  return (
    <Modal
      open={pretty !== null}
      title="JSON"
      width={720}
      destroyOnHidden
      onCancel={onClose}
      footer={
        <Button icon={<CopyOutlined aria-hidden />} onClick={() => pretty !== null && void navigator.clipboard.writeText(pretty)}>
          Copy
        </Button>
      }
    >
      <pre aria-label="JSON text" style={{ margin: 0, maxHeight: "60vh", overflow: "auto", fontFamily: MONO, fontSize: 12, lineHeight: 1.6 }}>
        {pretty !== null && tokenizeJson(pretty).map((token, index) => <span key={index} style={{ color: color[token.kind] }}>{token.text}</span>)}
      </pre>
    </Modal>
  );
}
