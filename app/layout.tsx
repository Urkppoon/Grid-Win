import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://a-share-grid-calculator.ideal-mug-4893.chatgpt.site"),
  title: "grid win",
  description: "计算价格层、逐格收益、资金与底仓承受力，并纳入A股T+1约束。",
  openGraph: {
    title: "grid win",
    description: "先算能不能跑，再看每格赚多少。",
  },
  twitter: {
    card: "summary_large_image",
    title: "grid win",
    description: "先算能不能跑，再看每格赚多少。",
  },
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
