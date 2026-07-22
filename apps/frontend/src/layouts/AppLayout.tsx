import type { ReactNode } from "react";
import { Layout, Menu, Space, Typography } from "antd";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../modules/auth/AuthContext";
import { PERMISSIONS, type PermissionKey } from "../common/permissions";

const { Header, Content } = Layout;

const NAV_ITEMS: { key: string; label: ReactNode; permission: PermissionKey }[] = [
  { key: "/dispatch", label: <Link to="/dispatch">Dispatch Center</Link>, permission: PERMISSIONS.DISPATCH_READ },
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
  const selectedKey = location.pathname.startsWith("/bookings") ? "/" : location.pathname;
  const visibleNavItems = NAV_ITEMS.filter((item) => user?.permissions.includes(item.permission));

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header style={{ display: "flex", alignItems: "center" }}>
        <div style={{ color: "#fff", fontWeight: 600, marginRight: 32 }}>车队管理系统</div>
        <Menu theme="dark" mode="horizontal" selectedKeys={[selectedKey]} items={visibleNavItems} style={{ flex: 1 }} />
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
