import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://a-share-grid-calculator.ideal-mug-4893.chatgpt.site"),
  title: "A股 T+1 网格设计器",
  description: "计算价格层、逐格收益、资金与底仓承受力，并纳入A股T+1约束。",
  openGraph: {
    title: "A股 T+1 网格设计器",
    description: "先算能不能跑，再看每格赚多少。",
    images: [{ url: "/og.png", width: 1536, height: 1024 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "A股 T+1 网格设计器",
    description: "先算能不能跑，再看每格赚多少。",
    images: ["/og.png"],
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
