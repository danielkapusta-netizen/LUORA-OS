import {
  BarChart3,
  BadgePercent,
  Boxes,
  LayoutDashboard,
  LineChart,
  Receipt,
  Settings,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Shown in the sidebar as a count or status pill. */
  badge?: 'insights'
  description: string
}

export interface NavSection {
  label: string
  items: NavItem[]
}

/**
 * Navigation is grouped by intent rather than by data source: what happened,
 * what to do, and where to dig. Settings sits apart because it is maintenance,
 * not analysis.
 */
export const navigation: NavSection[] = [
  {
    label: 'Today',
    items: [
      {
        to: '/',
        label: 'Overview',
        icon: LayoutDashboard,
        description: 'Your morning briefing and business health',
      },
      {
        to: '/action-centre',
        label: 'Action Centre',
        icon: Zap,
        badge: 'insights',
        description: 'Profit leaks, risks and priced-up opportunities',
      },
    ],
  },
  {
    label: 'Analyse',
    items: [
      {
        to: '/business-review',
        label: 'Business Review',
        icon: BarChart3,
        description: 'Executive reporting across periods',
      },
      {
        to: '/products',
        label: 'Products',
        icon: Boxes,
        description: 'Per-SKU intelligence and lifecycle',
      },
      {
        to: '/pricing',
        label: 'Pricing',
        icon: BadgePercent,
        description: 'Target prices, simulator, and margin health',
      },
      {
        to: '/trends',
        label: 'Trends',
        icon: LineChart,
        description: 'Revenue, profit and margin over time',
      },
      {
        to: '/transactions',
        label: 'Transactions',
        icon: Receipt,
        description: 'Every order, filterable',
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        to: '/settings',
        label: 'Settings',
        icon: Settings,
        description: 'Data source and preferences',
      },
    ],
  },
]
