import "./globals.css";

export const metadata = {
  title: "Tripbook",
  description: "Your family's shared vacation journal",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Tripbook", statusBarStyle: "black-translucent" }
};
export const viewport = {
  themeColor: "#14343b",
  width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
        `}} />
      </body>
    </html>
  );
}
