import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'فانتینو',
    short_name: 'فانتینو',
    description: 'تجربه‌ی بازی، کارت و خانواده در فانتینو',
    start_url: '/fa',
    display: 'standalone',
    dir: 'rtl',
    lang: 'fa',
    background_color: '#f8f7fc',
    theme_color: '#0ecfc1',
    icons: [
      {
        src: '/brand/funtino-logo.png',
        sizes: '1222x451',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
