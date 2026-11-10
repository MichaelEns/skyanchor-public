import assert from 'node:assert/strict'
import {expect} from '@playwright/test'
import {build} from 'esbuild'
import path from 'node:path'

export async function verifyComposer(current, phone) {
  if (phone) await current.getByTestId('composeFAB').click()
  else
    await current
      .getByRole('button', {name: 'Compose new post', exact: true})
      .click()
  const dialog = current.getByTestId('composePostView')
  const editor = dialog.locator('.ProseMirror[contenteditable="true"]').first()
  const modifier = (await current.evaluate(() =>
    /Mac|iP(hone|[oa]d)/.test(navigator.platform),
  ))
    ? 'Meta'
    : 'Control'
  const clear = async () => {
    await editor.press(`${modifier}+a`)
    await editor.press('Backspace')
    await expect(editor).toHaveText('')
  }
  await expect(editor).toBeVisible()
  await clear()
  await editor.pressSequentially('SkyAnchor')
  await editor.press('Enter')
  await editor.pressSequentially('second line ')
  await current.keyboard.insertText('👨‍👩‍👧‍👦')
  await expect(editor).toContainText('👨‍👩‍👧‍👦')
  await editor.press('End')
  await expect
    .poll(() =>
      editor.evaluate(node => {
        const selection = window.getSelection()
        return selection?.focusNode?.textContent?.slice(
          0,
          selection.focusOffset,
        )
      }),
    )
    .toContain('👨‍👩‍👧‍👦')
  // Separate insertion from deletion using UndoRedo's 500 ms history group.
  await current.waitForTimeout(600)
  await editor.press('Backspace')
  await expect(editor).not.toContainText('👨')
  await editor.press(`${modifier}+z`)
  await expect(editor).toContainText('👨‍👩‍👧‍👦')
  await editor.press(`${modifier}+Shift+z`)
  await expect(editor).not.toContainText('👨')
  assert.ok((await editor.innerText()).includes('\n'))
  await clear()
  await editor.evaluate(node => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', 'plain\nmultiline')
    node.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await expect(editor).toHaveText('plainmultiline')
  assert.equal(await editor.locator('p').count(), 2)
  await clear()
  await editor.evaluate(node => {
    const clipboardData = new DataTransfer()
    clipboardData.setData(
      'text/plain',
      'safe #SkyAnchor https://example.test/path',
    )
    clipboardData.setData(
      'text/html',
      '<b>unsafe formatting</b><img src="x" onerror="globalThis.__composerPasteExecuted=true"><script>globalThis.__composerPasteExecuted=true</script>',
    )
    node.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await expect(editor).toHaveText('safe #SkyAnchor https://example.test/path')
  assert.equal(await editor.locator('b,strong,img,script,[onerror]').count(), 0)
  await expect(editor.locator('.autolink')).toHaveCount(2)
  assert.equal(
    await current.evaluate(() => globalThis.__composerPasteExecuted),
    undefined,
  )
  await clear()
  await editor.pressSequentially('@read')
  await expect(current.locator('.items')).toBeVisible()
  await expect(
    current.locator('.items').getByText('@reader.test', {exact: true}),
  ).toBeVisible()
  await editor.press('Enter')
  await expect(editor.locator('[data-type="mention"]')).toHaveAttribute(
    'data-id',
    'reader.test',
  )
  await editor.press('End')
  await editor.evaluate(node =>
    node.dispatchEvent(
      new CompositionEvent('compositionstart', {bubbles: true, data: ''}),
    ),
  )
  await current.keyboard.insertText('日本語')
  await editor.evaluate(node =>
    node.dispatchEvent(
      new CompositionEvent('compositionend', {bubbles: true, data: '日本語'}),
    ),
  )
  await expect(editor).toContainText('日本語')
  await editor.press('ArrowLeft')
  await editor.press('ArrowRight')
  await expect(dialog.getByTestId('composerPublishBtn')).toBeEnabled()
  await clear()
  await dialog
    .getByRole('button', {name: 'Remove attachment', exact: true})
    .click()
  await expect(current.locator('.items')).not.toBeVisible()
  await expect(dialog.getByTestId('composerPublishBtn')).toBeDisabled()
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).click()
  await expect(dialog).not.toBeVisible()

  if (!phone) {
    await current.goto(new URL('/profile/reader.test', current.url()).href)
    await expect(current.getByTestId('profileScreen')).toBeVisible()
    await current
      .getByRole('button', {name: 'Compose new post', exact: true})
      .click()
    await expect(editor.locator('[data-type="mention"]')).toHaveAttribute(
      'data-id',
      'reader.test',
    )
    await clear()
    await dialog.getByRole('button', {name: 'Cancel', exact: true}).click()
    await expect(dialog).not.toBeVisible()
  }

  const result = await build({
    entryPoints: [path.join('proof', 'tiptap-security-entry.mjs')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
  })
  await current.evaluate(result.outputFiles[0].text)
  const security = await current.evaluate(() =>
    globalThis.verifyTiptapAttributes(),
  )
  assert.deepEqual(security, {
    ordinaryPrototype: true,
    keys: ['__proto__'],
    ownDataProperty: true,
    inheritedCanary: undefined,
    handler: null,
    source: null,
    canary: null,
  })
  return {
    browser: phone ? 'webkit-phone' : 'chromium-desktop',
    productionEditor: true,
    cases: [
      'multiline',
      'emoji-grapheme-delete',
      'undo',
      'redo',
      'plain-paste',
      'HTML-to-plain-paste',
      'tag-and-link-decorations',
      'mention-suggestion-and-insert',
      'composition-events',
      'selection-navigation',
      'publish-enabled-without-posting',
      ...(!phone ? ['initial-profile-mention-content'] : []),
    ],
    advisory: {id: 'GHSA-cp6q-959q-f8rh', security},
  }
}
