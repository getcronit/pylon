const withNextra = require('nextra')({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.tsx',
  cleanDistDir: true
})

module.exports = withNextra({
  images: {
    domains: [
      'raw.githubusercontent.com',
      'avatars.githubusercontent.com',
      'upload.wikimedia.org'
    ]
  },
  async redirects() {
    return [
      {
        source: '/docs',
        destination: '/docs/getting-started',
        permanent: true
      }
    ]
  }
})
