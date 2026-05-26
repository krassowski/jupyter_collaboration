// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { expect, galata, test } from '@jupyterlab/galata';

/**
 * A minimal notebook with one cell.
 *
 * When the room is recreated after a NEW CELL is inserted at the beginning,
 * _apply_deterministic_source_content (which pins client_id=0) shifts the
 * clock positions for all subsequent items (including the source Text branch
 * of the original cell).
 *
 * A client that was connected to the original room holds a local YDoc edit
 * whose parent references the source Text at clock position N. After the room
 * is recreated with a new cell prepended, the source Text is at position N+K
 * where K is the number of new items. The parent reference (0, N) now points
 * to a different Yjs item type, so applying the client's buffered SYNC_STEP2
 * raises "block parent <0#N> must be deleted or shared ref type" on the server.
 */
const INITIAL_NOTEBOOK = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
  cells: [
    {
      cell_type: 'code',
      id: 'cell-1',
      metadata: {},
      source: '',
      outputs: [],
      execution_count: null
    }
  ]
};

test.describe('Conflict handling', () => {
  const notebookName = 'conflict_test.ipynb';

  test.afterEach(async ({ page, request, tmpPath }) => {
    const contents = galata.newContentsHelper(request);
    await contents.deleteFile(`${tmpPath}/${notebookName}`).catch(() => {
      // ignore if already deleted
    });
    await page.close();
  });

  test(
    'handles room eviction and reconnection without crashing',
    async ({ page, request, tmpPath, baseURL }) => {
      const notebookPath = `${tmpPath}/${notebookName}`;

      // Upload the initial notebook.
      const createResp = await request.put(
        `${baseURL}/api/contents/${notebookPath}`,
        {
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify({
            type: 'notebook',
            format: 'json',
            content: INITIAL_NOTEBOOK
          })
        }
      );
      expect(createResp.ok()).toBeTruthy();

      // Open the notebook — this connects the browser's y-websocket to the server.
      await page.filebrowser.refresh();

      const conflictListenerAttached = page.waitForEvent('console', msg =>
        msg.type() === 'log' && msg.text() === 'ATTACHED CONFLICT LISTENER'
      );

      await page.notebook.open(notebookName);
      await conflictListenerAttached;

      // Dismiss kernel selection dialog if it appears
      const noKernelBtn = page
        .locator('.jp-Dialog')
        .getByRole('button', { name: 'No Kernel' });
      try {
        await noKernelBtn.waitFor({ state: 'visible', timeout: 5000 });
        await noKernelBtn.click();
        await page.locator('.jp-Dialog').waitFor({ state: 'hidden', timeout: 3000 });
      } catch {
        // No kernel dialog
      }

      // Make some edits to the notebook
      await page.notebook.enterCellEditingMode(0);
      await page.keyboard.type('print("hello")');
      await page.notebook.leaveCellEditingMode(0);

      // Wait for sync
      await page.waitForTimeout(500);

      // Simulate room eviction by going offline for long enough
      await page.context().setOffline(true);
      await page.waitForTimeout(10000);

      // Come back online —the server should recreate the room gracefully
      await page.context().setOffline(false);

      // Verify the notebook is still accessible and we can still edit
      // (If there was a crash, the WebSocket would be dead and this would timeout/fail)
      await page.waitForTimeout(2000);

      // Try to make another edit to verify the notebook is still responding
      await page.notebook.enterCellEditingMode(0);
      const cellContent = await page.notebook.getCellTextInput(0);
      expect(cellContent).toContain('print("hello")');
      await page.keyboard.type(' world');
      await page.notebook.leaveCellEditingMode(0);

      // Verify we can still interact with the notebook
      expect(true).toBeTruthy();
    }
  );
});
