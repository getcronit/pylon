import '../globals.css'
import {SiteHeader} from '@/components/site-header'
import {SiteFooter} from '@/components/site-footer'
import {ScrollToTop} from '@/components/scroll-to-top'

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Pylon — The type-driven fullstack framework</title>
        <meta
          name="description"
          content="Write plain TypeScript. Get a production GraphQL API, an ORM, queues, auth, and a React frontend — no schema files, no codegen to babysit."
        />
        <meta name="theme-color" content="#08090a" />
        <link rel="icon" href="/favicon/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon/favicon-32x32.png" />
        <link rel="apple-touch-icon" href="/favicon/apple-touch-icon.png" />
        <meta property="og:title" content="Pylon — The type-driven fullstack framework" />
        <meta
          property="og:description"
          content="Write plain TypeScript. Get a production GraphQL API, an ORM, queues, auth, and a React frontend."
        />
        <meta name="twitter:card" content="summary_large_image" />
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Ambient background: subtle grid + accent glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10"
          style={{
            background:
              'radial-gradient(60rem 40rem at 50% -10%, rgba(56,246,252,0.08), transparent 60%), radial-gradient(50rem 30rem at 100% 0%, rgba(139,123,255,0.06), transparent 55%)'
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 -z-10 opacity-[0.18]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #ffffff08 1px, transparent 1px), linear-gradient(to bottom, #ffffff08 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'radial-gradient(70rem 50rem at 50% 0%, #000 30%, transparent 80%)'
          }}
        />

        <div className="flex min-h-screen flex-col">
          <ScrollToTop />
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </div>
      </body>
    </html>
  )
}
