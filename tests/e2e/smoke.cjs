// Test de fumée de l'interface (Chromium headless) : npm run build && npm run preview, puis npm run e2e.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(process.env.URL || 'http://localhost:4173/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.board');
  // Mode B
  await page.selectOption('select', 'B');
  await page.click('button:has-text("Lancer")');
  await page.waitForFunction(() => document.querySelectorAll('.mv:not(.empty)').length >= 6, null, { timeout: 60000 });
  console.log('Mode B moves:', await page.$$eval('.mv:not(.empty)', els => els.map(e => e.textContent).join(' ')));
  await page.screenshot({ path: (process.env.SHOTS || '.') + '/modeB.png' });
  await page.click('button:has-text("Pause")');
  // Analysis
  await page.click('nav button:has-text("Analyse")');
  await page.fill('input[placeholder="Coller une FEN…"]', 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
  await page.click('button:has-text("Charger") >> nth=1').catch(()=>{});
  const vis = await page.$$('button:has-text("Charger")');
  for (const b of vis) { if (await b.isVisible()) await b.click(); }
  await page.click('button:has-text("Analyser (Truk + Stockfish)")');
  await page.waitForFunction(() => [...document.querySelectorAll('.compare .big-score')].some(e => e.textContent === 'OUI' || e.textContent === 'NON'), null, { timeout: 60000 });
  const cmp = await page.$$eval('.compare .big-score', els => els.map(e => e.textContent));
  console.log('Compare:', cmp);
  await sleep(300);
  await page.screenshot({ path: (process.env.SHOTS || '.') + '/analysis.png', fullPage: true });
  // Diagnostics perft
  await page.click('nav button:has-text("Diagnostics")');
  await page.click('button:has-text("Lancer perft")');
  await page.waitForFunction(() => { const c = [...document.querySelectorAll('.conclusion')].find(e => e.offsetParent); return c && !c.textContent.includes('en cours'); }, null, { timeout: 120000 });
  console.log('Perft:', await page.$$eval('.conclusion', els => els.filter(e => e.offsetParent).map(e => e.textContent)));
  await page.click('button:has-text("Lancer le banc")');
  await page.waitForFunction(() => [...document.querySelectorAll('.conclusion')].some(e => e.offsetParent && e.textContent.startsWith('Total')), null, { timeout: 120000 });
  console.log('Bench:', await page.$$eval('.conclusion', els => els.filter(e => e.offsetParent).map(e => e.textContent)));
  await page.click('button:has-text("Interroger Stockfish")');
  await page.waitForSelector('text=Stockfish 18', { timeout: 30000 });
  await page.screenshot({ path: (process.env.SHOTS || '.') + '/diag.png', fullPage: true });
  console.log(errors.join('\n') || 'no errors');
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
