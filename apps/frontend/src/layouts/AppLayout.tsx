import { useState, type ReactNode } from "react";
import { Button, Drawer, Layout, Menu, Space, Typography } from "antd";
import { MenuOutlined } from "@ant-design/icons";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../modules/auth/AuthContext";
import { PERMISSIONS, type PermissionKey } from "../common/permissions";
import { useIsMobile } from "../common/useIsMobile";
import { AdminNotificationBell } from "../modules/notifications/components/AdminNotificationBell";

const { Header, Content } = Layout;

const NAV_ITEMS: { key: string; label: ReactNode; permission: PermissionKey }[] = [
  { key: "/dispatch", label: <Link to="/dispatch">Dispatch Center</Link>, permission: PERMISSIONS.DISPATCH_READ },
  { key: "/dispatch/map", label: <Link to="/dispatch/map">Live Map</Link>, permission: PERMISSIONS.DISPATCH_READ },
  { key: "/", label: <Link to="/">Booking</Link>, permission: PERMISSIONS.BOOKING_READ },
  { key: "/drivers", label: <Link to="/drivers">Driver</Link>, permission: PERMISSIONS.DRIVER_READ },
  { key: "/wallet", label: <Link to="/wallet">Wallet</Link>, permission: PERMISSIONS.WALLET_READ },
  {
    key: "/settlements/daily",
    label: <Link to="/settlements/daily">Daily Settlement</Link>,
    permission: PERMISSIONS.SETTLEMENT_READ
  },
  {
    key: "/settlements/history",
    label: <Link to="/settlements/history">Settlement History</Link>,
    permission: PERMISSIONS.SETTLEMENT_READ
  },
  { key: "/collections", label: <Link to="/collections">Collection</Link>, permission: PERMISSIONS.COLLECTION_READ },
  { key: "/gps", label: <Link to="/gps">GPS</Link>, permission: PERMISSIONS.GPS_READ },
  {
    key: "/company-settings",
    label: <Link to="/company-settings">Company Settings</Link>,
    permission: PERMISSIONS.COMPANY_SETTINGS_READ
  }
];

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const selectedKey = location.pathname.startsWith("/bookings") ? "/" : location.pathname;
  const visibleNavItems = NAV_ITEMS.filter((item) => user?.permissions.includes(item.permission));

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
        <div style={{ color: "#fff", fontWeight: 600, marginRight: 32, flex: isMobile ? 1 : undefined }}>车队管理系统</div>
        {!isMobile && (
          <>
            <Menu theme="dark" mode="horizontal" selectedKeys={[selectedKey]} items={visibleNavItems} style={{ flex: 1 }} />
            <Space>
              <AdminNotificationBell />
              <Typography.Text style={{ color: "#fff" }}>{user?.username}</Typography.Text>
              <a style={{ color: "#fff" }} onClick={handleLogout}>
                登出
              </a>
            </Space>
          </>
        )}
        {isMobile && <AdminNotificationBell />}
      </Header>
      <Content>
        <Outlet />
      </Content>

      {/* Mobile Phase 1：手机宽度下用左侧 Drawer 取代横向 Menu——横向 Menu 超过一定
          项目数会自动收进 antd 的「…」溢出选单，登出连结会一起被藏起来，
          手机上很难点到（之前遇到的问题）。Drawer 展开后所有项目都是纵向列表，
          一定看得到、点得到。 */}
      <Drawer title="车队管理系统" placement="left" open={drawerOpen} onClose={() => setDrawerOpen(false)} width={280} styles={{ body: { padding: 0 } }}>
        <Menu mode="inline" selectedKeys={[selectedKey]} items={visibleNavItems} onClick={() => setDrawerOpen(false)} />
        <div className="safe-area-bottom" style={{ padding: 16, borderTop: "1px solid #f0f0f0" }}>
          <Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Text type="secondary">{user?.username}</Typography.Text>
            <Button block onClick={handleLogout} style={{ minHeight: 44 }}>
              登出
            </Button>
          </Space>
        </div>
      </Drawer>
    </Layout>
  );
}
