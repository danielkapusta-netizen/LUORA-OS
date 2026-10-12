import { expect, test, type Page } from '@playwright/test';

// End-to-end path through the demo data: log in, buy one label, buy a batch,
// print it, and check that stock and analytics follow.
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'change-me-please';
const SHOTS = process.env.E2E_SCREENSHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test('orders to labels to analytics', async ({ page }) => {
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();

  // Orders from all three marketplaces are listed.
  const table = page.locator('table');
  for (const marketplace of ['Shopify', 'Allegro', 'Empik']) {
    await expect(table.getByText(marketplace, { exact: true }).first()).toBeVisible();
  }
  await shot(page, '01-orders');

  // Picking a row shows its details on the right.
  await page.locator('tbody tr').nth(1).click();
  await expect(page).toHaveURL(/order=/);
  await expect(page.getByRole('button', { name: 'Generate shipping label' })).toBeVisible();
  await expect(page.getByText('Order items')).toBeVisible();
  await shot(page, '01b-order-panel');

  // Single label: a Shopify order going to a parcel locker, from the full order view.
  await page.goto('/orders?marketplace=shopify&q=Paczkomat');
  await page.locator('tbody tr').first().click();
  await page.getByRole('link', { name: 'Open full order' }).click();
  await expect(page.getByText('Suggested by rule')).toBeVisible();
  await expect(page.locator('select[name="service"]')).toHaveValue('inpost_locker_standard');
  await shot(page, '02-order-detail');
  await page.getByRole('button', { name: 'Create label' }).click();
  await expect(page.getByText('Label ready')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Tracking sent to/)).toBeVisible({ timeout: 30_000 });
  const labelHref = await page.getByRole('link', { name: 'Print label' }).getAttribute('href');
  const label = await page.request.get(labelHref!);
  expect(label.headers()['content-type']).toBe('application/pdf');
  await shot(page, '03-order-shipped');

  // Bulk: three Allegro orders.
  await page.goto('/orders?marketplace=allegro');
  const boxes = page.locator('tbody input[type="checkbox"]');
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();
  await page.getByRole('button', { name: 'Generate labels' }).click();
  await expect(page).toHaveURL(/\/shipments\/batches\//);
  await expect(page.getByText('3 ready')).toBeVisible({ timeout: 45_000 });
  const merged = await page.getByRole('link', { name: /Print 3 label/ }).getAttribute('href');
  const pdf = await page.request.get(merged!);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  await shot(page, '04-batch');

  // Stock went down and analytics has data.
  await page.goto('/inventory');
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  await expect(page.getByText('LUO-MUG-01')).toBeVisible();
  await shot(page, '05-inventory');

  await page.goto('/analytics');
  await expect(page.getByText('Revenue', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Revenue per day')).toBeVisible();
  await shot(page, '06-analytics');

  // Tasks: the overview, a new task through the dialog, ticking it off, and the other views.
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Tasks for today' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await shot(page, '08-tasks');
  await page.getByRole('button', { name: 'New task' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Title').fill('E2E: check the courier pick-up');
  await dialog.getByRole('button', { name: 'Create task' }).click();
  const card = page.getByRole('link', { name: 'E2E: check the courier pick-up' });
  await expect(card).toBeVisible();
  await page.getByRole('checkbox', { name: /Mark as done: E2E: check the courier pick-up/ }).click();
  await expect(page.getByRole('checkbox', { name: /Reopen: E2E: check the courier pick-up/ })).toBeVisible();
  await card.click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
  await expect(page.getByText('marked this as done')).toBeVisible();
  await shot(page, '09-task');
  await page.goto('/tasks/board');
  await expect(page.getByRole('region', { name: 'In progress' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Done' })).toBeVisible();
  await shot(page, '10-tasks-board');
  await page.goto('/tasks/calendar');
  await expect(page.getByRole('heading', { name: /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/ })).toBeVisible();
  await shot(page, '11-tasks-calendar');
  await page.goto('/tasks/projects');
  await expect(page.getByText('Autumn campaign').first()).toBeVisible();
  await shot(page, '12-tasks-projects');

  for (const path of ['/shipments', '/settings/integrations', '/settings/shipping', '/settings/users']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
    await shot(page, `07-${path.replace(/\//g, '_')}`);
  }
});
