import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { installNativeFixture, instrumentRuntime, recommendations, videoCard } from './fixtures/recommendations.ts';
import type { FixtureOptions } from './fixtures/recommendations.ts';

let browser: Browser | undefined;

before(async () => {
  browser = await chromium.launch({ headless: true, args: ['--mute-audio'] });
});

after(async () => { await browser?.close(); });

async function withRecommendations(artifact: string, run: (page: Page, execute: () => Promise<unknown>) => Promise<void>, options: FixtureOptions = {}): Promise<void> {
  assert.ok(browser);
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: recommendations(options) }));
    await page.goto(`https://www.youtube.com${options.path ?? '/'}`);
    await page.evaluate(installNativeFixture, options);
    await page.evaluate(instrumentRuntime);
    const code = await readFile(new URL(artifact === 'unminified' ? '../.build/youtube-quick-feedback.js' : '../youtube-quick-feedback.user.js', import.meta.url), 'utf8');
    await page.addScriptTag({ content: code });
    await run(page, () => page.addScriptTag({ content: code }));
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function resources(page: Page): Promise<{ listeners: number; mutationObservers: number; resizeObservers: number; styles: number }> {
  return page.evaluate(() => {
    const output = document.querySelector('#test-resources');
    if (!(output instanceof HTMLElement)) throw new Error('Missing resource instrumentation');
    return { listeners: Number(output.dataset['listeners'] ?? '0'), mutationObservers: Number(output.dataset['mutationObservers'] ?? '0'), resizeObservers: Number(output.dataset['resizeObservers'] ?? '0'), styles: document.querySelectorAll('style').length };
  });
}

async function feedback(page: Page, id: string, label = 'Not interested'): Promise<void> {
  const card = page.locator(`#${id}`);
  await card.locator('a.ytLockupViewModelContentImage').hover();
  await card.getByRole('button', { name: label, exact: true }).click();
}

async function status(page: Page, text: string): Promise<void> {
  await page.waitForFunction(text => document.querySelector('output')?.textContent === text, text, { timeout: 3500 });
  assert.equal(await page.getByRole('status').textContent(), text);
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => { requestAnimationFrame(() => requestAnimationFrame(() => resolve())); }));
}

async function metric(page: Page, name: string): Promise<number> {
  return page.locator('#test-resources').evaluate((element, key) => {
    if (!(element instanceof HTMLElement)) throw new Error('Missing resource instrumentation');
    return Number(element.dataset[key] ?? '0');
  }, name);
}

