import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { logger } from "../utils/logger";

export interface WithBrowserOptions {
  abortSignal?: AbortSignal;
}

export async function withBrowser<T>(fn: (page: Page) => Promise<T>, options: WithBrowserOptions = {}): Promise<T> {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let cleaned = false;
  const { abortSignal } = options;

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    if (page) await page.close().catch(e => logger.error("Error closing page", { error: e instanceof Error ? e.message : String(e) }));
    if (context) {
      await context.close().catch(e => logger.error("Error closing context", { error: e instanceof Error ? e.message : String(e) }));
    }
    if (browser) {
      await browser.close().catch(e => logger.error("Error closing browser", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const onAbort = () => {
    void cleanup();
  };

  try {
    if (abortSignal?.aborted) {
      throw new Error("ABORTED");
    }

    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
    });
    context = await browser.newContext();
    page = await context.newPage();

    abortSignal?.addEventListener("abort", onAbort, { once: true });
    return await fn(page);
  } finally {
    abortSignal?.removeEventListener("abort", onAbort);
    await cleanup();
  }
}
