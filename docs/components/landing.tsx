import {useState, useEffect} from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowRight,
  Code2,
  Lock,
  Zap,
  Cloud,
  Terminal,
  Box,
  Puzzle,
  Layers,
  Copy,
  ArrowUpRight,
  CheckCircle
} from 'lucide-react'
import Lottie from 'lottie-react'

import {Button} from '@/components/ui/button'
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card'
import {ClipboardButton} from './clipboard-button'
import {HoverBorderGradient} from './ui/hover-border-gradient'
import {
  GlowingStarsCard,
  GlowingStarsDescription,
  GlowingStarsTitle
} from './ui/glowing-stars-card'
import {cn} from '@lib/utils'
import {useTheme} from 'nextra-theme-docs'

const GradientBackground = ({children, className = ''}) => (
  <div className={cn('relative overflow-hidden', className)}>
    <div className="absolute inset-0 bg-gradient-to-br from-neutral-200 to-neutral-100 dark:from-primary/20 dark:to-secondary/20 opacity-50 rounded-l" />
    {children}
  </div>
)

const PatternBackground = ({pattern, className = ''}) => (
  <div
    className={cn('absolute inset-0 opacity-5 dark:opacity-10', className)}
    style={{
      backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
        pattern
      )}")`
    }}
  />
)

const FeatureCard = ({title, description, icon, pattern}) => (
  <Card
    className="group relative overflow-hidden rounded-lg border border-border dark:border-gray-800 bg-gray-100/30 dark:bg-[#111111] p-6 transition-colors hover:bg-gray-100/80 dark:hover:bg-[#151515]"
    showGradient={false}>
    <GradientBackground>
      <PatternBackground pattern={pattern} />
      <div className="relative z-10 h-[180px] flex items-center justify-center">
        <div className="text-primary size-fit">{icon}</div>
      </div>
    </GradientBackground>
    <div className="relative space-y-3 mt-8">
      <h3 className="text-xl font-bold text-primary">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  </Card>
)

const TechnologyCard = ({title, description, logo, link}) => (
  <div className="group relative overflow-hidden rounded-lg border border-border bg-gray-100/30 dark:bg-[#111111] p-6 hover:bg-gray-100/80 dark:hover:bg-[#151515] transition-colors">
    <div className="h-12 w-12 mb-4 relative">
      <Image src={logo} alt={`${title} logo`} fill className="object-contain" />
    </div>
    <div className="flex items-center gap-2 mb-2">
      <h3 className="text-lg font-semibold text-primary">{title}</h3>
      {/* <ArrowUpRight className="h-4 w-4 text-gray-400 group-hover:text-white transition-colors" /> */}
    </div>
    <p className="text-sm text-muted-foreground mb-4">{description}</p>
    <Link
      href={link}
      className="text-primary hover:underline inline-flex items-center">
      Learn more
      <ArrowRight className="ml-2 size-4" />
    </Link>
  </div>
)

const RuntimeCard = ({title, description, logo, link, logoClassName = ''}) => (
  <Card
    className="group relative overflow-hidden rounded-lg border border-border dark:border-gray-800 bg-gray-100/30 dark:bg-[#111111] hover:bg-gray-100/80 dark:hover:bg-[#151515] transition-colors"
    showGradient={false}>
    <CardHeader>
      <CardTitle className="text-primary flex items-center gap-3">
        <div className="w-12 h-12 relative">
          <Image
            src={logo}
            alt={`${title} logo`}
            fill
            className={cn('object-contain', logoClassName)}
          />
        </div>
        {title}
      </CardTitle>
    </CardHeader>
    <CardContent>
      <p className="text-sm text-muted-foreground mb-4">{description}</p>
      <Link
        href={link}
        className="text-primary hover:underline inline-flex items-center">
        Learn more
        <ArrowRight className="ml-2 h-4 w-4" />
      </Link>
    </CardContent>
  </Card>
)

