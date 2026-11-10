/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { renderLocal } from "../fixture/local"
import { lazyDialog } from "../../src/ui/dialog"

// Mirrors app.tsx, which loads dialogs on demand so their module graphs stay
// off the startup path.
const LazyDialog = lazyDialog(() => import("../fixture/lazy-dialog").then((module) => ({ default: module.LazyDialog })))

test("dialogs loaded on demand render inside the dialog surface", async () => {
  await using app = await renderLocal()
  app.renderer.start()

  app.dialog.replace(() => <LazyDialog />)
  await app.waitForFrame((frame) => frame.includes("Lazy dialog ready"))

  expect(app.captureCharFrame()).toContain("Lazy dialog ready")
})
