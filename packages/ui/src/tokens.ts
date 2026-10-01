/**
 * Hellogram design tokens (docs/ARCHITECTURE.md §14).
 * Values are taken from the design images; `theme.css` exposes them as CSS variables
 * and Tailwind utilities. Keep both files in sync.
 */
export const palette = {
  dark: {
    bg: '#0B0B14',
    surface1: '#14141F',
    surface2: '#1A1A28',
    surface3: '#232334',
    border: '#2A2A3A',
    text: '#F4F4F8',
    textMuted: '#9A9AB0',
    primary: '#7C5CFF',
    primarySoft: '#7C5CFF29',
    success: '#22C55E',
    warning: '#F5A524',
    danger: '#EF4444',
  },
  light: {
    bg: '#F7F7FB',
    surface1: '#FFFFFF',
    surface2: '#F0F0F6',
    surface3: '#E8E8F1',
    border: '#E3E3EC',
    text: '#12121A',
    textMuted: '#5E5E72',
    primary: '#6A48F5',
    primarySoft: '#6A48F51F',
    success: '#16A34A',
    warning: '#D97706',
    danger: '#DC2626',
  },
} as const;

export const gradients = {
  primary: 'linear-gradient(90deg, #4F8BFF 0%, #8B5CF6 55%, #E056C8 100%)',
  logo: 'linear-gradient(135deg, #4F8BFF 0%, #8B5CF6 50%, #E056C8 100%)',
} as const;

export const labelColors = {
  olx: '#F59E0B',
  dating: '#EC4899',
  tenants: '#3B82F6',
  other: '#9A9AB0',
} as const;

export const radii = { sm: '8px', md: '12px', lg: '16px', xl: '24px', full: '9999px' } as const;

export const fonts = {
  sans: '"Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const;

export const touchTarget = '44px';
