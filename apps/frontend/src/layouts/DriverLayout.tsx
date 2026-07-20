import { Layout, Menu, Space, Typography } from "antd";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../modules/auth/AuthContext";

const { Header, Content } = Layout;

const NAV_ITEMS = [
  { key: "/driver/jobs", label: <Link to="/driver/jobs">我的工作</Link> },
  { key: "/driver/earnings", label: <Link to="/driver/earnings">My Earnings</Link> },
  { key: "/driver/settlements", label: <Link to="/driver/settlements">Settlement History</Link> }
];

export function DriverLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header style={{ display: "flex", alignItems: "center" }}>
        <div style={{ color: "#fff", fontWeight: 600, marginRight: 32 }}>车队管理系统 · 司机</div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[location.pathname]}
          items={NAV_ITEMS}
          style={{ flex: 1 }}
        />
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
