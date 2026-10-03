import type { CustomerIconName } from '../components/customer-icons';

export type Mission = {
  id: string;
  title: string;
  description: string;
  icon: CustomerIconName;
  tone: 'teal' | 'orange' | 'purple' | 'pink' | 'blue';
  progress: number;
  reward: string;
  meta: string;
};

export type FamilyMember = {
  id: string;
  name: string;
  role: string;
  initials: string;
  color: string;
  status: string;
};

/**
 * Temporary presentation data. The first API contract will replace this adapter;
 * components should not import raw data from the route layer.
 */
export const customerDashboard = {
  userName: 'سارا',
  branch: {
    name: 'فانتینو ایران‌مال',
    location: 'تهران، دریاچه چیتگر',
    status: 'باز است',
    hours: 'امروز تا ساعت ۲۳:۰۰',
    eta: '۱۲ دقیقه تا شروع بازی',
  },
  wallet: {
    cardLabel: 'کارت آبی خانواده',
    balance: '۱٬۲۵۰٬۰۰۰',
    giftBalance: '۲۵۰٬۰۰۰',
    lastSync: 'همین حالا',
  },
  points: '۹۷۶۵',
  visits: '۱۲',
  missions: [
    {
      id: 'mission-explore',
      title: 'یک دور کامل کشف کن',
      description: 'از سه جاذبه‌ی جدید ایران‌مال دیدن کن.',
      icon: 'ferris-wheel',
      tone: 'orange',
      progress: 66,
      reward: '+۵۰۰ امتیاز',
      meta: '۲ از ۳ جاذبه',
    },
    {
      id: 'mission-family',
      title: 'وقت خانوادگی',
      description: 'این هفته همراه یکی از اعضای خانواده بازی کن.',
      icon: 'family',
      tone: 'teal',
      progress: 40,
      reward: 'یک نشان ویژه',
      meta: '۱ از ۲ بازی',
    },
    {
      id: 'mission-sweet',
      title: 'مزه‌ی تازه',
      description: 'یک پیشنهاد تازه از کافه‌های مجموعه امتحان کن.',
      icon: 'candy',
      tone: 'purple',
      progress: 20,
      reward: 'کوپن ۱۰٪',
      meta: 'در انتظار شروع',
    },
  ] satisfies Mission[],
  family: [
    {
      id: 'sara',
      name: 'سارا محمدی',
      role: 'والد',
      initials: 'س',
      color: 'purple',
      status: 'مدیر خانواده',
    },
    {
      id: 'armin',
      name: 'آرمین',
      role: 'عضو وابسته',
      initials: 'آ',
      color: 'teal',
      status: 'فعال',
    },
    {
      id: 'niloofar',
      name: 'نیلوفر',
      role: 'عضو وابسته',
      initials: 'ن',
      color: 'orange',
      status: 'فعال',
    },
  ] satisfies FamilyMember[],
  activities: [
    {
      id: 'activity-1',
      icon: 'target',
      title: 'مأموریت کشف شعبه',
      detail: 'پیشرفت ثبت شد',
      time: 'امروز، ۱۰:۴۲',
    },
    {
      id: 'activity-2',
      icon: 'card',
      title: 'همگام‌سازی کارت',
      detail: 'ایران‌مال',
      time: 'امروز، ۱۰:۳۸',
    },
    {
      id: 'activity-3',
      icon: 'trophy',
      title: 'نشان شروع‌کننده',
      detail: 'به مجموعه اضافه شد',
      time: 'دیروز، ۱۸:۲۰',
    },
  ],
} as const;

export const branches = [
  {
    id: 'iran-mall',
    name: 'فانتینو ایران‌مال',
    location: 'تهران، دریاچه چیتگر',
    distance: '۱۲ دقیقه',
    color: 'orange',
    attractions: '۳۶ جاذبه',
    status: 'باز است',
  },
  {
    id: 'shiraz',
    name: 'فانتینو شیراز',
    location: 'شیراز، مجتمع خلیج فارس',
    distance: '۱٬۰۵۰ کیلومتر',
    color: 'teal',
    attractions: '۲۴ جاذبه',
    status: 'باز است',
  },
  {
    id: 'mashhad',
    name: 'فانتینو مشهد',
    location: 'مشهد، سپاد',
    distance: '۸۸۰ کیلومتر',
    color: 'purple',
    attractions: '۲۸ جاذبه',
    status: 'به‌زودی باز می‌شود',
  },
] as const;
