import { CopyOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Flex, Input, Modal, Tabs, Typography } from "antd";
import { useEffect, useRef, useState } from "react";

import type { Gateway, ImportReport } from "./gateway";

interface Props {
  open: boolean;
  gateway: Gateway;
  onImported: () => void;
  onClose: () => void;
}

function ImportTab({ gateway, onImported }: Pick<Props, "gateway" | "onImported">) {
  const [text, setText] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  async function importNow() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(await gateway.importServers(text));
      onImported();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Flex vertical gap="small">
      <Typography.Text type="secondary">Paste a servers file, or postgres:// addresses one to a line. A name that is already saved is updated.</Typography.Text>
      <Input.TextArea aria-label="Servers to import" rows={8} value={text} onChange={(event) => setText(event.target.value)} style={{ fontFamily: "ui-monospace, Menlo, monospace" }} />
      <Flex gap="small" justify="space-between">
        <>
          <input
            ref={picker}
            type="file"
            aria-label="Choose a file"
            style={{ display: "none" }}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) setText(await file.text());
            }}
          />
          <Button onClick={() => picker.current?.click()}>Choose a file…</Button>
        </>
        <Button type="primary" disabled={text.trim() === ""} loading={busy} onClick={importNow}>
          Import
        </Button>
      </Flex>
      {error && <Alert type="error" showIcon title={error} />}
      {report && (
        <Flex vertical gap={4}>
          <Typography.Text strong>{`Added ${report.added}, updated ${report.updated}`}</Typography.Text>
          {report.skipped.map((why) => (
            <Typography.Text key={why} type="warning">
              {why}
            </Typography.Text>
          ))}
        </Flex>
      )}
    </Flex>
  );
}

function ExportTab({ gateway }: Pick<Props, "gateway">) {
  const [withPasswords, setWithPasswords] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    gateway
      .exportServers(withPasswords)
      .then((json) => current && setText(json))
      .catch((failure) => current && setError(String(failure)));
    return () => {
      current = false;
    };
  }, [gateway, withPasswords]);

  return (
    <Flex vertical gap="small">
      <Checkbox checked={withPasswords} onChange={(event) => setWithPasswords(event.target.checked)}>
        Include passwords
      </Checkbox>
      {withPasswords && <Alert type="warning" showIcon title="Anyone with this text can sign in to these servers. Keep it out of repositories and chats." />}
      <Input.TextArea aria-label="Exported servers" readOnly rows={10} value={text} style={{ fontFamily: "ui-monospace, Menlo, monospace" }} />
      {error && <Alert type="error" showIcon title={error} />}
      <Flex justify="end">
        <Button icon={<CopyOutlined />} onClick={() => navigator.clipboard.writeText(text)}>
          Copy
        </Button>
      </Flex>
    </Flex>
  );
}

export function ShareModal({ open, gateway, onImported, onClose }: Props) {
  return (
    <Modal open={open} title="Import / export servers" footer={null} onCancel={onClose} destroyOnHidden width={640}>
      <Tabs
        items={[
          { key: "import", label: "Import", children: <ImportTab gateway={gateway} onImported={onImported} /> },
          { key: "export", label: "Export", children: <ExportTab gateway={gateway} /> },
        ]}
      />
    </Modal>
  );
}
