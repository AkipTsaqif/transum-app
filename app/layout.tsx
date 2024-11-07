import DeployButton from "@/components/deploy-button";
import { EnvVarWarning } from "@/components/env-var-warning";
import HeaderAuth from "@/components/header-auth";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { hasEnvVars } from "@/utils/supabase/check-env-vars";
import { GeistSans } from "geist/font/sans";
import { ThemeProvider } from "next-themes";
import Link from "next/link";
import "./globals.css";
import MainMapComponent from "@/components/map/main-map";
import { Separator } from "@/components/ui/separator";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

const defaultUrl = process.env.VERCEL_URL
	? `https://${process.env.VERCEL_URL}`
	: "http://localhost:3000";

export const metadata = {
	metadataBase: new URL(defaultUrl),
	title: "Next.js and Supabase Starter Kit",
	description: "The fastest way to build apps with Next.js and Supabase",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html
			lang="en"
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
						<div className="flex-1 w-full flex flex-col items-center">
							{/* <nav className="w-screen absolute top-0 left-0 flex justify-center bg-transparent h-12 z-[9999]">
								<div className="w-full flex justify-between items-center px-5 text-sm">
									<div className="flex gap-5 items-center font-semibold">
										<Link href={"/"}>Transum App</Link>
									</div>
								</div>
							</nav> */}
							{children}

							{/* <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs gap-8 py-16">
								<p>
									Powered by{" "}
									<a
										href="https://supabase.com/?utm_source=create-next-app&utm_medium=template&utm_term=nextjs"
										target="_blank"
										className="font-bold hover:underline"
										rel="noreferrer"
									>
										Supabase
									</a>
								</p>
								<ThemeSwitcher />
							</footer> */}
						</div>
					</main>
				</ThemeProvider>
			</body>
		</html>
	);
}
