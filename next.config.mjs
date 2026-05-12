const nextConfig = {
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  typescript: { ignoreBuildErrors: true, tsconfigPath: './tsconfig.json' },
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingExcludes: { '*': ['./repos/**', './scratch/**'] },
  // Don't compile or trace files inside repos/ — those are read-only mirrors,
  // not part of this app's source. Only the runtime tools read from them.
  webpack: (config) => {
    config.module.rules.push({ test: /repos\//, use: 'null-loader' });
    return config;
  },
};
export default nextConfig;
