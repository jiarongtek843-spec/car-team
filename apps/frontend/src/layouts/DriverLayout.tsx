import { useState } from "react";
import { Button, Drawer, Layout, Menu, Space, Typography } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../modules/auth/AuthContext";
import { DriverPresenceToggle } from "../modules/gps/components/DriverPresenceToggle";
import { useIsMobile } from "../common/useIsMobile";

const { Header, Content } = Layout;

const NAV_ITEMS = [
  { key: "/driver/jobs", label: <Link to="/driver/jobs">我的工作</Link> },
  { key: "/driver/earnings", label: <Link to="/driver/earnings">My Earnings</Link> },
  { key: "/driver/settlements", label: <Link to="/driver/settlements">Settlement History</Link> },
  { key: "/driver/collections", label: <Link to="/driver/collections">Collection</Link> }
];

export function DriverLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function handleLogout() {
    setDrawerOpen(false);
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <Layout className="app-full-height">
      <Header
        className="safe-area-top"
        style={{ display: "flex", alignItems: "center", paddingInline: isMobile ? 16 : undefined }}
      >
        {isMobile && (
          <Button
            type="text"
            aria-label="打开导览选单"
            icon={<MenuOutlined style={{ color: "#fff", fontSize: 20 }} />}
            onClick={() => setDrawerOpen(true)}
            style={{ marginRight: 12, minWidth: 44, minHeight: 44 }}
          />
        )}
        <div style={{ color: "#fff", fontWeight: 600, marginRight: 32, flex: isMobile ? 1 : undefined }}>车队管理系统 · 司机</div>
        {!isMobile && (
          <>
            <Menu theme="dark" mode="horizontal" selectedKeys={[location.pathname]} items={NAV_ITEMS} style={{ flex: 1 }} />
            <Space size="large">
              <DriverPresenceToggle />
              <Typography.Text style={{ color: "#fff" }}>{user?.driver?.name ?? user?.username}</Typography.Text>
              <a style={{ color: "#fff" }} onClick={handleLogout}>
                登出
              </a>
            </Space>
          </>
        )}
        {isMobile && (
          <div onClick={(e) => e.stopPropagation()}>
            <DriverPresenceToggle />
          </div>
        )}
      </Header>
      <Content>
        <Outlet />
      </Content>

      <Drawer title="车队管理系统 · 司机" placement="left" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={280} styles={{ body: { padding: 0 } }}>
        <Menu mode="inline" selectedKeys={[location.pathname]} items={NAV_ITEMS} onClick={() => setDrawerOpen(false)} />
        <div className="safe-area-bottom" style={{ padding: 16, borderTop: "1px solid #f0f0f0" }}>
          <Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Text type="secondary">{user?.driver?.name ?? user?.username}</Typography.Text>
            <Button block onClick={handleLogout} style={{ minHeight: 44 }}>
              登出
            </Button>
          </Space>
        </div>
      </Drawer>
    </Layout>
  );
}
