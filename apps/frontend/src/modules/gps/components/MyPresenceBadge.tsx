import { Tag } from "antd";
import { useMyPresenceQuery } from "../hooks";
import { PRESENCE_STATUS_COLOR, PRESENCE_STATUS_LABELS } from "../types";

// Mobile UAT Bug Fix：Header 跟首页 Card 之前各放一个可以操作的 Switch，两个看起来
// 独立、容易让人以为状态不同步（虽然背后其实是同一个 react-query hook）。改成 Header
// 只显示唯读的状态徽章，真正能点的 Switch 只留在首页 Card（DriverPresenceToggle），
// 避免同一个画面出现两个容易混淆的操作入口。
export function MyPresenceBadge() {
  const { data: presence } = useMyPresenceQuery();
  const status = presence?.status ?? "OFFLINE";

  return <Tag color={PRESENCE_STATUS_COLOR[status]}>{PRESENCE_STATUS_LABELS[status]}</Tag>;
}
