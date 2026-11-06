/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Runs instrumentation.ts at server start so env validation fails fast at boot.
    instrumentationHook: true,
  },
};

export default nextConfig;
