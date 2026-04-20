import { chromium } from "playwright";

const TIMEOUT_MS = 30_000;
const MAX_TEXT_CHARS = 14_000;

export interface ScrapeResult {
  url: string;
  text: string;
}

export async function scrapeProperty(url: string): Promise<ScrapeResult> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "pt-PT",
      extraHTTPHeaders: { "Accept-Language": "pt-PT,pt;q=0.9" },
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });

    // dismiss cookie banners
    for (const selector of [
      "#didomi-notice-agree-button",
      "[id*='cookie'] button[class*='accept']",
      "[class*='cookie'] button[class*='accept']",
      "button[data-testid*='accept']",
    ]) {
      await page.locator(selector).first().click({ timeout: 2000 }).catch(() => null);
    }

    await page.waitForTimeout(1500);

    const text: string = await page.evaluate(() => {
      for (const tag of ["script", "style", "noscript", "nav", "footer", "header"]) {
        document.querySelectorAll(tag).forEach((el) => el.remove());
      }
      return document.body.innerText.replace(/\s{3,}/g, "\n\n").trim();
    });

    return { url, text: text.slice(0, MAX_TEXT_CHARS) };
  } finally {
    await browser.close();
  }
}
