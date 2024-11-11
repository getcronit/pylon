import React from 'react'
import {DocsThemeConfig, Link, useConfig} from 'nextra-theme-docs'

import Logo from './components/logo'
import {useRouter} from 'next/router'

const config: DocsThemeConfig = {
  banner: {
    key: '2.0-release',
    text: (
      <a href="/blog/pylon-2.3" target="_blank">
        🎉 Pylon 2.3 is released. Read more →
      </a>
    )
  },
  logo: <Logo />,
  project: {
    link: 'https://github.com/getcronit/pylon'
  },
  chat: {
    link: 'https://discord.gg/cbJjkVrnHe'
  },
  docsRepositoryBase: 'https://github.com/getcronit/pylon/tree/main/docs',
  footer: {
    text: (
      <div className="container flex flex-col items-center justify-between gap-4 md:flex-row">
        <p className="w-full text-center text-sm leading-loose text-gray-400 md:!text-left">
          Built by{' '}
          <a
            href="https://cronit.io"
            className="font-medium underline underline-offset-4 hover:text-white">
            Cronit
          </a>
          . The source code is available on{' '}
          <a
            href="https://github.com/getcronit/pylon"
            className="font-medium underline underline-offset-4 hover:text-white">
            GitHub
          </a>
          .
        </p>
      </div>
    )
  },
  nextThemes: {
    defaultTheme: 'dark'
  },
  useNextSeoProps() {
    const {asPath} = useRouter()
    if (asPath !== '/') {
      return {
        titleTemplate: '%s – Pylon'
      }
    }
  },
  head: function useHead() {
    const config = useConfig<{description?: string; image?: string}>()
    const description =
      config.frontMatter.description ||
      'A code-first framework for GraphQL API development, where your schema reflects your functionality.'
    const image = config.frontMatter.image || '/images/logo.png'
    return (
      <>
        {/* Favicons, meta */}
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/favicon/apple-touch-icon.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href="/favicon/favicon-32x32.png"
        />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href="/favicon/favicon-16x16.png"
        />
        <link rel="manifest" href="/favicon/site.webmanifest" />
        <link
          rel="mask-icon"
          href="/favicon/safari-pinned-tab.svg"
          color="#5bbad5"
        />
        <link rel="shortcut icon" href="/favicon/favicon.ico" />
        <meta name="msapplication-TileColor" content="#da532c" />
        <meta
          name="msapplication-config"
          content="/favicon/browserconfig.xml"
        />
        <meta name="theme-color" content="#ffffff" />

        <meta httpEquiv="Content-Language" content="en" />
        <meta name="description" content={description} />
        <meta name="og:description" content={description} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@getcronit" />
        <meta name="twitter:image" content={image} />
        <meta name="og:site_name" content="Pylon" />
        <meta name="og:title" content={`${config.title} – Pylon`} />
        <meta name="og:image" content={image} />
        <meta name="apple-mobile-web-app-title" content="Pylon" />
      </>
    )
  }
}

export default config
