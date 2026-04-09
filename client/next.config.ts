import type { NextConfig } from "next";

const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || 'http://127.0.0.1:3008';

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${serverUrl}/api/:path*`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${serverUrl}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
