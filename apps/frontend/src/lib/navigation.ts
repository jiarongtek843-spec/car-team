/** 生成导航 App 的深层链接——两个都是官方支援的 Universal Link 格式，装置有装对应 App
 * 就会直接跳过去，没装则退回浏览器打开对应网页版，不需要额外侦测装置有没有安装。 */
export function buildWazeUrl(address: string): string {
  return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
}

export function buildGoogleMapsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
