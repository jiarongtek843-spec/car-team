import { Layout, Space, Typography } from "antd";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../modules/auth/AuthContext";

const { Header, Content } = Layout;

export function DriverLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header style={{ display: "flex", alignItems: "center" }}>
        <div style={{ color: "#fff", fontWeight: 600, flex: 1 }}>车队管理系统 · 司机</div>
        <Space>
          <Typography.Text style={{ color: "#fff" }}>{user?.driver?.name ?? user?.username}</Typography.Text>
          <a style={{ color: "#fff" }} onClick={handleLogout}>
            登出
          </a>
        </Space>
      </Header>
      <Content>
        <Outlet />
      </Content>
    </Layout>
  );
}
