import type { NextConfig } from 'next';

const normalizeOrigin = (value: string) => value.replace(/\/$/, '');

const backendOrigin = process.env.BACKEND_ORIGIN
  ? normalizeOrigin(process.env.BACKEND_ORIGIN)
  : process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000'
    : undefined;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (!backendOrigin) {
      return [];
    }

    return [
      {
        source: '/api/:path*',
        destination: `${backendOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
