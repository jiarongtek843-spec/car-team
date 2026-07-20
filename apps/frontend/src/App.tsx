import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./layouts/AppLayout";
import { DriverLayout } from "./layouts/DriverLayout";
import { BookingListPage } from "./modules/bookings/BookingListPage";
import { BookingDetailPage } from "./modules/bookings/BookingDetailPage";
import { HealthCheckPage } from "./modules/health/HealthCheckPage";
import { LoginPage } from "./modules/auth/LoginPage";
import { RequireAuth } from "./modules/auth/RequireAuth";
import { DriverManagementPage } from "./modules/drivers/DriverManagementPage";
import { DriverJobPage } from "./modules/driverJobs/DriverJobPage";
import { AdminWalletPage } from "./modules/wallet/AdminWalletPage";
import { DailySettlementPage } from "./modules/settlement/DailySettlementPage";
import { SettlementHistoryPage } from "./modules/settlement/SettlementHistoryPage";
import { MyEarningsPage } from "./modules/driverWallet/MyEarningsPage";
import { DriverSettlementHistoryPage } from "./modules/driverWallet/DriverSettlementHistoryPage";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth role="ADMIN">
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<BookingListPage />} />
        <Route path="/bookings/:id" element={<BookingDetailPage />} />
        <Route path="/drivers" element={<DriverManagementPage />} />
        <Route path="/wallet" element={<AdminWalletPage />} />
        <Route path="/settlements/daily" element={<DailySettlementPage />} />
        <Route path="/settlements/history" element={<SettlementHistoryPage />} />
        <Route path="/health" element={<HealthCheckPage />} />
      </Route>

      <Route
        element={
          <RequireAuth role="DRIVER">
            <DriverLayout />
          </RequireAuth>
        }
      >
        <Route path="/driver/jobs" element={<DriverJobPage />} />
        <Route path="/driver/earnings" element={<MyEarningsPage />} />
        <Route path="/driver/settlements" element={<DriverSettlementHistoryPage />} />
      </Route>
    </Routes>
  );
}

export default App;
