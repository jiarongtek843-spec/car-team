import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./layouts/AppLayout";
import { DriverLayout } from "./layouts/DriverLayout";
import { BookingListPage } from "./modules/bookings/BookingListPage";
import { BookingDetailPage } from "./modules/bookings/BookingDetailPage";
import { HealthCheckPage } from "./modules/health/HealthCheckPage";
import { LoginPage } from "./modules/auth/LoginPage";
import { RequireAuth } from "./modules/auth/RequireAuth";
import { RequirePermission } from "./modules/auth/RequirePermission";
import { DriverManagementPage } from "./modules/drivers/DriverManagementPage";
import { DriverJobPage } from "./modules/driverJobs/DriverJobPage";
import { AdminWalletPage } from "./modules/wallet/AdminWalletPage";
import { DailySettlementPage } from "./modules/settlement/DailySettlementPage";
import { SettlementHistoryPage } from "./modules/settlement/SettlementHistoryPage";
import { MyEarningsPage } from "./modules/driverWallet/MyEarningsPage";
import { WalletHistoryPage } from "./modules/driverWallet/WalletHistoryPage";
import { DriverSettlementHistoryPage } from "./modules/driverWallet/DriverSettlementHistoryPage";
import { AdminCollectionPage } from "./modules/collections/AdminCollectionPage";
import { DriverCollectionPage } from "./modules/collections/DriverCollectionPage";
import { AdminGpsDashboardPage } from "./modules/gps/AdminGpsDashboardPage";
import { DispatchCenterPage } from "./modules/dispatch/DispatchCenterPage";
import { LiveDispatchMapPage } from "./modules/liveMap/LiveDispatchMapPage";
import { CompanySettingsPage } from "./modules/companySettings/CompanySettingsPage";
import { PERMISSIONS } from "./common/permissions";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth portal="admin">
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route
          path="/"
          element={
            <RequirePermission permission={PERMISSIONS.BOOKING_READ}>
              <BookingListPage />
            </RequirePermission>
          }
        />
        <Route
          path="/dispatch"
          element={
            <RequirePermission permission={PERMISSIONS.DISPATCH_READ}>
              <DispatchCenterPage />
            </RequirePermission>
          }
        />
        <Route
          path="/bookings/:id"
          element={
            <RequirePermission permission={PERMISSIONS.BOOKING_READ}>
              <BookingDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="/dispatch/map"
          element={
            <RequirePermission permission={PERMISSIONS.DISPATCH_READ}>
              <LiveDispatchMapPage />
            </RequirePermission>
          }
        />
        <Route
          path="/drivers"
          element={
            <RequirePermission permission={PERMISSIONS.DRIVER_READ}>
              <DriverManagementPage />
            </RequirePermission>
          }
        />
        <Route
          path="/wallet"
          element={
            <RequirePermission permission={PERMISSIONS.WALLET_READ}>
              <AdminWalletPage />
            </RequirePermission>
          }
        />
        <Route
          path="/settlements/daily"
          element={
            <RequirePermission permission={PERMISSIONS.SETTLEMENT_READ}>
              <DailySettlementPage />
            </RequirePermission>
          }
        />
        <Route
          path="/settlements/history"
          element={
            <RequirePermission permission={PERMISSIONS.SETTLEMENT_READ}>
              <SettlementHistoryPage />
            </RequirePermission>
          }
        />
        <Route
          path="/collections"
          element={
            <RequirePermission permission={PERMISSIONS.COLLECTION_READ}>
              <AdminCollectionPage />
            </RequirePermission>
          }
        />
        <Route
          path="/gps"
          element={
            <RequirePermission permission={PERMISSIONS.GPS_READ}>
              <AdminGpsDashboardPage />
            </RequirePermission>
          }
        />
        <Route
          path="/company-settings"
          element={
            <RequirePermission permission={PERMISSIONS.COMPANY_SETTINGS_READ}>
              <CompanySettingsPage />
            </RequirePermission>
          }
        />
        <Route path="/health" element={<HealthCheckPage />} />
      </Route>

      <Route
        element={
          <RequireAuth portal="driver">
            <DriverLayout />
          </RequireAuth>
        }
      >
        <Route
          path="/driver/jobs"
          element={
            <RequirePermission permission={PERMISSIONS.DRIVER_JOBS_SELF}>
              <DriverJobPage />
            </RequirePermission>
          }
        />
        <Route
          path="/driver/earnings"
          element={
            <RequirePermission permission={PERMISSIONS.DRIVER_WALLET_SELF}>
              <MyEarningsPage />
            </RequirePermission>
          }
        />
        <Route
          path="/driver/wallet-history"
          element={
            <RequirePermission permission={PERMISSIONS.DRIVER_WALLET_SELF}>
              <WalletHistoryPage />
            </RequirePermission>
          }
        />
        <Route
          path="/driver/settlements"
          element={
            <RequirePermission permission={PERMISSIONS.DRIVER_SETTLEMENT_SELF}>
              <DriverSettlementHistoryPage />
            </RequirePermission>
          }
        />
        <Route
          path="/driver/collections"
          element={
            <RequirePermission permission={PERMISSIONS.DRIVER_COLLECTION_SELF}>
              <DriverCollectionPage />
            </RequirePermission>
          }
        />
      </Route>
    </Routes>
  );
}

export default App;
