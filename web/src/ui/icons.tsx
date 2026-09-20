import type { ReactNode } from 'react';
import { brand } from '../brand';

const I = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    <path d={brand.logoPath} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconField = () => <I><path d="M3 8l9-4 9 4-9 4-9-4z" /><path d="M3 8v7l9 4 9-4V8" /><path d="M12 12v7" /></I>;
export const IconPour = () => <I><path d="M12 3c3 3.600 5 6.200 5 9a5 5 0 0 1-10 0c0-2.800 2-5.400 5-9z" /><path d="M4 21h16" /></I>;
export const IconHistory = () => <I><path d="M3 12a9 9 0 1 0 3-6.700" /><path d="M3 4v4h4" /><path d="M12 8v4l3 2" /></I>;
export const IconNetwork = () => <I><circle cx="12" cy="18" r="1.6" /><path d="M8.500 14.500a5 5 0 0 1 7 0" /><path d="M5.500 11.500a9 9 0 0 1 13 0" /><path d="M2.500 8.500a13 13 0 0 1 19 0" /></I>;
export const IconEdit = () => <I><path d="M4 20h4l10-10-4-4L4 16v4z" /><path d="M13.500 6.500l4 4" /></I>;
export const IconSoil = () => <I><path d="M3 9h18" /><path d="M3 14h18" /><path d="M3 19h18" /><circle cx="8" cy="11.500" r=".6" /><circle cx="15" cy="16.500" r=".6" /><path d="M12 9V5" /><path d="M12 5c0-1.500 1.500-2.500 3-2.500 0 1.500-1.500 2.500-3 2.500z" /></I>;
export const IconSprout = () => <I><path d="M12 21v-9" /><path d="M12 12c0-3.500-2.500-6-6.500-6 0 3.500 2.500 6 6.500 6z" /><path d="M12 9.500c0-2.500 2-4.500 5.500-4.500 0 2.500-2 4.500-5.500 4.500z" /></I>;
export const IconCalendar = () => <I><rect x="3.500" y="5" width="17" height="15" rx="2.500" /><path d="M3.500 10h17" /><path d="M8 3v4M16 3v4" /></I>;
export const IconDrop = () => <I><path d="M12 3c3.400 4 6 7 6 10.300a6 6 0 0 1-12 0C6 10 8.600 7 12 3z" /></I>;
export const IconScan = () => <I><path d="M4 8V5.500A1.500 1.500 0 0 1 5.500 4H8M16 4h2.500A1.500 1.500 0 0 1 20 5.500V8M20 16v2.500a1.500 1.500 0 0 1-1.500 1.500H16M8 20H5.500A1.500 1.500 0 0 1 4 18.500V16" /><path d="M4 12h16" /></I>;
export const IconClose = () => <I size={16}><path d="M6 6l12 12M18 6L6 18" /></I>;
export const IconCheck = () => <I size={16}><path d="M5 12.500l4.500 4.500L19 7.500" /></I>;
export const IconArrow = () => <I size={16}><path d="M5 12h14M13 6l6 6-6 6" /></I>;
export const IconPlay = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7 4.500v15l13-7.500z" /></svg>;
export const IconPause = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="4.500" width="4.500" height="15" rx="1" /><rect x="13.500" y="4.500" width="4.500" height="15" rx="1" /></svg>;
export const IconPin = () => <I size={16}><path d="M12 21s7-6.200 7-11.500A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21z" /><circle cx="12" cy="9.500" r="2.500" /></I>;
export const IconSpark = () => <I size={16}><path d="M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800z" /></I>;
export const IconThermo = () => <I size={16}><path d="M10 13.500V5a2 2 0 0 1 4 0v8.500a4 4 0 1 1-4 0z" /></I>;
export const IconEye = () => <I size={16}><path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z" /><circle cx="12" cy="12" r="2.500" /></I>;

export const IconDish = () => <I size={15}><path d="M4 10a8 8 0 0 0 10 10" /><path d="M4 10l10 10" /><path d="M9 15l5.500-5.500" /><circle cx="15.500" cy="8.500" r="1.200" /><path d="M15 3.500a5.500 5.500 0 0 1 5.500 5.500" /></I>;
export const IconRegion = () => <I><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z" /><path d="M9 4v13M15 7v13" /></I>;
export const IconHome = () => <I><path d="M4 11l8-7 8 7" /><path d="M6 10v9h12v-9" /></I>;
export const IconMail = () => <I size={16}><rect x="3" y="5" width="18" height="14" rx="2.500" /><path d="M3.500 7l8.500 6 8.500-6" /></I>;
