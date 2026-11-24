import { test, expect } from '@playwright/test';
import { blankTiles, open, snapshot, build, written, popup } from './helpers.js';

test.beforeEach(({ page }) => blankTiles(page));

const center = page => page.evaluate(() => { const box = pedway.map.getContainer().getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; });

test('Add pin, tap the map, fill in the editor: the pin is saved in the link', async ({ page }) => {
  await open(page);
  await page.locator('#pin-add').click();
  await expect(page.locator('#app-status')).toContainText('Tap the map');
  const { x, y } = await center(page);
  await page.mouse.click(x, y);
  await expect(page.locator('#pin-dialog')).toBeVisible();
  await page.locator('#pin-label').fill('Lunch spot');
  await page.locator('#pin-icon').selectOption('food');
  await page.locator('#pin-md').fill('Try the **soup**.\n\n[Menu](https://example.com/menu)');
  await expect(page.locator('#pin-preview strong')).toHaveText('soup');
  await page.locator('#pin-save').click();
  await expect(page.locator('#pin-dialog')).toBeHidden();

  const doc = await snapshot(page);
  expect(doc.map.pins).toHaveLength(1);
  expect(doc.map.pins[0]).toMatchObject({ id: 'p1', label: 'Lunch spot', icon: 'food', md: 'Try the **soup**.\n\n[Menu](https://example.com/menu)' });

  const href = await written(page);
  await open(page, href);
  expect((await snapshot(page)).map.pins).toEqual(doc.map.pins);
  await page.locator('.pin-marker').click();
  await expect(popup(page).locator('.pin-popup h3')).toHaveText('Lunch spot');
  await expect(popup(page).locator('.pin-popup strong')).toHaveText('soup');
  const link = popup(page).locator('.pin-popup a', { hasText: 'Menu' });
  await expect(link).toHaveAttribute('href', 'https://example.com/menu');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('keyboard users can place a pin at the map centre, and Escape cancels placing', async ({ page }) => {
  await open(page);
  await page.locator('#pin-add').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#app-status')).toBeHidden();
  await expect(page.locator('#pin-add')).toHaveAttribute('aria-pressed', 'false');

  await page.locator('#pin-add').click();
  await page.locator('#pin-place-centre').click();
  await expect(page.locator('#pin-dialog')).toBeVisible();
  await page.locator('#pin-cancel').click();
  // Cancel keeps the new pin with its defaults.
  expect((await snapshot(page)).map.pins).toHaveLength(1);
});

test('editing and deleting a pin update the link', async ({ page }) => {
  await open(page, './?example=stations');
  await written(page);
  await page.evaluate(() => pedway.pins.open('clark-lake'));
  await popup(page).locator('.pin-edit').click();
  await expect(page.locator('#pin-label')).toHaveValue('Clark/Lake');
  await page.locator('#pin-label').fill('Clark & Lake');
  await page.locator('#pin-color').fill('#2266aa');
  await page.locator('#pin-save').click();
  let pin = (await snapshot(page)).map.pins.find(p => p.id === 'clark-lake');
  expect(pin).toMatchObject({ label: 'Clark & Lake', color: '#2266aa' });

  await page.evaluate(() => pedway.pins.open('ogilvie'));
  await popup(page).locator('.pin-edit').click();
  await page.locator('#pin-delete').click();
  const doc = await snapshot(page);
  expect(doc.map.pins.map(p => p.id)).toEqual(['millennium', 'clark-lake', 'washington']);
  await expect(page.locator('.pin-marker')).toHaveCount(3);
  const href = await written(page);
  await open(page, href);
  expect(await snapshot(page)).toEqual(doc);
});

test('dragging a pin moves it in the link', async ({ page }) => {
  await open(page, './?example=meet');
  await written(page);
  const before = (await snapshot(page)).map.pins[0].at;
  const box = await page.locator('.pin-marker').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).map.pins[0].at).not.toBe(before);
  const pin = (await snapshot(page)).map.pins[0];
  expect(pin.label).toBe('Meet here');
});

test('markdown notes are sanitised', async ({ page }) => {
  await open(page);
  const md = [
    '<img src=x onerror="window.pwned=1">',
    '<script>window.pwned=2</script>',
    '[js](javascript:window.pwned=3) [data](data:text/html,hi) [ok](https://example.com)',
    '![photo](https://example.com/a.png)',
    '<a href="https://example.com" onclick="window.pwned=4">click</a>',
    '<iframe src="https://example.com"></iframe><style>body{display:none}</style>',
    '- [x] done', '- [ ] todo',
  ].join('\n\n');
  const href = await build(page, { src: 'XSS', map: { pins: [{ id: 'x', at: 'dp3wmbxqh', label: 'x', md }] } });
  await open(page, href);
  await page.evaluate(() => pedway.pins.open('x'));
  const note = popup(page).locator('.pin-note');
  await expect(note).toBeVisible();
  await expect(note.locator('img, script, iframe, style, [onclick], [onerror]')).toHaveCount(0);
  await expect(note.locator('a')).toHaveCount(3);
  for (const href of await note.locator('a').evaluateAll(links => links.map(a => a.getAttribute('href')))) expect(href).toMatch(/^https:\/\//);
  await expect(note.locator('a', { hasText: 'photo' })).toHaveAttribute('href', 'https://example.com/a.png');
  await expect(note).toContainText('js');
  await expect(note.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(note.locator('input[type="checkbox"]').first()).toBeChecked();
  await expect(note.locator('input[type="checkbox"]').first()).toBeDisabled();
  await note.locator('a', { hasText: 'click' }).evaluate(a => a.dispatchEvent(new MouseEvent('click', { cancelable: true })));
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  await expect(page.locator('body')).toBeVisible();
});

test('a link with a pin note over the size limit is refused', async ({ page }) => {
  await open(page);
  const payload = await page.evaluate(async () => {
    const { compress } = await import('./vendor/fragment-kit-v0.5.0/src/index.js');
    return compress(JSON.stringify({ format: 'hashbin-diagram', version: 1, type: 'pedway-map', src: '', map: { pins: [{ id: 'a', at: 'dp3wmbxqh', md: 'x'.repeat(10001) }] } }));
  });
  await open(page, './#v1.' + payload);
  await expect(page.locator('#app-status')).toContainText('longer than');
});
