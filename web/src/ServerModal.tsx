import { Form, Input, InputNumber, Modal, Select } from "antd";
import { useState } from "react";

import { ENVIRONMENTS, type Environment, type SavedServer, type ServerDraft } from "./gateway";
import { displayName } from "./palette";

interface Props {
  open: boolean;
  /** Present when editing: the password is then only sent if a new one is typed. */
  editing: SavedServer | null;
  onSave: (draft: ServerDraft) => Promise<void>;
  onClose: () => void;
}

interface Values {
  name: string;
  host: string;
  port: number;
  user: string;
  database?: string;
  group?: string;
  environment?: Environment | null;
  password?: string;
}

export function ServerModal({ open, editing, onSave, onClose }: Props) {
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(values: Values) {
    setSaving(true);
    setError(null);
    try {
      await onSave({ id: editing?.id ?? null, name: values.name.trim(), host: values.host.trim(), port: values.port, user: values.user.trim(), database: values.database?.trim() || null, group: values.group?.trim() || null, environment: values.environment ?? null, password: values.password ? values.password : editing ? null : "" });
      form.resetFields();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={editing ? `Edit ${displayName(editing)}` : "Add server"}
      okText="Save"
      confirmLoading={saving}
      onOk={() => form.submit()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={save} initialValues={editing ?? { host: "localhost", port: 5432, user: "postgres" }}>
        <Form.Item name="name" label="Name" rules={[{ required: true }]}>
          <Input autoFocus />
        </Form.Item>
        <Form.Item name="host" label="Host" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="port" label="Port" rules={[{ required: true }]}>
          <InputNumber min={1} max={65535} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="user" label="User" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="database" label="Database" extra="Optional. Opened first when you choose this server.">
          <Input />
        </Form.Item>
        <Form.Item name="environment" label="Environment" extra="Optional. Shown after the name, and tints the SQL you write.">
          <Select allowClear placeholder="None" options={ENVIRONMENTS.map((environment) => ({ value: environment, label: environment }))} />
        </Form.Item>
        <Form.Item name="group" label="Group" extra="Optional, such as a team or a project.">
          <Input />
        </Form.Item>
        <Form.Item name="password" label="Password" extra={editing ? "Leave empty to keep the saved one." : undefined}>
          <Input.Password autoComplete="off" />
        </Form.Item>
        {error && <div role="alert">{error}</div>}
      </Form>
    </Modal>
  );
}
