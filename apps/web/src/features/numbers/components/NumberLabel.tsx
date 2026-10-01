import { LABEL_ICONS, type LabelIcon } from '@hellogram/shared';
import { LabelChip, type LabelTone } from '@hellogram/ui';
import {
  Baby,
  Briefcase,
  Building2,
  Camera,
  Car,
  Dumbbell,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  House,
  Music,
  PawPrint,
  Plane,
  ShoppingBag,
  Stethoscope,
  Tag,
  Users,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { t } from '../../../i18n/t.js';

/** The icons a user can give a label, with the colour family each one uses. */
export const LABEL_ICON_SET: Record<LabelIcon, { Icon: LucideIcon; tone: LabelTone }> = {
  tag: { Icon: Tag, tone: 'gray' },
  'shopping-bag': { Icon: ShoppingBag, tone: 'amber' },
  heart: { Icon: Heart, tone: 'pink' },
  home: { Icon: House, tone: 'blue' },
  briefcase: { Icon: Briefcase, tone: 'blue' },
  car: { Icon: Car, tone: 'amber' },
  'graduation-cap': { Icon: GraduationCap, tone: 'violet' },
  stethoscope: { Icon: Stethoscope, tone: 'violet' },
  utensils: { Icon: UtensilsCrossed, tone: 'amber' },
  dumbbell: { Icon: Dumbbell, tone: 'violet' },
  plane: { Icon: Plane, tone: 'blue' },
  gamepad: { Icon: Gamepad2, tone: 'violet' },
  music: { Icon: Music, tone: 'pink' },
  paw: { Icon: PawPrint, tone: 'amber' },
  baby: { Icon: Baby, tone: 'pink' },
  wrench: { Icon: Wrench, tone: 'gray' },
  building: { Icon: Building2, tone: 'blue' },
  users: { Icon: Users, tone: 'violet' },
  gift: { Icon: Gift, tone: 'pink' },
  camera: { Icon: Camera, tone: 'gray' },
};

const known = (icon: string): LabelIcon => ((LABEL_ICONS as readonly string[]).includes(icon) ? (icon as LabelIcon) : 'tag');

export function LabelGlyph({ icon, className }: { icon: string; className?: string }) {
  const { Icon } = LABEL_ICON_SET[known(icon)];
  return <Icon className={className} aria-hidden />;
}

/** A number's label as a chip: its icon and the user's own text (e.g. "via OLX"). */
export function NumberLabel({
  of,
  prefix,
  className,
}: {
  of: { labelIcon: string; labelName: string };
  prefix?: string;
  className?: string;
}) {
  const { tone } = LABEL_ICON_SET[known(of.labelIcon)];
  return <LabelChip name={of.labelName} icon={<LabelGlyph icon={of.labelIcon} />} tone={tone} prefix={prefix} className={className} />;
}

export const iconName = (icon: LabelIcon) => t(`numbers.icons.${icon}`);
