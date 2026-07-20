import { useEffect, useState } from "react";
import { Card, Tag, Typography } from "antd";
import { http } from "../../api/http";

interface HealthResponse {
  status: string;
  timestamp: string;
}

export function HealthCheckPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    http
      .get<HealthResponse>("/api/health")
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <Card title="车队管理系统 — Backend 连线状态" style={{ maxWidth: 480, margin: "48px auto" }}>
      {error && <Tag color="red">连线失败：{error}</Tag>}
      {!error && !health && <Tag color="default">连线中…</Tag>}
      {health && (
        <>
          <Tag color="green">状态：{health.status}</Tag>
          <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
            Backend 时间：{health.timestamp}
          </Typography.Paragraph>
        </>
      )}
    </Card>
  );
}
