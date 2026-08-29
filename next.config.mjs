/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // sharp and Prisma ship native binaries; bundling them breaks the runtime.
  serverExternalPackages: ['sharp', '@prisma/client'],
};

export default nextConfig;
