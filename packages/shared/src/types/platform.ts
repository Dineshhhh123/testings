import type { platformModules } from '../constants/platform';

export type PlatformModule = (typeof platformModules)[number];

export type DashboardStat = {
  label: string;
  value: string;
  description: string;
};
