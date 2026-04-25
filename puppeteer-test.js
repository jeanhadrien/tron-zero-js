import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log(`[Browser ${msg.type()}] ${msg.text()}`);
  });
  
  page.on('pageerror', err => {
    console.error(`[Browser Error] ${err.toString()}`);
  });
  
  await page.goto('http://localhost:8080/');
  
  // Wait for 10 seconds to collect logs
  await new Promise(r => setTimeout(r, 10000));
  
  await browser.close();
})();
