import { Dropdown, Typography, type MenuProps } from "antd";
import { EnvironmentOutlined } from "@ant-design/icons";
import { buildGoogleMapsUrl, buildWazeUrl } from "../lib/navigation";

/** 地址文字点了会跳出 Waze / Google Maps 选单——地址本身没有意义可以判断司机比较常用
 * 哪一个，两个都是马来西亚很常见的导航 App，让司机自己选比帮他猜更保险。地址是 "—"
 * （没有实际地址内容）时不用可以点，点了也导航不到任何地方。 */
export function LocationLink({ address }: { address: string | null | undefined }) {
  if (!address || address === "—") {
    return <>{address ?? "—"}</>;
  }

  const items: MenuProps["items"] = [
    { key: "waze", label: "用 Waze 导航" },
    { key: "google", label: "用 Google Maps 导航" }
  ];

  function handleClick({ key }: { key: string }) {
    const url = key === "waze" ? buildWazeUrl(address!) : buildGoogleMapsUrl(address!);
    window.open(url, "_blank", "noopener");
  }

  return (
    <Dropdown menu={{ items, onClick: handleClick }} trigger={["click"]}>
      <Typography.Link onClick={(e) => e.preventDefault()}>
        {address}
        <EnvironmentOutlined style={{ marginLeft: 4 }} />
      </Typography.Link>
    </Dropdown>
  );
}
