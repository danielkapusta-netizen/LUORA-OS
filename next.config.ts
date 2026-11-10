import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // A new id per build: a tab opened before a deploy then reloads on its next click instead of
  // calling pages and server actions that no longer exist (which showed "This page couldn't load").
  deploymentId: process.env.NEXT_DEPLOYMENT_ID ?? `b${Date.now().toString(36)}`,
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
};

export default nextConfig;

// Gives `next dev` the D1, Queue and R2 bindings from wrangler.jsonc (local simulations).
initOpenNextCloudflareForDev();
