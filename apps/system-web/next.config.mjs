/** @type {import('next').NextConfig} */
const accessibilityDistDir = process.env.FUNTINO_A11Y_DIST_DIR;
if (accessibilityDistDir && !/^\.next-a11y-[a-z0-9-]+$/.test(accessibilityDistDir)) {
  throw new Error('FUNTINO_A11Y_DIST_DIR must be a generated .next-a11y-* directory name.');
}

const nextConfig = {
  ...(accessibilityDistDir ? { distDir: accessibilityDistDir } : {}),
  poweredByHeader: false,
  transpilePackages: ['@funtino/design-system'],
};

export default nextConfig;
