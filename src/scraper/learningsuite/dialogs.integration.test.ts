import { chromium, type Page } from "playwright";
import { expect, it } from "vitest";
import { installLearningSuiteDialogHandler } from "./dialogs.js";

const target = "<button onclick=\"document.body.dataset.opened = 'yes'\">Open module</button>";
const overlay = 'style="position:fixed;inset:0;background:white;z-index:5"';
async function withPage(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await installLearningSuiteDialogHandler(page);
    await run(page);
  } finally {
    await browser.close();
  }
}

it("does not wait for a dialog or click unrelated close buttons when there is no overlay", async () => {
  await withPage(async (page) => {
    await installLearningSuiteDialogHandler(page);
    await page.setContent(
      `${target}<button onclick="document.body.dataset.closed = 'yes'">Close</button>`
    );
    await page.getByRole("button", { name: "Open module" }).click({ timeout: 1500 });
    expect(await page.locator("body").getAttribute("data-opened")).toBe("yes");
    expect(await page.locator("body").getAttribute("data-closed")).toBeNull();
  });
});

it.each([
  [
    "ARIA dialog",
    `<section role="dialog" aria-modal="true" ${overlay}><button aria-label="Close dialog" onclick="this.parentElement.remove()">×</button></section>`,
  ],
  [
    "localized dialog",
    `<section role="dialog" ${overlay}><button onclick="this.parentElement.remove()">Fermer</button></section>`,
  ],
  [
    "unlabelled icon",
    `<section role="dialog" ${overlay}><button onclick="this.parentElement.remove()"><svg data-icon="times"></svg></button></section>`,
  ],
  [
    "custom modal",
    `<section aria-modal="true" ${overlay}><button data-bs-dismiss="modal" onclick="this.parentElement.remove()">Fechar aviso</button></section>`,
  ],
  [
    "native dialog",
    '<dialog><button type="button" onclick="this.closest(\'dialog\').close()">Close</button></dialog><script>document.querySelector("dialog").showModal()</script>',
  ],
])("dismisses optional overlays using %s semantics", async (_name, html) => {
  await withPage(async (page) => {
    await page.setContent(target + html);
    await page.getByRole("button", { name: "Open module" }).click({ timeout: 2000 });
    expect(await page.locator("body").getAttribute("data-opened")).toBe("yes");
  });
});

it("handles a dialog introduced by a later navigation action", async () => {
  await withPage(async (page) => {
    await page.setContent(
      `${target}<button onclick="document.querySelector('[role=dialog]').hidden = false">Open course</button><div role="dialog" hidden ${overlay}><button onclick="this.parentElement.remove()">Dismiss</button></div>`
    );
    await page.getByRole("button", { name: "Open course" }).click();
    await page.getByRole("button", { name: "Open module" }).click({ timeout: 2000 });
    expect(await page.locator("body").getAttribute("data-opened")).toBe("yes");
  });
});

it("tries another explicit close control when a close icon does nothing", async () => {
  await withPage(async (page) => {
    await page.setContent(
      `${target}<div role="dialog" ${overlay}><button><svg data-icon="xmark"></svg></button><button onclick="this.parentElement.remove()">Close</button></div>`
    );
    await page.getByRole("button", { name: "Open module" }).click({ timeout: 4000 });
    expect(await page.locator("body").getAttribute("data-opened")).toBe("yes");
  });
});

it("dismisses stacked optional dialogs before the target action", async () => {
  await withPage(async (page) => {
    await page.setContent(
      `${target}<div role="dialog" ${overlay}><button onclick="this.parentElement.remove()">Schließen</button></div><div role="dialog" ${overlay}><button onclick="this.parentElement.remove()">Close</button></div>`
    );
    await page.getByRole("button", { name: "Open module" }).click({ timeout: 4000 });
    expect(await page.locator("body").getAttribute("data-opened")).toBe("yes");
  });
});

it.each([
  '<button type="submit">Close</button>',
  "<button>Close</button>",
  '<button type="button" disabled>Close</button><button type="submit">Accept</button>',
  '<button type="submit">Accept and continue</button>',
])("does not submit forms or accept required decisions: %s", async (buttons) => {
  await withPage(async (page) => {
    await page.setContent(
      `${target}<div role="dialog" ${overlay}><form onsubmit="event.preventDefault();document.body.dataset.submitted = 'yes'">${buttons}</form></div>`
    );
    await expect(
      page.getByRole("button", { name: "Open module" }).click({ timeout: 400 })
    ).rejects.toThrow();
    expect(await page.locator("body").getAttribute("data-submitted")).toBeNull();
    expect(await page.locator("body").getAttribute("data-opened")).toBeNull();
  });
});
