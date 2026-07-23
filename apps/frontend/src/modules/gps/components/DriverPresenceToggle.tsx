import { useEffect, useRef } from "react";
import { Space, Switch, Typography, message } from "antd";
import { useGoOfflineMutation, useGoOnlineMutation, useMyPresenceQuery } from "../hooks";
import * as gpsApi from "../api";
import { useCompanySettings } from "../../companySettings/CompanySettingsContext";

/** Company Settings 还没加载完成时的保底值，跟 schema 的 gpsUploadIntervalSeconds default 一致。 */
const DEFAULT_PING_INTERVAL_MS = 5000;

/** 部分浏览器才有的非标准 API，拿不到就算了，不影响上传。 */
interface BatteryManagerLike {
  level: number;
}
interface NavigatorWithBattery extends Navigator {
  getBattery?: () => Promise<BatteryManagerLike>;
}

async function readBatteryPercent(): Promise<number | undefined> {
  try {
    const nav = navigator as NavigatorWithBattery;
    if (!nav.getBattery) return undefined;
    const battery = await nav.getBattery();
    return Math.round(battery.level * 100);
  } catch {
    return undefined;
  }
}

/** GPS 上传失败/拿不到定位都安静忽略，绝对不能因为这个抛出去影响其他操作。 */
function sendOnePing() {
  if (!navigator.geolocation) return;

  navigator.geolocation.getCurrentPosition(
    (position) => {
      readBatteryPercent()
        .then((batteryPercent) =>
          gpsApi.sendPing({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            speed: position.coords.speed ?? undefined,
            heading: position.coords.heading ?? undefined,
            batteryPercent,
            recordedAt: new Date(position.timestamp).toISOString()
          })
        )
        .catch(() => {
          // 下一次 5 秒后再试，这里不用重试或提示，避免打扰 Driver。
        });
    },
    () => {
      // 拿不到定位（例如权限被拒），安静忽略。
    },
    { enableHighAccuracy: true, maximumAge: 4000, timeout: 8000 }
  );
}

export function DriverPresenceToggle({ light }: { light?: boolean } = {}) {
  const { data: presence } = useMyPresenceQuery();
  const goOnline = useGoOnlineMutation();
  const goOffline = useGoOfflineMutation();
  const companySettings = useCompanySettings();
  const intervalRef = useRef<number | null>(null);

  const isOnline = presence ? presence.status !== "OFFLINE" : false;
  const pingIntervalMs = (companySettings?.gpsUploadIntervalSeconds ?? DEFAULT_PING_INTERVAL_MS / 1000) * 1000;

  useEffect(() => {
    if (isOnline) {
      sendOnePing();
      intervalRef.current = window.setInterval(sendOnePing, pingIntervalMs);
    }
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isOnline, pingIntervalMs]);

  async function handleToggle(checked: boolean) {
    try {
      if (checked) {
        if (!navigator.geolocation) {
          message.warning("这个装置不支持定位，仍会切换为上线，但无法上传 GPS");
        }
        await goOnline.mutateAsync();
        message.success("已上线");
      } else {
        await goOffline.mutateAsync();
        message.success("已下线");
      }
    } catch {
      message.error("切换状态失败，请重试");
    }
  }

  return (
    <Space>
      <Switch checked={isOnline} onChange={handleToggle} loading={goOnline.isPending || goOffline.isPending} />
      <Typography.Text style={light ? undefined : { color: "#fff" }}>{isOnline ? "Online" : "Offline"}</Typography.Text>
    </Space>
  );
}
