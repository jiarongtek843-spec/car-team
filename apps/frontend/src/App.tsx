import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./layouts/AppLayout";
import { BookingListPage } from "./modules/bookings/BookingListPage";
import { BookingDetailPage } from "./modules/bookings/BookingDetailPage";
import { HealthCheckPage } from "./modules/health/HealthCheckPage";

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<BookingListPage />} />
        <Route path="/bookings/:id" element={<BookingDetailPage />} />
        <Route path="/health" element={<HealthCheckPage />} />
      </Route>
    </Routes>
  );
}

export default App;
