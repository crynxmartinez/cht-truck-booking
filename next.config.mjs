/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['sharp', '@prisma/client'],
  experimental: {
    // Uploads from the checklist can carry several photos at once.
    serverActions: { bodySizeLimit: '20mb' },
  },
};

export default nextConfig;
