import { ThemeSwitcher } from "@/components/theme-switcher";
import { GeistSans } from "geist/font/sans";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

const defaultUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

export const metadata = {
    metadataBase: new URL(defaultUrl),
    title: "Transum App — Peta Rute Transjakarta",
    description:
        "Jelajahi rute dan halte Transjakarta di peta. Data GTFS resmi dari PT Transportasi Jakarta.",
};

/**
 * `route` and `stop` are parallel-route slots (app/@route, app/@stop).
 * Next.js passes slots to the layout, not to the page.
 */
export default function RootLayout({
    children,
    route,
    stop,
}: {
    children: React.ReactNode;
    route: React.ReactNode;
    stop: React.ReactNode;
}) {
    return (
        <html
            lang="id"
            className={GeistSans.className}
            suppressHydrationWarning
        >
            <body className="bg-background text-foreground">
                <ThemeProvider
                    attribute="class"
                    defaultTheme="system"
                    enableSystem
                    disableTransitionOnChange
                >
                    <main className="h-screen flex flex-col items-center">
                        <div className="absolute flex items-center justify-center top-2 right-2 z-9999 bg-jakarta/70 rounded-full">
                            <ThemeSwitcher />
                        </div>
                        <div className="flex-1 w-full flex flex-col items-center">
                            {children}
                            <div className="flex gap-2 absolute top-0 right-0 z-9998">
                                {route}
                                {stop}
                            </div>
                        </div>
                    </main>
                </ThemeProvider>
            </body>
        </html>
    );
}
