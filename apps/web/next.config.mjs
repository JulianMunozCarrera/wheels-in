// The site is exported as plain files, so it can be hosted anywhere for free.
// NEXT_PUBLIC_BASE_PATH is only needed when the site lives in a sub folder,
// like github.io/wheels-in.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  basePath,
  transpilePackages: ['@wheels-in/core'],
  images: { unoptimized: true },
};
