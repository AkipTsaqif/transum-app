import { ThemeSwitcher } from "@/components/theme-switcher";
import { PT_Sans, PT_Sans_Narrow } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

/*
 * Self-hosted via next/font so there is no render-blocking Google Fonts
 * request -- and, more importantly, no remote @import for the bundler to strip
 * out of globals.css (which is what silently killed these fonts before).
 * Each family is exposed as a CSS variable consumed by @theme in globals.css.
 */
const ptSans = PT_Sans({
    subsets: ["latin"],
    weight: ["400", "700"],
    style: ["normal", "italic"],
    variable: "--font-pt-sans-src",
    display: "swap",
});

const ptSansNarrow = PT_Sans_Narrow({
    subsets: ["latin"],
    weight: ["400", "700"],
    variable: "--font-pt-sans-narrow-src",
    display: "swap",
});

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
            className={`${ptSans.variable} ${ptSansNarrow.variable}`}
            suppressHydrationWarning
        >
            <body className="font-pt-sans bg-background text-foreground">
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
