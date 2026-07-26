import { UpcomingPage } from '@/pages/upcoming'

export function ActionCentrePage() {
  return (
    <UpcomingPage
      eyebrow="Action Centre"
      title="Every profit decision, ranked by what it is worth"
      description="The full insight engine already runs on your live data — Overview surfaces the top findings. This page will give each one room to be worked."
      capabilities={[
        'Full ranked list of risks and opportunities, priced in złoty',
        'Filter by profit leakage, margin erosion, pricing and advertising',
        'Per-SKU pricing simulator showing margin at a proposed price',
        'Dismiss and snooze, so a reviewed finding stops resurfacing',
        'Evidence drill-through from any finding to its underlying orders',
        'Weekly digest of what changed since the last review',
      ]}
    />
  )
}

export function BusinessReviewPage() {
  return (
    <UpcomingPage
      eyebrow="Business Review"
      title="Executive reporting you could send to an investor"
      description="Weekly and monthly reviews built from the same numbers as Overview, formatted for reporting rather than monitoring."
      capabilities={[
        'Weekly and monthly executive summaries written from your data',
        'Product scorecards with revenue, profit and margin movement',
        'Revenue and profit contribution waterfalls',
        'Margin change attribution — what moved the rate, and by how much',
        'Channel and category heatmaps',
        'Export to PDF for board and accountant reporting',
      ]}
    />
  )
}

export function ProductsPage() {
  return (
    <UpcomingPage
      eyebrow="Products"
      title="An intelligence page for every SKU"
      description="Your catalogue currently spans 53 selling products. Each one gets its own page, scored and explained."
      capabilities={[
        'Revenue, profit, margin, units and contribution per product',
        'Product health score with the same explainable breakdown as Overview',
        'Margin and price history, once enough trading days accumulate',
        'Lifecycle stage — launch, scaling, mature, declining',
        'Landed cost breakdown, including the products missing cost data',
        'Recommendations specific to the product, not the portfolio',
      ]}
    />
  )
}

export function TransactionsPage() {
  return (
    <UpcomingPage
      eyebrow="Transactions"
      title="Every order, explorable"
      description="A professional data explorer over all 183 orders, with the currency and margin detail the summary views deliberately hide."
      capabilities={[
        'Virtualised table that stays fast as order volume grows',
        'Filter by product, channel, currency, date and margin band',
        'Expandable rows showing the full commission and cost breakdown',
        'Original-currency and PLN figures side by side',
        'Saved views for the filters you return to',
        'CSV export of any filtered view',
      ]}
    />
  )
}

export function TrendsPage() {
  return (
    <UpcomingPage
      eyebrow="Trends"
      title="How the business moves over time"
      description="Overview shows the pulse. This page is for interrogating it — once there is enough history to say something honest about seasonality."
      capabilities={[
        'Revenue, profit, margin and order trends with adjustable windows',
        'Moving averages, activated once 14 days of history exist',
        'Marketplace and brand comparison over time',
        'Day-of-week and seasonality patterns',
        'Cohort view of new versus returning customers',
        'Anomaly flags when a day breaks its own pattern',
      ]}
    />
  )
}

export function SettingsPage() {
  return (
    <UpcomingPage
      eyebrow="Settings"
      title="Data source and preferences"
      description="Luora reads a single Apps Script endpoint over your Google Sheet. Settings will make that connection visible and configurable."
      capabilities={[
        'Data source status, last sync time and endpoint health',
        'Currency and locale preferences',
        'Margin targets and health score thresholds',
        'Insight sensitivity — what counts as material for your business',
        'Theme and density preferences',
        'Team access, once Luora runs beyond a single founder',
      ]}
    />
  )
}
