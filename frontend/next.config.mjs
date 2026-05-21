/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: { ignoreBuildErrors: true },
  eslint:     { ignoreDuringBuilds: true },

  async headers() {
    return [
      {
        // Allow /embed to be loaded inside an <iframe> from ANY origin.
        // CSP frame-ancestors supersedes X-Frame-Options in modern browsers.
        source: '/embed',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors *" },
          { key: 'X-Frame-Options',         value: 'ALLOWALL' },
        ],
      },
    ]
  },

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://backend:3001'}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