for (const artifact of ['unminified', 'minified']) {
  void test(`${artifact}: idle observation ignores mutations outside the native page manager`, () => withRecommendations(artifact, async page => {
    await settle(page);
    const initial = await metric(page, 'mutationCallbacks');
    await page.locator('#unrelated').evaluate(element => {
      element.append(document.createElement('div'));
      element.setAttribute('hidden', '');
      element.setAttribute('class', 'changed');
      element.setAttribute('style', 'color:red');
    });
    await settle(page);
    assert.equal(await metric(page, 'mutationCallbacks'), initial);
  }));

  void test(`${artifact}: idle observation ignores thumbnail class and style changes`, () => withRecommendations(artifact, async page => {
    await settle(page);
    const initial = await metric(page, 'mutationCallbacks');
    await page.locator('#alpha a').evaluate(element => {
      element.classList.add('native-hover-state');
      element.setAttribute('style', 'color:red');
    });
    await settle(page);
    assert.equal(await metric(page, 'mutationCallbacks'), initial);
  }));

  void test(`${artifact}: History stops mutation work until returning to recommendations`, () => withRecommendations(artifact, async page => {
    await page.evaluate(() => {
      history.pushState({}, '', '/feed/history');
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await settle(page);
    const initial = await metric(page, 'mutationCallbacks');
    await page.locator('#feed').evaluate(element => {
      element.append(document.createElement('div'));
      element.setAttribute('hidden', '');
    });
    await settle(page);
    assert.equal(await metric(page, 'mutationCallbacks'), initial);
    assert.equal(await page.locator('.yqf-panel').count(), 0);
    await page.locator('#feed').evaluate(element => element.removeAttribute('hidden'));
    await page.evaluate(() => {
      history.pushState({}, '', '/');
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await feedback(page, 'alpha');
    await status(page, 'Video removed: Alpha');
  }));

  void test(`${artifact}: unsupported routes keep observation and controls stopped`, () => withRecommendations(artifact, async page => {
    await settle(page);
    const initial = await metric(page, 'mutationCallbacks');
    await page.locator('#feed').evaluate(element => element.append(document.createElement('div')));
    await settle(page);
    assert.equal(await metric(page, 'mutationCallbacks'), initial);
    assert.equal(await page.locator('.yqf-panel').count(), 0);
  }, { path: '/account' }));

  void test(`${artifact}: removing a hovered card releases its ResizeObserver target`, () => withRecommendations(artifact, async page => {
    await page.locator('#alpha a').hover();
    assert.equal(await metric(page, 'resizeTargets'), 1);
    await page.mouse.move(1200, 700);
    await page.locator('#alpha').evaluate(element => element.remove());
    await settle(page);
    assert.equal(await metric(page, 'resizeTargets'), 0);
  }));

  void test(`${artifact}: replacing a hovered thumbnail releases the detached target`, () => withRecommendations(artifact, async page => {
    await page.locator('#alpha a').hover();
    assert.equal(await metric(page, 'resizeTargets'), 1);
    await page.mouse.move(1200, 700);
    await page.locator('#alpha a').evaluate(element => element.replaceWith(element.cloneNode(true)));
    await settle(page);
    assert.equal(await metric(page, 'resizeTargets'), 0);
    await page.locator('#alpha a').hover();
    assert.equal(await metric(page, 'resizeTargets'), 1);
    await feedback(page, 'alpha');
    await status(page, 'Video removed: Alpha');
  }));

  void test(`${artifact}: stale completion cannot restore controls on an unsupported route`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'alpha');
    await page.evaluate(() => {
      history.pushState({}, '', '/account');
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await page.waitForTimeout(1200);
    assert.equal(await page.getByRole('status').textContent(), '');
    assert.equal(await page.locator('.yqf-panel').count(), 0);
    assert.equal(await page.locator('html.yqf-menu-hidden').count(), 0);
    assert.equal(await metric(page, 'resizeTargets'), 0);
  }, { delay: 1000 }));

  void test(`${artifact}: cancelled feedback cannot flash a stale Unavailable result`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'alpha');
    await page.locator('#outside').click();
    await settle(page);
    assert.equal(await page.locator('#alpha [data-unavailable]').count(), 0);
    assert.equal(await page.locator('#alpha .yqf-panel').isVisible(), false);
    assert.equal(await page.locator('#alpha .yqf-panel').getAttribute('hidden'), null);
    assert.equal(await page.locator('html.yqf-menu-hidden').count(), 0);
  }, { delay: 1000 }));
  void test(`${artifact}: repeated execution keeps one working feedback runtime`, () => withRecommendations(artifact, async (page, execute) => {
    const initial = await resources(page);
    await execute();
    await execute();
    assert.deepEqual(await resources(page), initial);
    assert.equal(await page.locator('#alpha .yqf-panel').count(), 1);
    assert.equal(await page.locator('#alpha .yqf-button').count(), 2);
    await feedback(page, 'alpha');
    await status(page, 'Video removed: Alpha');
  }));

  void test(`${artifact}: repeated execution reuses the runtime through SPA navigation`, () => withRecommendations(artifact, async (page, execute) => {
    const initial = await resources(page);
    await page.evaluate(() => {
      history.pushState({}, '', '/feed/history');
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await execute();
    assert.equal(await page.locator('.yqf-panel').count(), 0);
    assert.deepEqual(await resources(page), initial);
    await page.evaluate(() => {
      history.pushState({}, '', '/');
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await execute();
    assert.deepEqual(await resources(page), initial);
    assert.equal(await page.locator('#alpha .yqf-button').count(), 2);
    await feedback(page, 'alpha', "Don't recommend channel");
    await status(page, 'Channel blocked: Alpha');
  }));

  void test(`${artifact}: repeated execution reuses the runtime after card replacement`, () => withRecommendations(artifact, async (page, execute) => {
    const initial = await resources(page);
    await page.locator('#alpha').evaluate((card, html) => { card.outerHTML = html; }, videoCard('alpha', 'Replacement'));
    await page.locator('#alpha .yqf-panel').waitFor({ state: 'attached' });
    await execute();
    assert.deepEqual(await resources(page), initial);
    assert.equal(await page.locator('#alpha .yqf-panel').count(), 1);
    assert.equal(await page.locator('#alpha .yqf-button').count(), 2);
    await feedback(page, 'alpha');
    await status(page, 'Video removed: Replacement');
  }));

  void test(`${artifact}: repeated execution keeps waiting for initially missing cards`, () => withRecommendations(artifact, async (page, execute) => {
    const initial = await resources(page);
    await execute();
    assert.deepEqual(await resources(page), initial);
    assert.equal(await page.locator('.yqf-panel').count(), 0);
    await page.locator('#feed').evaluate((feed, html) => { feed.innerHTML = html; }, videoCard('gamma', 'Gamma'));
    await page.locator('#gamma .yqf-panel').waitFor({ state: 'attached' });
    await execute();
    assert.deepEqual(await resources(page), initial);
    assert.equal(await page.locator('#gamma .yqf-button').count(), 2);
    await feedback(page, 'gamma');
    await status(page, 'Video removed: Gamma');
  }, { cards: '' }));

  void test(`${artifact}: decorates the current rich-card lockup without duplicate buttons`, () => withRecommendations(artifact, async page => {
    assert.equal(await page.locator('#alpha .yqf-panel').count(), 1);
    assert.equal(await page.locator('#alpha .yqf-button').count(), 2);
    await page.evaluate(() => {
      document.dispatchEvent(new Event('yt-navigate-finish'));
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    assert.equal(await page.locator('#alpha .yqf-panel').count(), 1);
    assert.equal(await page.locator('#alpha .yqf-button').count(), 2);
  }));

  void test(`${artifact}: invokes native Not interested for the selected card`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'beta');
    await status(page, 'Video removed: Beta');
    assert.equal(await page.locator('#beta a.ytLockupViewModelContentImage').isVisible(), false);
    assert.equal(await page.locator('#alpha a.ytLockupViewModelContentImage').isVisible(), true);
  }));

  void test(`${artifact}: invokes the channel feedback action`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'alpha', "Don't recommend channel");
    await status(page, 'Channel blocked: Alpha');
    assert.equal(await page.locator('#beta a.ytLockupViewModelContentImage').isVisible(), true);
  }));

  void test(`${artifact}: handles native dismissal replacement and Undo without duplicate controls`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'alpha');
    await status(page, 'Video removed: Alpha');
    assert.equal(await page.locator('#alpha .yqf-panel').count(), 0);
    assert.equal(await page.locator('html.yqf-menu-hidden').count(), 0);
    await page.locator('#alpha').getByRole('button', { name: 'Undo', exact: true }).click();
    await page.locator('#alpha .yqf-panel').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#alpha .yqf-panel').count(), 1);
    assert.equal(await page.locator('#alpha .yqf-button').count(), 2);
    await feedback(page, 'alpha', "Don't recommend channel");
    await status(page, 'Channel blocked: Alpha');
    assert.equal(await page.locator('#alpha a.ytLockupViewModelContentImage').isVisible(), false);
    assert.equal(await page.locator('#beta a.ytLockupViewModelContentImage').isVisible(), true);
  }));

  void test(`${artifact}: matches the native Russian Not interested label`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'alpha');
    await status(page, 'Video removed: Alpha');
  }, { language: 'ru' }));

  void test(`${artifact}: matches the full native Russian channel label`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'alpha', "Don't recommend channel");
    await status(page, 'Channel blocked: Alpha');
  }, { language: 'ru' }));

  void test(`${artifact}: supports a standalone lockup in search results`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'gamma');
    await status(page, 'Video removed: Gamma');
  }, { path: '/results?search_query=example', cards: videoCard('gamma', 'Gamma', { standalone: true }) }));

  void test(`${artifact}: decorates cards appended during scrolling`, () => withRecommendations(artifact, async page => {
    await page.locator('#feed').evaluate((feed, html) => feed.insertAdjacentHTML('beforeend', html), videoCard('gamma', 'Gamma'));
    await page.locator('#gamma .yqf-panel').waitFor({ state: 'attached' });
    await feedback(page, 'gamma');
    await status(page, 'Video removed: Gamma');
    assert.equal(await page.locator('#alpha a.ytLockupViewModelContentImage').isVisible(), true);
  }));

  void test(`${artifact}: excludes the watch-history route`, () => withRecommendations(artifact, async page => {
    assert.equal(await page.locator('.yqf-panel').count(), 0);
  }, { path: '/feed/history' }));

  void test(`${artifact}: excludes a history renderer during SPA transitions`, () => withRecommendations(artifact, async page => {
    assert.equal(await page.locator('.yqf-panel').count(), 0);
  }, { history: true }));

  void test(`${artifact}: excludes advertisement cards`, () => withRecommendations(artifact, async page => {
    assert.equal(await page.locator('#advertisement .yqf-panel').count(), 0);
    assert.equal(await page.locator('#alpha .yqf-panel').count(), 1);
  }, { cards: videoCard('advertisement', 'Advertisement', { ad: true }) + videoCard('alpha', 'Alpha') }));

  void test(`${artifact}: hides feedback controls when a thumbnail is unavailable`, () => withRecommendations(artifact, async page => {
    assert.equal(await page.locator('#alpha .yqf-panel').isVisible(), false);
  }, { cards: videoCard('alpha', 'Alpha', { hidden: true }) }));

  void test(`${artifact}: shows Unavailable when a card has no native action menu`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'alpha');
    await page.locator('#alpha [data-unavailable]').waitFor();
    assert.equal(await page.getByRole('status').textContent(), '');
    assert.equal(await page.locator('#alpha a.ytLockupViewModelContentImage').isVisible(), true);
    assert.equal(await page.locator('yt-sheet-view-model').count(), 0);
  }, { cards: videoCard('alpha', 'Alpha', { menu: false }) }));

  void test(`${artifact}: leaves other menu items untouched when feedback is missing`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'alpha');
    await page.locator('#alpha [data-unavailable]').waitFor({ timeout: 3500 });
    assert.equal(await page.getByRole('status').textContent(), '');
    assert.equal(await page.locator('#alpha a.ytLockupViewModelContentImage').isVisible(), true);
    assert.equal(await page.locator('yt-sheet-view-model').count(), 0);
  }, { missingAction: true }));

  void test(`${artifact}: closes an existing popup before selecting the right card`, () => withRecommendations(artifact, async page => {
    await page.locator('#alpha .ytLockupMetadataViewModelMenuButton button').click();
    await page.locator('yt-sheet-view-model').waitFor();
    await feedback(page, 'beta');
    await status(page, 'Video removed: Beta');
    assert.equal(await page.locator('#alpha a.ytLockupViewModelContentImage').isVisible(), true);
  }));

  void test(`${artifact}: cancels feedback when a trusted outside click interrupts it`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'alpha');
    await page.locator('#outside').click();
    await page.waitForTimeout(1200);
    assert.equal(await page.getByRole('status').textContent(), '');
    assert.equal(await page.locator('#alpha a.ytLockupViewModelContentImage').isVisible(), true);
    assert.equal(await page.locator('html.yqf-menu-hidden').count(), 0);
  }, { delay: 1000 }));

  void test(`${artifact}: does not apply pending feedback after SPA navigation`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'alpha');
    await page.evaluate(() => {
      history.pushState({}, '', '/results?search_query=example');
      document.dispatchEvent(new Event('yt-navigate-finish'));
    });
    await page.waitForTimeout(1200);
    assert.equal(await page.getByRole('status').textContent(), '');
    assert.equal(await page.locator('#alpha a.ytLockupViewModelContentImage').isVisible(), true);
    assert.equal(await page.locator('html.yqf-menu-hidden').count(), 0);
  }, { delay: 1000 }));

  void test(`${artifact}: does not apply pending feedback to a recycled card`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'alpha');
    await page.locator('#alpha a.ytLockupViewModelContentImage').evaluate(thumbnail => { thumbnail.setAttribute('href', '/watch?v=replacement'); });
    await page.waitForTimeout(1200);
    assert.equal(await page.getByRole('status').textContent(), '');
    assert.equal(await page.locator('#alpha a.ytLockupViewModelContentImage').isVisible(), true);
  }, { delay: 1000 }));

  void test(`${artifact}: ignores another feedback button while an action is pending`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'alpha');
    await feedback(page, 'beta', "Don't recommend channel");
    await status(page, 'Video removed: Alpha');
    assert.equal(await page.locator('#beta a.ytLockupViewModelContentImage').isVisible(), true);
  }, { delay: 1000 }));

  void test(`${artifact}: accepts feedback on another card after the first action completes`, () => withRecommendations(artifact, async page => {
    await feedback(page, 'alpha');
    await status(page, 'Video removed: Alpha');
    await page.waitForFunction(() => !document.documentElement.classList.contains('yqf-menu-hidden'));
    await feedback(page, 'beta', "Don't recommend channel");
    await status(page, 'Channel blocked: Beta');
    assert.equal(await page.locator('#alpha a.ytLockupViewModelContentImage').isVisible(), false);
  }));
}

