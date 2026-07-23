import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Card, Form, Input, Typography, Alert } from "antd";
import { useAuth } from "./AuthContext";
import { ApiError } from "../../api/http";
import { homePathForUser } from "./roleHelpers";

interface FormValues {
  username: string;
  password: string;
}

export function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isLoading && user) {
    return <Navigate to={homePathForUser(user)} replace />;
  }

  async function handleSubmit(values: FormValues) {
    setError(null);
    setSubmitting(true);
    try {
      const loggedInUser = await login(values.username, values.password);
      navigate(homePathForUser(loggedInUser), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登入失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="app-full-height"
      style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 16, boxSizing: "border-box" }}
    >
      <Card style={{ width: "100%", maxWidth: 360 }}>
        <Typography.Title level={4} style={{ textAlign: "center", marginTop: 0 }}>
          车队管理系统
        </Typography.Title>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="username" label="帐号" rules={[{ required: true, message: "请输入帐号" }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              登入
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
