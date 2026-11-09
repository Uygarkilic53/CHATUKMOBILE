export interface WallpaperItem {
  id: string;
  name: string;
  aesthetic: string;
  category: string;
  source: number | { uri: string } | null;
  dominantColor?: string;
  assetType?: 'bundled' | 'remote' | 'custom';
  remoteUrl?: string;
  localUri?: string;
  bundledSourceKey?: string;
  isAvailableOffline?: boolean;
}

export const DEFAULT_WALLPAPER_ID = 'default';

export const WALLPAPERS: WallpaperItem[] = [
  {
    id: 'default',
    name: 'Default (None)',
    aesthetic: 'Clean solid canvas based on active theme',
    category: 'Default',
    source: null,
    dominantColor: '#0B0F17',
  },
  {
    id: 'wallpaper_nordic',
    name: 'Nordic Mist',
    aesthetic: 'Alpine forest, pale morning fog, slate & pine',
    category: 'Nature / Minimal',
    source: require('../../assets/wallpapers/wallpaper_nordic.png'),
    dominantColor: '#4A5568',
  },
  {
    id: 'wallpaper_botanical',
    name: 'Warm Botanical',
    aesthetic: 'Linen, terracotta & sage abstract shapes',
    category: 'Warm / Editorial',
    source: require('../../assets/wallpapers/wallpaper_botanical.png'),
    dominantColor: '#C4A482',
  },
  {
    id: 'wallpaper_zen',
    name: 'Zen Garden',
    aesthetic: 'Washi paper fibrous texture, bamboo shadow silhouette',
    category: 'Calm / Neutral',
    source: require('../../assets/wallpapers/wallpaper_zen.png'),
    dominantColor: '#D8D2C2',
  },
  {
    id: 'wallpaper_midnight',
    name: 'Midnight Navy',
    aesthetic: 'Charcoal & smoky indigo fluid gradients, frosted glass',
    category: 'Dark Mode',
    source: require('../../assets/wallpapers/wallpaper_midnight.png'),
    dominantColor: '#0F172A',
  },
  {
    id: 'wallpaper_aurora',
    name: 'Cosmic Aurora',
    aesthetic: 'Deep cosmic purple & emerald green aurora ribbon',
    category: 'Dark / Celestial',
    source: require('../../assets/wallpapers/wallpaper_aurora.png'),
    dominantColor: '#1E1B4B',
  },
  {
    id: 'wallpaper_prism',
    name: 'Frosted Prism',
    aesthetic: 'Translucent glassmorphism acrylic with caustic light',
    category: 'Tech / Daylight',
    source: require('../../assets/wallpapers/wallpaper_prism.png'),
    dominantColor: '#E2E8F0',
  },
  {
    id: 'wallpaper_sunset',
    name: 'Warm Dusk',
    aesthetic: 'Retro sunset terracotta, amber gold & dusky mauve',
    category: 'Warm / Dusk',
    source: require('../../assets/wallpapers/wallpaper_sunset.png'),
    dominantColor: '#9A3412',
  },
  {
    id: 'wallpaper_daylight',
    name: 'Pastel Daylight',
    aesthetic: 'Ethereal peach, sky blue & gentle clouds',
    category: 'Soft / Daylight',
    source: require('../../assets/wallpapers/wallpaper_daylight.png'),
    dominantColor: '#FED7AA',
  },
];

export function getWallpaperById(id?: string | null): WallpaperItem {
  if (!id || id === DEFAULT_WALLPAPER_ID) {
    return WALLPAPERS[0];
  }
  const match = WALLPAPERS.find((w) => w.id === id);
  return match || WALLPAPERS[0];
}
