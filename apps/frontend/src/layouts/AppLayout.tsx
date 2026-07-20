import { Layout, Menu, Space, Typography } from "antd";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../modules/auth/AuthContext";

const { Header, Content } = Layout;

const NAV_ITEMS = [
  { key: "/", label: <Link to="/">Booking</Link> },
  { key: "/drivers", label: <Link to="/drivers">Driver</Link> }
];

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const selectedKey = location.pathname.startsWith("/bookings") ? "/" : location.pathname;

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header style={{ display: "flex", alignItems: "center" }}>
        <div style={{ color: "#fff", fontWeight: 600, marginRight: 32 }}>车队管理系统</div>
        <Menu theme="dark" mode="horizontal" selectedKeys={[selectedKey]} items={NAV_ITEMS} style={{ flex: 1 }} />
        <Space>
          <Typography.Text style={{ color: "#fff" }}>{user?.username}</Typography.Text>
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
