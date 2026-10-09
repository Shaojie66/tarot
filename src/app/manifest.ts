import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "此刻三张牌",
    short_name: "此刻三张牌",
    description: "抽三张牌，和自己聊一小会儿。自我反思工具，不预测未来。",
    lang: "zh-CN",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#15131b",
    theme_color: "#15131b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "抽三张牌", url: "/reading" },
      { name: "每日一张", url: "/daily" },
      { name: "历史", url: "/history" },
    ],
  };
}
