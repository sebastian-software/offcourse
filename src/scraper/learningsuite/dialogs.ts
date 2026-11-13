import type { Locator, Page } from "playwright";

const pagesWithDialogHandler = new WeakSet<Page>();
const DIALOGS =
  ':is(dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"], .MuiDialog-root, .MuiModal-root):visible';
const CLOSE_NAMES =
  /^(?:close(?: (?:dialog|modal|popup|notification))?|dismiss|schließen|schliessen|(?:dialog|fenster) (?:schließen|schliessen)|fermer|cerrar|chiudi|sluiten|fechar|[×✕✖x])$/iu;

function closeControls(root: Page | Locator) {
  // An untyped button inside (or associated with) a form submits it by default.
  const safe = root.locator(
    ':is(button, [role="button"]):visible:not([disabled]):not([aria-disabled="true"]):not([type="submit"]):not([type="reset"]):not(form button:not([type="button"])):not(button[form]:not([type="button"]))'
  );
  const icons = root
    .locator(
      ':is(button, [role="button"]):is(:has(svg[data-icon="xmark"]), :has(svg[data-icon="times"]), :has(svg[data-testid="CloseIcon"]), [data-dismiss="modal"], [data-bs-dismiss="modal"])'
    )
    .and(safe);
  const labels = root.getByRole("button", { name: CLOSE_NAMES }).and(safe);
  return { icons, labels, all: icons.or(labels) };
}

/** React to optional, dismissible overlays; registering this never waits for a dialog. */
export async function installLearningSuiteDialogHandler(page: Page): Promise<void> {
  if (pagesWithDialogHandler.has(page)) return;
  // Do not intercept forms or required decisions with no explicit dismissal control.
  // A late-rendered control becomes eligible automatically during actionability checks.
  const dialog = page
    .locator(DIALOGS)
    .filter({ has: closeControls(page).all })
    .last();
  await page.addLocatorHandler(
    dialog,
    async (visibleDialog) => {
      // Keep the actual element: the locator can point to the next stacked dialog
      // immediately after the topmost one closes.
      const element = await visibleDialog.elementHandle({ timeout: 1000 }).catch(() => null);
      if (!element) return;
      try {
        const controls = closeControls(visibleDialog);
        // Prefer a structural close icon, then try named alternatives if it is ineffective.
        for (const group of [controls.icons, controls.labels]) {
          for (const button of await group.all()) {
            if (!(await element.isVisible())) return;
            try {
              await button.click({ timeout: 1000 });
              await element.waitForElementState("hidden", { timeout: 1000 });
              return;
            } catch {
              if (!(await element.isVisible())) return;
            }
          }
        }
        // Unknown/ineffective controls leave the target action's normal timeout intact.
      } finally {
        await element.dispose();
      }
    },
    { noWaitAfter: true }
  );
  pagesWithDialogHandler.add(page);
}
