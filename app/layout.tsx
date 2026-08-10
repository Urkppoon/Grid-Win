import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "网格参数计算器",
  description: "计算等差与等比网格的价格层、步长和收益率。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