const patterns = {
  dots: `<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><circle cx="2" cy="2" r="1" fill="currentColor"/></svg>`,
  lines: `<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><path d="M0 10h20v1H0z" fill="currentColor"/></svg>`,
  squares: `<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4" x="2" y="2" fill="currentColor"/></svg>`,
  circles: `<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="3" fill="currentColor"/></svg>`,
  zigzag: `<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><path d="M0 5 L5 0 L10 5 L15 0 L20 5" stroke="currentColor" fill="none"/></svg>`,
  waves: `<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><path d="M0 10 Q5 5, 10 10 T 20 10" stroke="currentColor" fill="none"/></svg>`,
  triangles: `<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><polygon points="10,2 18,18 2,18" fill="currentColor"/></svg>`,
  hexagons: `<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><polygon points="10,1 19,5 19,15 10,19 1,15 1,5" fill="currentColor"/></svg>`
}

export function Landing() {
  const {resolvedTheme} = useTheme()
  const [animationData, setAnimationData] = useState(null)

  useEffect(() => {
    fetch(
      'https://lottie.host/c32b1c68-74ef-4a25-91b2-11f792317480/we8GALnU48.json'
    )
      .then(response => response.json())
      .then(data => setAnimationData(data))
      .catch(error => console.error('Error loading Lottie animation:', error))
  }, [])

  return (
    <div className="flex min-h-screen flex-col mx-auto text-primary">
      {/* Hero */}
      <section className="mx-auto flex max-w-[980px] flex-col items-center gap-2 py-8 md:py-12 md:pb-8 lg:py-24 lg:pb-20 px-4">
        <h1 className="text-center text-4xl font-bold leading-tight tracking-tighter md:text-6xl lg:leading-[1.1]">
          The Next Generation of
          <br />
          Building APIs
        </h1>
        <p className="max-w-[750px] text-center text-lg text-muted-foreground sm:text-xl mt-4">
          Used by innovative teams worldwide, Pylon enables you to create
          <span className="font-semibold text-primary">
            {' '}
            high-quality GraphQL APIs{' '}
          </span>
          without defining any schema.
        </p>
        <Link href="/docs/getting-started#quick-start">
          <HoverBorderGradient
            containerClassName="rounded-lg mt-6 border-border"
            as="button">
            <span>Get started</span>
          </HoverBorderGradient>
        </Link>

        {/* <Button
          size="lg"
          className="mt-6 bg-white text-black hover:bg-gray-200">
          Get started
        </Button> */}
        <div className="w-full max-w-3xl mt-8">
          <div className="relative overflow-hidden rounded-lg border border-border bg-gray-100/30 dark:bg-[#111111]">
            <div className="flex items-center justify-between p-4">
              <div className="flex items-center space-x-2">
                <div className="h-3 w-3 rounded-full bg-red-500"></div>
                <div className="h-3 w-3 rounded-full bg-yellow-500"></div>
                <div className="h-3 w-3 rounded-full bg-green-500"></div>
              </div>
              <ClipboardButton
                text="npm create pylon@latest"
                variant="ghost"
                size="icon"
                className="text-muted-foreground/80 hover:text-muted-foreground">
                <Copy className="h-4 w-4" />
                <span className="sr-only">Copy code</span>
              </ClipboardButton>
            </div>
            <div className="py-4 pt-0">
              <pre className="overflow-x-auto">
                <code className="flex text-sm">
                  <span className="text-blue-400">npm</span>&nbsp;create
                  pylon@latest
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="w-full max-w-7xl py-20 mx-auto">
        <div className="container mx-auto px-4 md:px-6">
          <div className="space-y-3 mb-10">
            <h2 className="text-3xl font-bold tracking-tight mr-2">
              What&apos;s in Pylon?
            </h2>
            <p className="text-lg text-muted-foreground">
              Everything you need to build production-ready GraphQL APIs.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              title="Zero Schema Definition"
              description="Automatic schema generation from your TypeScript types. Focus on your service logic, not schema definitions."
              icon={<Code2 className="size-[50px] text-primary" />}
              pattern={patterns.dots}
            />
            <FeatureCard
              title="Type Safety"
              description="End-to-end type safety from your resolvers to your clients. Catch errors before they reach production."
              icon={<Terminal className="size-[50px] text-primary" />}
              pattern={patterns.lines}
            />
            <FeatureCard
              title="Built-in Auth"
              description="Authentication and authorization built right in. Secure your API endpoints with minimal configuration."
              icon={<Lock className="size-[50px] text-primary" />}
              pattern={patterns.squares}
            />
            <FeatureCard
              title="Edge Ready"
              description="Deploy to the edge with multiple runtime support. Run your API closer to your users."
              icon={<Cloud className="size-[50px] text-primary" />}
              pattern={patterns.circles}
            />
            <FeatureCard
              title="Developer Experience"
              description="Built-in playground and comprehensive documentation. Start building immediately with intuitive tools."
              icon={<Zap className="size-[50px] text-primary" />}
              pattern={patterns.zigzag}
            />
            <FeatureCard
              title="GraphQL Types Support"
              description="Full support for Types, Interfaces, and Unions. Build complex schemas with ease."
              icon={<Box className="size-[50px] text-primary" />}
              pattern={patterns.waves}
            />
            <FeatureCard
              title="Hono Integration"
              description="Leverage Hono's powerful middleware and routing capabilities for enhanced API functionality."
              icon={<Puzzle className="size-[50px] text-primary" />}
              pattern={patterns.triangles}
            />
            <FeatureCard
              title="Multiple Runtimes"
              description="Deploy to NodeJS, Bun, Cloudflare Workers, or Deno. Choose the runtime that fits your needs."
              icon={<Layers className="size-[50px] text-primary" />}
              pattern={patterns.hexagons}
            />
            <Link href="/blog/pylon-2.3">
              <GlowingStarsCard
                className="h-full rounded-lg bg-gray-100/30 dark:bg-[#111111] hover:bg-gray-100/80 dark:hover:bg-[#151515]"
                hoverEfect={false}>
                <GlowingStarsTitle className="mt-8 text-xl text-primary">
                  Pylon 2.3
                </GlowingStarsTitle>
                <div className="flex justify-between items-end">
                  <GlowingStarsDescription className="text-muted-foreground mt-3">
                    Full Support for TypeScript Interfaces and Unions in Pylon
                  </GlowingStarsDescription>
                  <ArrowRight className="h-6 w-6 text-muted-foreground group-hover:text-white transition-colors" />
                </div>
              </GlowingStarsCard>
            </Link>
          </div>
        </div>
      </section>

      {/* Foundation / Powered By */}
      <section className="w-full py-24 px-8 md:px-12 overflow-hidden bg-gradient-to-b from-transparent to-muted dark:to-gray-900 border-b dark:border-b-transparent border-b-border">
        <div className="container mx-auto px-4 md:px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-8 max-w-[800px] mx-auto">
            Built on a Foundation of Fast, Production-Grade Tooling
          </h2>

          <div className="relative">
            {/* Powered By Box with Lottie Animation */}
            <div className="relative z-10 w-full max-w-2xl mx-auto mb-16">
              <p className="text-gray-400 text-lg mb-4 text-center">
                Powered By
              </p>
              {animationData && (
                <Lottie
                  animationData={animationData}
                  loop={true}
                  style={{width: '100%', height: 100}}
                />
              )}
            </div>

            {/* Technology Cards */}
            <div className="grid md:grid-cols-3 gap-6 relative z-10 mt-12">
              <TechnologyCard
                title="TypeScript"
                description="End-to-end type safety with automatic schema generation from your TypeScript types."
                logo="https://raw.githubusercontent.com/github/explore/80688e429a7d4ef2fca1e82350fe8e3517d3494d/topics/typescript/typescript.png"
                link="https://www.typescriptlang.org/"
              />
              <TechnologyCard
                title="Hono"
                description="A small, simple, and ultrafast web framework for the Edges. Perfect for building high-performance APIs."
                logo="https://raw.githubusercontent.com/honojs/hono/main/docs/images/hono-logo.png"
                link="https://hono.dev/"
              />
              <TechnologyCard
                title="GraphQL Yoga"
                description="A fully-featured GraphQL server with focus on easy setup, performance and great developer experience."
                logo="https://raw.githubusercontent.com/dotansimha/graphql-yoga/main/website/public/assets/logo.svg"
                link="https://the-guild.dev/graphql/yoga-server"
              />
            </div>

            {/* Supported Runtimes */}
            <div className="mt-24">
              <h3 className="text-3xl font-bold mb-8 text-center">
                Supported Runtimes
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <RuntimeCard
                  title="Node.js"
                  description="Deploy your Pylon API on Node.js for a robust and widely-supported runtime environment. Leverage the vast npm ecosystem and benefit from long-term support versions."
                  logo={
                    resolvedTheme === 'dark'
                      ? 'https://nodejs.org/static/images/logo.svg'
                      : 'https://nodejs.org/static/logos/nodejsDark.svg'
                  }
                  link="https://nodejs.org/"
                />
                <RuntimeCard
                  title="Bun"
                  description="Harness Bun's speed and efficiency for lightning-fast API performance with Pylon. Enjoy faster startup times, lower memory usage, and improved overall performance."
                  logo="https://bun.sh/logo.svg"
                  link="https://bun.sh/"
                />
                <RuntimeCard
                  title="Cloudflare Workers"
                  description="Run your Pylon API on the edge with Cloudflare Workers for global low-latency access. Benefit from serverless deployment and automatic scaling across Cloudflare's global network."
                  logo="https://icon.icepanel.io/Technology/svg/Cloudflare-Workers.svg"
                  link="https://workers.cloudflare.com/"
                />
                <RuntimeCard
                  title="Deno"
                  description="Utilize Deno's modern features and built-in security for your Pylon-powered GraphQL API. Enjoy secure defaults, a rich standard library, and a fresh approach to server-side TypeScript."
                  logo="https://upload.wikimedia.org/wikipedia/commons/8/84/Deno.svg"
                  link="https://deno.land/"
                  logoClassName="dark:invert"
                />
              </div>
              <p className="text-muted-foreground max-w-2xl mx-auto mt-12 text-center">
                Pylon is designed to be runtime-agnostic, allowing you to deploy
                your GraphQL API to various environments. Choose the runtime
                that best fits your project's needs and infrastructure
                requirements.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Improved CTA */}
      <section className="relative py-16 md:py-24 overflow-hidden ">
        <div className="container mx-auto relative z-10 px-4 md:px-6">
          <div className="mx-auto max-w-5xl">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold leading-tight tracking-tighter md:text-5xl lg:leading-[1.1] mb-4">
                Start Building Powerful APIs Today
              </h2>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                Join hundreds of developers who are revolutionizing API
                development with Pylon.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 mb-12">
              <Card
                className="group relative overflow-hidden rounded-lg border border-border dark:border-gray-800 bg-gray-100/30 dark:bg-[#111111] hover:bg-gray-100/80 dark:hover:bg-[#151515] transition-colors"
                showGradient={false}>
                <CardHeader>
                  <CardTitle className="text-2xl font-bold text-primary">
                    Documentation
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">
                    Explore our comprehensive documentation to get started with
                    Pylon and learn about all its features.
                  </p>
                  <Button asChild className="w-full">
                    <Link href="/docs">View Documentation</Link>
                  </Button>
                </CardContent>
              </Card>
              <Card
                className="group relative overflow-hidden rounded-lg border border-border dark:border-gray-800 bg-gray-100/30 dark:bg-[#111111] hover:bg-gray-100/80 dark:hover:bg-[#151515] transition-colors"
                showGradient={false}>
                <CardHeader>
                  <CardTitle className="text-2xl font-bold text-primary">
                    Open Source
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground mb-4">
                    Pylon is open source. Contribute, report issues, or star our
                    GitHub repository to support the project.
                  </p>
                  <Button asChild className="w-full">
                    <Link href="https://github.com/getcronit/pylon">
                      View on GitHub
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>

            <div className="text-center">
              <blockquote className="italic text-xl text-muted-foreground mb-4">
                "Pylon is the foundation of our greater vision to make backend
                development easier and faster. It's revolutionizing how we build
                and scale APIs."
              </blockquote>
              <div className="flex items-center justify-center">
                <Image
                  src="https://avatars.githubusercontent.com/u/52858351?v=4"
                  width={40}
                  height={40}
                  alt="Nico Schett"
                  className="rounded-full mr-4"
                />
                <div className="text-left">
                  <p className="font-semibold">Nico Schett</p>
                  <p className="text-sm text-muted-foreground">CEO, Cronit</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
