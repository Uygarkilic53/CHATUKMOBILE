export type ThemeMode = 'light' | 'obsidian-sky';

export interface ThemeColors {
  id: ThemeMode;
  name: string;
  tagline: string;
  isDark: boolean;
  statusBarStyle: 'light' | 'dark';

  // Base canvas & surfaces
  surface: string;
  background: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;

  // Content & Typography
  onSurface: string;
  onSurfaceVariant: string;
  onPrimary: string;

  // Accents & Brand
  primary: string;
  primaryLight: string;
  primaryContainer: string;
  secondary: string;
  secondaryContainer: string;
  tertiary: string;

  // Borders & Dividers
  outline: string;
  outlineVariant: string;
  divider: string;

  // Feedback & Status
  error: string;
  errorContainer: string;
  success: string;
  online: string;

  // Cards & Containers
  card: string;
  cardItem: string;
  cardBorder: string;

  // Gradients & Ambient Effects
  gradient: [string, string];
  ambientGlow: string;
}

export const LIGHT_THEME: ThemeColors = {
  id: 'light',
  name: 'Chatuk Light',
  tagline: 'Clean indigo canvas with crisp contrast',
  isDark: false,
  statusBarStyle: 'dark',

  surface: '#F8FAFC',
  background: '#F8FAFC',
  surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F8FAFC',
  surfaceContainer: '#FFFFFF',
  surfaceContainerHigh: '#FFFFFF',
  surfaceContainerHighest: '#F1F5F9',

  onSurface: '#0F172A',
  onSurfaceVariant: '#64748B',
  onPrimary: '#FFFFFF',

  primary: '#6366F1',
  primaryLight: '#818CF8',
  primaryContainer: '#6366F1',
  secondary: '#A855F7',
  secondaryContainer: '#7C3AED',
  tertiary: '#C084FC',

  outline: '#94A3B8',
  outlineVariant: '#E2E8F0',
  divider: '#F1F5F9',

  error: '#EF4444',
  errorContainer: '#FEF2F2',
  success: '#10B981',
  online: '#10B981',

  card: '#FFFFFF',
  cardItem: '#F8FAFC',
  cardBorder: '#E2E8F0',

  gradient: ['#6366F1', '#A855F7'],
  ambientGlow: 'rgba(99, 102, 241, 0.15)',
};

export const OBSIDIAN_SKY_THEME: ThemeColors = {
  id: 'obsidian-sky',
  name: 'Chatuk Dark',
  tagline: 'Technical minimalism with radiant indigo & purple accents',
  isDark: true,
  statusBarStyle: 'light',

  surface: '#0F172A',
  background: '#0F172A',
  surfaceContainerLowest: '#060E20',
  surfaceContainerLow: '#131B2E',
  surfaceContainer: '#171F33',
  surfaceContainerHigh: '#1E293B',
  surfaceContainerHighest: '#2D3449',

  onSurface: '#F8FAFC',
  onSurfaceVariant: '#94A3B8',
  onPrimary: '#FFFFFF',

  primary: '#6366F1',
  primaryLight: '#818CF8',
  primaryContainer: '#6366F1',
  secondary: '#A855F7',
  secondaryContainer: '#7C3AED',
  tertiary: '#C084FC',

  outline: '#334155',
  outlineVariant: 'rgba(255, 255, 255, 0.1)',
  divider: 'rgba(255, 255, 255, 0.08)',

  error: '#EF4444',
  errorContainer: 'rgba(239, 68, 68, 0.15)',
  success: '#10B981',
  online: '#10B981',

  card: '#1E293B',
  cardItem: '#131B2E',
  cardBorder: 'rgba(255, 255, 255, 0.1)',

  gradient: ['#6366F1', '#A855F7'],
  ambientGlow: 'rgba(99, 102, 241, 0.25)',
};

export const THEMES: Record<ThemeMode, ThemeColors> = {
  'light': LIGHT_THEME,
  'obsidian-sky': OBSIDIAN_SKY_THEME,
};

export const FONTS = {
  regular: 'PlusJakartaSans-Regular',
  medium: 'PlusJakartaSans-Medium',
  semiBold: 'PlusJakartaSans-SemiBold',
  bold: 'PlusJakartaSans-Bold',
  extraBold: 'PlusJakartaSans-ExtraBold',
  italic: 'PlusJakartaSans-Italic',
  semiBoldItalic: 'PlusJakartaSans-SemiBoldItalic',
  boldItalic: 'PlusJakartaSans-BoldItalic',
} as const;

export type FontFamily = typeof FONTS[keyof typeof FONTS];

