import { Layout, Menu } from "antd";
import { Link, Outlet, useLocation } from "react-router-dom";

const { Header, Content } = Layout;

const NAV_ITEMS = [{ key: "/", label: <Link to="/">Booking</Link> }];

export function AppLayout() {
  const location = useLocation();
  const selectedKey = location.pathname.startsWith("/bookings") ? "/" : location.pathname;

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header style={{ display: "flex", alignItems: "center" }}>
        <div style={{ color: "#fff", fontWeight: 600, marginRight: 32 }}>车队管理系统</div>
        <Menu theme="dark" mode="horizontal" selectedKeys={[selectedKey]} items={NAV_ITEMS} style={{ flex: 1 }} />
      </Header>
      <Content>
        <Outlet />
      </Content>
    </Layout>
  );
}
