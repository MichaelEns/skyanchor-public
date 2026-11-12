import assert from 'node:assert/strict'
import {chromium, devices as browserDevices, expect} from '@playwright/test'
import {
  readingAction,
  closeReadingPanel,
  readingPanel,
  scrollReading,
} from './reading-panel.mjs'

export async function verifyDeviceCheckpoints({
  desktopBrowser,
  phoneBrowser,
  mockUpstream,
  signIn,
  worker,
  report,
  holdApi,
  entries,
}) {
  const did = 'did:plc:mmmmmmmmmmmmmmmmmmmmmmmm'
  const originalAuthor = entries[0].post.author.did
  const scenarioTimeline = JSON.parse(
    JSON.stringify(entries).replaceAll(originalAuthor, did),
  )
  const controlsByPage = new Map()
  const contexts = [],
    writes = [],
    errors = []
  const requests = new Map(),
    profileIds = new Map()
  let sourceHold
  const writeCount = page =>
    writes.filter(item => item.device === profileIds.get(page)).length
  const pendingRequests = page =>
    [...requests.values()].filter(
      item => item.profile === profileIds.get(page) && !item.finished,
    )
  const key = 'skyanchor:following:v1:' + did
  const local = page =>
    page.evaluate(key => JSON.parse(localStorage.getItem(key))?.place, key)
  const cloud = async () => ({
    place: await worker.db
      .prepare("SELECT * FROM places WHERE did = ? AND feed = 'following'")
      .bind(did)
      .first(),
    clock: await worker.db.prepare('SELECT * FROM clock').first(),
  })
  const history = device =>
    worker.db
      .prepare(
        "SELECT revision, state, updated FROM reading_history WHERE did = ? AND feed = 'following' AND device = ? ORDER BY revision DESC",
      )
      .bind(did, device)
      .all()
      .then(result => result.results)
  const profileId = page =>
    page.evaluate(() => localStorage.getItem('skyanchor:device'))
  async function fresh(browser, phone = false) {
    const context = await browser.newContext({
      ...(phone
        ? browserDevices['iPhone 13']
        : {viewport: {width: 1280, height: 900}}),
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    contexts.push(context)
    const controls = await mockUpstream(context, did)
    controls.setTimeline(scenarioTimeline)
    const page = await context.newPage()
    controlsByPage.set(page, controls)
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => {
      if (new URL(request.url()).pathname !== '/api/skyanchor/place') return
      const body = request.postDataJSON()
      const record = {
        profile: profileIds.get(page),
        method: request.method(),
        expectedRevision: body?.revision,
        status: undefined,
        revision: undefined,
        finished: false,
      }
      requests.set(request, record)
      if (request.method() === 'PUT')
        writes.push({device: profileIds.get(page), state: body.state, record})
    })
    page.on('response', async response => {
      const record = requests.get(response.request())
      if (!record) return
      record.status = response.status()
      try {
        const value = await response.json()
        record.revision = value.revision ?? value.current?.revision
      } catch (error) {
        errors.push('Checkpoint response parse failed: ' + error.message)
      }
    })
    page.on('requestfinished', request => {
      const record = requests.get(request)
      if (record) record.finished = true
    })
    page.on('requestfailed', request => {
      const record = requests.get(request)
      if (record) {
        record.finished = true
        errors.push(
          'Checkpoint request failed: ' + request.failure()?.errorText,
        )
      }
    })
    await signIn(page, 'reader.test')
    profileIds.set(page, await profileId(page))
    return page
  }
  async function confirmed(page, previous = 0) {
    await expect
      .poll(
        async () => {
          const current = (await cloud()).place
          return (
            current?.revision > previous &&
            current.device === profileIds.get(page) &&
            current.state === JSON.stringify(await local(page))
          )
        },
        {timeout: 10000},
      )
      .toBe(true)
    await readingPanel(page)
    await expect(page.getByTestId('skyanchor-source-state')).toContainText(
      'Current local place confirmed shared',
    )
    await expect(
      page.getByRole('button', {name: 'Save my place', exact: true}),
    ).toBeEnabled()
    await expect.poll(() => pendingRequests(page).length).toBe(0)
    return (await cloud()).place
  }
  async function phoneCheckpoint(page, distance) {
    await scrollReading(page, distance)
    const offset = await page.evaluate(key => {
      const place = JSON.parse(localStorage.getItem(key)).place
      const node = [...document.querySelectorAll('[data-skyanchor-key]')].find(
        node => node.dataset.skyanchorKey === place.anchor,
      )
      const header = document.querySelector('[data-testid="mobileHomeHeader"]')
      return (
        node.getBoundingClientRect().top -
        (header?.getBoundingClientRect().bottom ?? 0) +
        20
      )
    }, key)
    await scrollReading(page, offset)
  }
  async function chooseSource(page, device) {
    await readingPanel(page)
    await page
      .getByRole('combobox', {name: 'Source of saved place', exact: true})
      .click()
    await page
      .getByRole('option')
      .filter({hasText: '[' + device.slice(0, 4) + ']'})
      .click()
    await expect(
      page.getByRole('button', {name: 'Resume saved place', exact: true}),
    ).toBeEnabled()
  }
  async function chooseSave(page, prefix) {
    await page.getByRole('combobox', {name: 'Saved place', exact: true}).click()
    await expect(page.getByRole('option')).toHaveCount(3)
    const labels = await page.getByRole('option').allTextContents()
    assert.ok(labels.every(label => /\d/.test(label)))
    await page.getByRole('option').filter({hasText: prefix}).click()
    return labels
  }
  async function placement(page, state) {
    const error = await page.evaluate(place => {
      const node = [...document.querySelectorAll('[data-skyanchor-key]')].find(
        node => node.dataset.skyanchorKey === place.anchor,
      )
      const header = document.querySelector('[data-testid="mobileHomeHeader"]')
      return node
        ? Math.abs(
            node.getBoundingClientRect().top -
              (header?.getBoundingClientRect().bottom ?? 0) -
              place.offset,
          )
        : Infinity
    }, state)
    assert.ok(
      error <= 2,
      'The frozen occurrence and offset must be placed within two pixels',
    )
    return error
  }
  try {
    const a = await fresh(phoneBrowser, true)
    await phoneCheckpoint(a, 400)
    await readingAction(a, 'Connect private sync')
    let row = await confirmed(a)
    const aId = await profileId(a)
    const registry = async () =>
      (
        await worker.db
          .prepare(
            'SELECT device, label, label_kind AS labelKind FROM device_registry WHERE did = ? ORDER BY device',
          )
          .bind(did)
          .all()
      ).results
    const phoneName = (await registry()).find(item => item.device === aId)
    assert.match(phoneName.label, /^Safari on iPhone - /)
    assert.equal(phoneName.labelKind, 'default')
    for (let i = 0; i < 3; i++) {
      await closeReadingPanel(a)
      await phoneCheckpoint(a, 700)
      row = await confirmed(a, row.revision)
    }
    const aSaves = await history(aId)
    assert.equal(aSaves.length, 3)
    await readingPanel(a)
    await expect(
      a.getByRole('textbox', {name: 'Name this browser profile', exact: true}),
    ).toHaveValue(phoneName.label)
    await a
      .getByRole('textbox', {name: 'Name this browser profile', exact: true})
      .fill('Fixture phone reading profile')
    await readingAction(a, 'Save browser name')
    await expect(
      a.getByText('This browser profile was renamed.', {exact: true}),
    ).toBeVisible()
    const b = await fresh(desktopBrowser)
    await readingAction(b, 'Connect private sync')
    await expect(
      b.getByRole('button', {name: 'Resume other device', exact: true}),
    ).toBeEnabled()
    await readingAction(b, 'Resume other device')
    await expect(b.getByTestId('skyanchor-resume-result')).toContainText(
      'Confirmed locally.',
    )
    await expect
      .poll(async () => JSON.stringify(await local(b)))
      .toBe(row.state)
    await readingPanel(b)
    await expect(b.getByTestId('skyanchor-source-state')).toContainText(
      'Current local place confirmed shared',
    )
    await closeReadingPanel(b)
    await scrollReading(b, 650)
    const shared = await confirmed(b, row.revision)
    const bId = await profileId(b)
    const c = await fresh(desktopBrowser)
    await readingAction(c, 'Connect private sync')
    await readingAction(c, 'Resume other device')
    await expect(c.getByTestId('skyanchor-resume-result')).toContainText(
      'Confirmed locally.',
    )
    await expect
      .poll(async () => JSON.stringify(await local(c)))
      .toBe(shared.state)
    await readingPanel(c)
    await expect(c.getByTestId('skyanchor-source-state')).toContainText(
      'Current local place confirmed shared',
    )
    const cId = await profileId(c)
    assert.equal(new Set([aId, bId, cId]).size, 3)
    const generated = (await registry()).filter(item =>
      [bId, cId].includes(item.device),
    )
    for (const item of generated) {
      assert.match(item.label, /^(Chrome|Edge) on Windows - /)
      assert.ok(item.label.endsWith(item.device.slice(0, 4)))
      assert.equal(item.labelKind, 'default')
    }
    assert.notEqual(generated[0].label, generated[1].label)
    await expect(
      c.getByRole('textbox', {name: 'Name this browser profile', exact: true}),
    ).toHaveValue(generated.find(item => item.device === cId).label)
    await readingAction(b, 'Check saved places')
    await expect(
      b.getByRole('button', {name: 'Check saved places', exact: true}),
    ).toBeEnabled()
    const before = await cloud(),
      beforeLocal = await local(b),
      beforeWrites = writeCount(b)
    await chooseSource(b, aId)
    const labels = await chooseSave(b, 'Older save')
    await expect(
      b.getByRole('combobox', {name: 'Source of saved place', exact: true}),
    ).toContainText('Fixture phone reading profile')
    assert.deepEqual(await local(b), beforeLocal)
    assert.deepEqual(await cloud(), before)
    assert.equal(writeCount(b), beforeWrites)
    const chosen = aSaves[2]
    // A newer source head must not replace the record already selected on B.
    await closeReadingPanel(a)
    await phoneCheckpoint(a, 550)
    await readingAction(a, 'Check other device')
    await expect(
      a.getByRole('button', {name: 'Keep mine', exact: true}),
    ).toBeEnabled()
    const sourceLocal = await local(a),
      sourceBefore = await cloud()
    const cookie = (await a.context().cookies()).find(
      item => item.name === '__Host-skyanchor',
    )
    assert.ok(cookie)
    sourceHold = holdApi('PUT', {
      cookie: cookie.name + '=' + cookie.value,
      scenario: 'device-checkpoint-source-keep-mine',
    })
    await readingAction(a, 'Keep mine')
    let holdTimeout
    try {
      await Promise.race([
        sourceHold.reached,
        new Promise((_, reject) => {
          holdTimeout = setTimeout(
            () => reject(new Error('Source Keep mine did not reach D1')),
            10000,
          )
        }),
      ])
    } finally {
      clearTimeout(holdTimeout)
    }
    const committedWhileHeld = await cloud()
    assert.equal(sourceHold.request.status, 200)
    assert.ok(committedWhileHeld.place.revision > sourceBefore.place.revision)
    assert.equal(committedWhileHeld.place.device, aId)
    assert.equal(committedWhileHeld.place.state, JSON.stringify(sourceLocal))
    assert.equal(
      committedWhileHeld.clock.revision,
      committedWhileHeld.place.revision,
    )
    assert.deepEqual(writes.at(-1).state, sourceLocal)
    assert.equal(writes.at(-1).device, aId)
    assert.equal(
      pendingRequests(a).filter(item => item.method === 'PUT').length,
      1,
    )
    const sourcePendingWhileHeld = pendingRequests(a).map(item => ({...item}))
    await expect(
      a.getByRole('button', {name: 'Save my place', exact: true}),
    ).toBeDisabled()
    assert.ok(
      !(await history(aId)).some(item => item.revision === chosen.revision),
    )
    // The destination may attempt recovery while A's committed response is still held.
    const bWritesBeforeHeld = writeCount(b)
    await readingAction(b, 'Resume saved place')
    await expect(b.getByTestId('skyanchor-resume-result')).toContainText(
      'expired or was deleted',
    )
    assert.equal(writeCount(b), bWritesBeforeHeld)
    const receivingWritesWhileSourceHeld = writeCount(b) - bWritesBeforeHeld
    assert.deepEqual(await local(b), beforeLocal)
    assert.deepEqual(await cloud(), committedWhileHeld)
    sourceHold.release()
    sourceHold = undefined
    const confirmedSource = await confirmed(a, sourceBefore.place.revision)
    assert.equal(confirmedSource.revision, committedWhileHeld.place.revision)
    assert.equal(confirmedSource.state, JSON.stringify(sourceLocal))
    const advanced = await cloud(),
      sourceWrites = writeCount(a)
    // Let the real debounce/pending retry run; no source write is suppressed.
    await a.waitForTimeout(1200)
    assert.equal(writeCount(a), sourceWrites)
    assert.equal(pendingRequests(a).length, 0)
    assert.deepEqual(await cloud(), advanced)
    const receivingWrites = writeCount(b)
    await readingAction(b, 'Resume saved place')
    await expect(b.getByTestId('skyanchor-resume-result')).toContainText(
      'expired or was deleted',
    )
    assert.deepEqual(await local(b), beforeLocal)
    assert.deepEqual(await cloud(), advanced)
    assert.equal(writeCount(b), receivingWrites)
    await readingAction(b, 'Check saved places')
    await expect(
      b.getByRole('button', {name: 'Check saved places', exact: true}),
    ).toBeEnabled()
    await chooseSave(b, 'Previous save')
    const chosenCurrent = (await history(aId))[1]
    const beforeRestore = await cloud(),
      putsBeforeRestore = writeCount(b)
    const selectedUri = JSON.parse(chosenCurrent.state).anchor.split('|')[0]
    assert.ok(selectedUri.startsWith('at://' + did + '/'))
    const bControls = controlsByPage.get(b)
    const localBytes = () =>
      b.evaluate(
        key => ({
          snapshot: localStorage.getItem(key),
          return: localStorage.getItem(
            key.replace('skyanchor:following:', 'skyanchor:return:'),
          ),
          url: location.href,
        }),
        key,
      )
    const beforeRejected = await localBytes()
    const historyBeforeRejected = await history(aId)
    const rejectedRecords = []
    for (const reason of ['moderated', 'deleted']) {
      if (reason === 'moderated')
        bControls.setRecordModerated(selectedUri, true)
      else bControls.setRecordDeleted(selectedUri, true)
      const responsesBefore = bControls.revalidationResponses.length
      await readingAction(b, 'Resume saved place')
      await expect(b.getByTestId('skyanchor-resume-result')).toContainText(
        'Could not restore the exact saved occurrence.',
      )
      if (reason === 'moderated')
        await expect(b.getByTestId('skyanchor-resume-result')).toContainText(
          'missing or excluded by current moderation',
        )
      const revalidation =
        bControls.revalidationResponses.slice(responsesBefore)
      const response = revalidation.find(item =>
        item.requested.includes(selectedUri),
      )
      assert.ok(
        response,
        'Historical recovery must revalidate the exact selected URI',
      )
      if (reason === 'moderated')
        assert.ok(
          response.posts
            .find(item => item.uri === selectedUri)
            .labels.some(label => label.val === '!hide'),
        )
      else assert.ok(!response.posts.some(item => item.uri === selectedUri))
      assert.deepEqual(await localBytes(), beforeRejected)
      assert.deepEqual(await cloud(), beforeRestore)
      assert.deepEqual(await history(aId), historyBeforeRejected)
      assert.equal(writeCount(b), putsBeforeRestore)
      rejectedRecords.push({reason, uri: selectedUri, revalidation})
      if (reason === 'moderated')
        bControls.setRecordModerated(selectedUri, false)
      else bControls.setRecordDeleted(selectedUri, false)
    }
    await readingAction(b, 'Resume saved place')
    await expect(b.getByTestId('skyanchor-resume-result')).toContainText(
      'Restored this saved place locally',
    )
    await expect
      .poll(async () => JSON.stringify(await local(b)))
      .toBe(chosenCurrent.state)
    const error = await placement(b, JSON.parse(chosenCurrent.state))
    assert.deepEqual(await cloud(), beforeRestore)
    assert.equal(writeCount(b), putsBeforeRestore)
    await scrollReading(b, 90)
    await b.waitForTimeout(1200)
    await b.evaluate(() => dispatchEvent(new Event('focus')))
    await b.waitForTimeout(500)
    assert.deepEqual(await cloud(), beforeRestore)
    assert.equal(writeCount(b), putsBeforeRestore)
    await b.reload()
    await b.getByTestId('skyanchor-reading-button').waitFor()
    await readingPanel(b)
    await expect(b.getByTestId('skyanchor-source-state')).toContainText(
      'Restored saved place is local only',
    )
    await closeReadingPanel(b)
    await scrollReading(b, 70)
    await b.waitForTimeout(1100)
    assert.deepEqual(await cloud(), beforeRestore)
    // Device history includes this browser's own earlier saves, not only others.
    await readingAction(b, 'Check saved places')
    await expect(
      b.getByRole('button', {name: 'Check saved places', exact: true}),
    ).toBeEnabled()
    await chooseSource(b, bId)
    await expect(
      b.getByRole('combobox', {name: 'Source of saved place', exact: true}),
    ).toContainText('This browser')
    await chooseSource(b, aId)
    const historicalRestorePuts = writeCount(b) - putsBeforeRestore
    assert.equal(historicalRestorePuts, 0)
    const cControls = controlsByPage.get(c)
    const chosenSharedUri = JSON.parse(beforeRestore.place.state).anchor.split(
      '|',
    )[0]
    const originalSharedUri = chosenSharedUri.replace(did, originalAuthor)
    const originalSharedRecord = cControls.sharedRecordState(originalSharedUri)
    const cResponsesBefore = cControls.revalidationResponses.length
    await readingAction(c, 'Check other device')
    await readingAction(c, 'Resume other device')
    await expect(c.getByTestId('skyanchor-resume-result')).toContainText(
      'Confirmed locally.',
    )
    await expect
      .poll(async () => JSON.stringify(await local(c)))
      .toBe(beforeRestore.place.state)
    await readingPanel(c)
    await expect(c.getByTestId('skyanchor-source-state')).toContainText(
      'Current local place confirmed shared',
    )
    const cRevalidation = cControls.revalidationResponses
      .slice(cResponsesBefore)
      .find(item => item.requested.includes(chosenSharedUri))
    assert.ok(cRevalidation)
    assert.ok(cRevalidation.posts.some(item => item.uri === chosenSharedUri))
    assert.deepEqual(
      cRevalidation.posts.find(item => item.uri === chosenSharedUri).labels,
      [],
    )
    assert.ok(cRevalidation.isolatedTimeline)
    assert.deepEqual(await cloud(), beforeRestore)
    await closeReadingPanel(c)
    await scrollReading(c, 350)
    const cShared = await confirmed(c, beforeRestore.place.revision)
    // Sharing a local historical view requires a fresh, explicit shared-head decision.
    await readingAction(b, 'Save my place')
    await expect(
      b.getByText(
        'Latest shared changed. Review it and choose Keep mine again to share this local view.',
        {exact: true},
      ),
    ).toBeVisible()
    assert.equal(
      writeCount(b) - putsBeforeRestore,
      0,
      'Only C has written; B must not silently overwrite it',
    )
    await readingAction(b, 'Keep mine')
    await confirmed(b, cShared.revision)
    await expect(
      b.getByRole('button', {name: 'Keep mine', exact: true}),
    ).toHaveCount(0)
    const explicitlyShared = (await cloud()).place
    assert.ok(explicitlyShared.revision > cShared.revision)
    assert.equal(explicitlyShared.device, bId)
    assert.equal(explicitlyShared.state, JSON.stringify(await local(b)))
    assert.equal(
      await b.evaluate(
        did => localStorage.getItem('skyanchor:historic-local:' + did),
        did,
      ),
      null,
    )
    // A tombstone after a list read must reject the cached save before movement.
    await readingAction(c, 'Check other device')
    await readingAction(c, 'Resume other device')
    await expect(c.getByTestId('skyanchor-resume-result')).toContainText(
      'Confirmed locally.',
    )
    await expect
      .poll(async () => JSON.stringify(await local(c)))
      .toBe(explicitlyShared.state)
    await readingPanel(c)
    await expect(c.getByTestId('skyanchor-source-state')).toContainText(
      'Current local place confirmed shared',
    )
    await readingAction(c, 'Delete cloud progress and disconnect')
    await expect(
      c.getByText(
        'Cloud progress deleted and sync disconnected. Your local reading place is unchanged.',
        {exact: true},
      ),
    ).toBeVisible()
    const deleted = await cloud(),
      localBeforeDeleteRestore = await local(b)
    assert.equal(deleted.place.state, null)
    await readingAction(b, 'Resume saved place')
    await expect(b.getByTestId('skyanchor-resume-result')).toContainText(
      'Cloud progress was deleted',
    )
    assert.deepEqual(await local(b), localBeforeDeleteRestore)
    assert.deepEqual(await cloud(), deleted)
    assert.equal((await history(aId)).length, 0)
    assert.ok(chosen.revision < chosenCurrent.revision)
    assert.deepEqual(errors, [])
    report.deviceCheckpoints = {
      profiles: 3,
      retained: 3,
      labels,
      placementError: error,
      rejectedExpired: true,
      rejectedTombstone: true,
      historicalRestorePuts,
      explicitSharingCAS: true,
      generatedPhoneName: phoneName.label,
      generatedDesktopNames: generated.map(item => item.label),
      heldSourceCommit: committedWhileHeld.place.revision,
      confirmedSourceRevision: confirmedSource.revision,
      receivingWritesWhileSourceHeld,
      sourcePendingWhileHeld,
      requests: [...requests.values()],
      originalSharedRecord,
      isolatedSharedUri: chosenSharedUri,
      isolatedSharedRevalidation: cRevalidation,
      rejectedRecords,
    }
    report.checks.push(
      'Three production browser profiles: renamed source, three timestamped saves, no-write selection, expired immutable choice, exact local historical restore, durable autosave pause, own-browser history and deletion-race rejection',
    )
  } finally {
    sourceHold?.release()
    await Promise.all(contexts.map(context => context.close()))
  }
}

export async function verifyScrollInput({
  phoneBrowser,
  mockUpstream,
  signIn,
  worker,
  report,
}) {
  const did = 'did:plc:jjjjjjjjjjjjjjjjjjjjjjjj'
  const key = 'skyanchor:following:v1:' + did
  const contexts = []
  const errors = []
  const puts = []
  const sourcePlacements = []
  let receivingWrites = 0
  const cloud = () =>
    worker.db
      .prepare(
        "SELECT *, (SELECT revision FROM clock WHERE id = 1) AS clockRevision FROM places WHERE did = ? AND feed = 'following'",
      )
      .bind(did)
      .first()
  const local = page =>
    page.evaluate(key => JSON.parse(localStorage.getItem(key))?.place, key)
  const browser = await chromium.launch({
    ...(process.env.SKYANCHOR_BROWSER_CHANNEL
      ? {channel: process.env.SKYANCHOR_BROWSER_CHANNEL}
      : {}),
    ignoreDefaultArgs: ['--hide-scrollbars'],
  })
  async function placement(page, row) {
    const error = await page.evaluate(place => {
      const node = [...document.querySelectorAll('[data-skyanchor-key]')].find(
        node => node.dataset.skyanchorKey === place.anchor,
      )
      const header = document.querySelector('[data-testid="mobileHomeHeader"]')
      return Math.abs(
        node.getBoundingClientRect().top -
          (header?.getBoundingClientRect().bottom ?? 0) -
          place.offset,
      )
    }, JSON.parse(row.state))
    assert.ok(error <= 2)
    return error
  }
  async function fresh(owner, phone = false) {
    const context = await owner.newContext({
      ...(phone
        ? browserDevices['iPhone 13']
        : {viewport: {width: 1280, height: 900}}),
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    contexts.push(context)
    await mockUpstream(context, did)
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => {
      if (
        request.method() === 'PUT' &&
        new URL(request.url()).pathname === '/api/skyanchor/place'
      )
        puts.push({phone, state: JSON.parse(request.postData()).state})
    })
    await signIn(page, 'reader.test')
    return page
  }
  async function confirmed(page, previous) {
    await expect
      .poll(
        async () => {
          const row = await cloud()
          return (
            row?.revision > previous &&
            row.state === JSON.stringify(await local(page))
          )
        },
        {timeout: 10000},
      )
      .toBe(true)
    const row = await cloud()
    assert.ok(row.updated > 0)
    assert.equal(
      row.device,
      await page.evaluate(() => localStorage.getItem('skyanchor:device')),
    )
    await readingPanel(page)
    await expect(page.getByTestId('skyanchor-source-state')).toContainText(
      'Current local place confirmed shared',
    )
    await closeReadingPanel(page)
    sourcePlacements.push(await placement(page, row))
    return row
  }
  async function receive(page, row) {
    const before = puts.length
    await readingAction(page, 'Resume other device')
    await expect
      .poll(async () => JSON.stringify(await local(page)))
      .toBe(row.state)
    await readingPanel(page)
    await expect(
      page.getByRole('button', {name: 'Check other device', exact: true}),
    ).toBeEnabled()
    await expect(page.getByTestId('skyanchor-source-state')).toContainText(
      'Current local place confirmed shared',
    )
    await closeReadingPanel(page)
    const error = await placement(page, row)
    await page.waitForTimeout(1000)
    receivingWrites += puts.length - before
    assert.equal(receivingWrites, 0, 'Receiving a shared place must not PUT')
    assert.deepEqual(await cloud(), row)
    return error
  }
  async function passiveAfter(page, row) {
    const before = puts.length
    await page.waitForTimeout(350)
    await page.evaluate(() => scrollBy(0, 57))
    await expect
      .poll(async () => JSON.stringify(await local(page)))
      .not.toBe(row.state)
    await page.evaluate(() => dispatchEvent(new Event('resize')))
    await page.waitForTimeout(1100)
    await readingAction(page, 'Check other device')
    await expect(
      page.getByRole('button', {name: 'Resume other device', exact: true}),
    ).toBeEnabled()
    assert.equal(
      puts.length,
      before,
      'Settled input cannot authorize a passive restore',
    )
    assert.deepEqual(await cloud(), row)
    return receive(page, row)
  }
  try {
    const phone = await fresh(phoneBrowser, true)
    await scrollReading(phone, 500)
    await readingAction(phone, 'Connect private sync')
    const first = await confirmed(phone, 0)
    /*
     * Discrete JS steps have separate native scrollend events. Suppress only
     * those ends to exercise the bounded fallback of a continuous inertial run.
     */
    const momentum = await phone.evaluate(async () => {
      const suppressEnd = event => event.stopImmediatePropagation()
      document.addEventListener('scrollend', suppressEnd, true)
      const samples = []
      const observe = event =>
        samples.push({
          at: performance.now(),
          intentional: event.detail.intentional,
          y: scrollY,
        })
      window.addEventListener('skyanchor-place', observe)
      dispatchEvent(new Event('touchstart'))
      scrollBy(0, 25)
      dispatchEvent(new Event('touchend'))
      const released = performance.now()
      try {
        for (let step = 0; step < 38; step++) {
          await new Promise(resolve => setTimeout(resolve, 80))
          scrollBy(0, 14)
        }
        await new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        )
        return {released, ended: performance.now(), samples, y: scrollY}
      } finally {
        window.removeEventListener('skyanchor-place', observe)
        document.removeEventListener('scrollend', suppressEnd, true)
      }
    })
    assert.ok(momentum.ended - momentum.released >= 3000)
    const late = momentum.samples.filter(
      sample => sample.at - momentum.released > 1500,
    )
    report.scrollInput = {momentum, late}
    assert.ok(late.length > 10)
    assert.ok(late.every(sample => sample.intentional))
    const phoneFinal = await confirmed(phone, first.revision)
    const phonePassiveError = await passiveAfter(phone, phoneFinal)
    const desktop = await fresh(browser)
    await readingAction(desktop, 'Connect private sync')
    const desktopReceiveError = await receive(desktop, phoneFinal)
    const native = await desktop.evaluate(() => {
      const root = document.documentElement
      window.fixtureNativeInput = []
      for (const name of ['pointerdown', 'pointerup', 'scrollend'])
        window.addEventListener(
          name,
          event => {
            window.fixtureNativeInput.push({
              name,
              x: event.clientX,
              y: event.clientY,
              trusted: event.isTrusted,
              target: event.target.tagName,
            })
          },
          true,
        )
      const gutter = innerWidth - root.clientWidth
      const track = innerHeight - 34
      const thumb = Math.max(17, (track * innerHeight) / root.scrollHeight)
      return {
        gutter,
        x: innerWidth - gutter / 2,
        y:
          17 +
          ((track - thumb) * scrollY) / (root.scrollHeight - innerHeight) +
          thumb / 2,
        before: scrollY,
        height: root.scrollHeight,
        viewport: innerHeight,
      }
    })
    report.scrollInput.native = native
    assert.ok(
      native.gutter > 0,
      'Native proof must have a real non-overlay gutter',
    )
    await desktop.mouse.move(native.x, native.y)
    await desktop.mouse.down()
    await desktop.mouse.move(native.x, native.y + 38, {steps: 12})
    await desktop.mouse.up()
    await expect
      .poll(() => desktop.evaluate(() => scrollY))
      .not.toBe(native.before)
    const desktopFinal = await confirmed(desktop, phoneFinal.revision)
    const nativeEvents = await desktop.evaluate(() => window.fixtureNativeInput)
    assert.ok(
      nativeEvents.some(
        event =>
          event.name === 'pointerdown' &&
          event.trusted &&
          event.target === 'HTML',
      ),
    )
    const desktopPassiveError = await passiveAfter(desktop, desktopFinal)
    await readingAction(phone, 'Check other device')
    const phoneReceiveError = await receive(phone, desktopFinal)
    assert.deepEqual(errors, [])
    report.scrollInput = {
      passed: true,
      desktop: {
        channel: process.env.SKYANCHOR_BROWSER_CHANNEL ?? 'chromium',
        version: browser.version(),
        native,
        nativeEvents,
      },
      phone: {
        controlledTouchSequence: true,
        physicalInertia: false,
        fallbackWithoutScrollend: true,
        duration: momentum.ended - momentum.released,
        lateIntentionalCaptures: late.length,
        final: JSON.parse(phoneFinal.state),
        revision: phoneFinal.revision,
        updated: phoneFinal.updated,
      },
      desktopFinal: {
        state: JSON.parse(desktopFinal.state),
        revision: desktopFinal.revision,
        updated: desktopFinal.updated,
      },
      placements: [
        phonePassiveError,
        desktopReceiveError,
        desktopPassiveError,
        phoneReceiveError,
      ],
      sourcePlacements,
      passiveReceivingWrites: receivingWrites,
      puts,
      errors,
    }
    report.checks.push(
      'Controlled WebKit touch momentum beyond three seconds and a real native Chromium/Edge scrollbar thumb drag confirm their final checkpoints without Save; settled passive movement and resize do not PUT and offer explicit Resume.',
    )
  } finally {
    for (const context of contexts) await context.close()
    await browser.close()
  }
}

export async function verifyReverseHandoff({
  desktopBrowser,
  phoneBrowser,
  mockUpstream,
  signIn,
  worker,
  report,
}) {
  const did = 'did:plc:iiiiiiiiiiiiiiiiiiiiiiii'
  const key = 'skyanchor:following:v1:' + did
  const contexts = []
  const errors = []
  const puts = []
  const placements = []
  const legacyViews = []
  const cloud = () =>
    worker.db
      .prepare(
        "SELECT *, (SELECT revision FROM clock WHERE id = 1) AS clockRevision, (SELECT nonce FROM clock WHERE id = 1) AS clockNonce FROM places WHERE did = ? AND feed = 'following'",
      )
      .bind(did)
      .first()
  const local = page =>
    page.evaluate(key => JSON.parse(localStorage.getItem(key))?.place, key)
  async function fresh(browser, phone = false) {
    const context = await browser.newContext({
      ...(phone
        ? browserDevices['iPhone 13']
        : {viewport: {width: 1280, height: 900}}),
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    contexts.push(context)
    await mockUpstream(context, did)
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => {
      if (
        request.method() === 'PUT' &&
        new URL(request.url()).pathname === '/api/skyanchor/place'
      )
        puts.push({phone, body: JSON.parse(request.postData())})
    })
    await signIn(page, 'reader.test')
    return page
  }
  async function confirmed(page, previous = 0) {
    await expect
      .poll(
        async () => {
          const row = await cloud()
          return (
            row?.revision > previous &&
            row.state === JSON.stringify(await local(page))
          )
        },
        {timeout: 10000},
      )
      .toBe(true)
    const row = await cloud()
    assert.ok(row.updated > 0)
    assert.equal(
      row.device,
      await page.evaluate(() => localStorage.getItem('skyanchor:device')),
    )
    return row
  }
  async function exact(page, row) {
    await expect
      .poll(async () => JSON.stringify(await local(page)))
      .toBe(row.state)
    const error = await page.evaluate(place => {
      const node = [...document.querySelectorAll('[data-skyanchor-key]')].find(
        node => node.dataset.skyanchorKey === place.anchor,
      )
      const header = document.querySelector('[data-testid="mobileHomeHeader"]')
      return node
        ? Math.abs(
            node.getBoundingClientRect().top -
              (header?.getBoundingClientRect().bottom ?? 0) -
              place.offset,
          )
        : Infinity
    }, JSON.parse(row.state))
    assert.ok(error <= 2, `Actual reverse-handoff placement error: ${error}`)
    placements.push(error)
    await expect
      .poll(() =>
        page.evaluate(
          did => Number(localStorage.getItem('skyanchor:revision:' + did)),
          did,
        ),
      )
      .toBe(row.revision)
    await readingPanel(page)
    await expect(
      page.getByRole('button', {name: 'Check other device', exact: true}),
    ).toBeEnabled()
    await expect(page.getByTestId('skyanchor-source-state')).toContainText(
      'Current local place confirmed shared',
    )
    await closeReadingPanel(page)
  }
  async function choice(page, row) {
    const before = await page.evaluate(() => scrollY)
    const count = puts.length
    await readingAction(page, 'Check other device')
    await expect(
      page.getByRole('button', {name: 'Resume other device', exact: true}),
    ).toBeEnabled()
    assert.equal(await page.evaluate(() => scrollY), before)
    await page.waitForTimeout(1000)
    assert.equal(puts.length, count, 'Checking a stale local view must not PUT')
    assert.deepEqual(await cloud(), row)
  }
  try {
    assert.equal(
      await cloud(),
      null,
      'Reverse fixture requires a fresh synthetic account',
    )
    const phone = await fresh(phoneBrowser, true)
    await scrollReading(phone, 1700)
    await readingAction(phone, 'Connect private sync')
    const old = await confirmed(phone)
    const oldSnapshot = await phone.evaluate(
      key => localStorage.getItem(key),
      key,
    )
    await phone.addInitScript(
      ({key, oldSnapshot}) => {
        if (sessionStorage.getItem('fixture:stale-reading-snapshot') === '1') {
          localStorage.setItem(key, oldSnapshot)
          sessionStorage.removeItem('fixture:stale-reading-snapshot')
        }
      },
      {key, oldSnapshot},
    )
    const coldOldView = async () => {
      await closeReadingPanel(phone)
      await phone.evaluate(() =>
        sessionStorage.setItem('fixture:stale-reading-snapshot', '1'),
      )
      await phone.reload()
      await phone.getByTestId('skyanchor-reading-button').waitFor()
      await phone.waitForTimeout(1100)
      const state = JSON.parse(oldSnapshot).place
      await expect
        .poll(async () => (await local(phone))?.anchor)
        .toBe(state.anchor)
      const actual = await phone.evaluate(() => {
        const bottom = document
          .querySelector('[data-testid="mobileHomeHeader"]')
          .getBoundingClientRect().bottom
        const node = [
          ...document.querySelectorAll('[data-skyanchor-key]'),
        ].find(
          node =>
            node.getClientRects().length &&
            node.getBoundingClientRect().bottom > bottom + 1,
        )
        return {
          anchor: node?.dataset.skyanchorKey,
          offset: node?.getBoundingClientRect().top - bottom,
        }
      })
      assert.equal(
        actual.anchor,
        state.anchor,
        'Legacy fixture must actually show the old phone occurrence',
      )
      assert.ok(Math.abs(actual.offset - state.offset) <= 2)
      legacyViews.push({
        actual,
        acceptedRevision: await phone.evaluate(
          did => Number(localStorage.getItem('skyanchor:revision:' + did)),
          did,
        ),
        cloud: await cloud(),
      })
    }
    await closeReadingPanel(phone)
    const desktop = await fresh(desktopBrowser)
    await readingAction(desktop, 'Connect private sync')
    await readingAction(desktop, 'Resume other device')
    await exact(desktop, old)
    await scrollReading(desktop, -900)
    let recent = await confirmed(desktop, old.revision)
    assert.notEqual(recent.state, old.state)
    await phone.evaluate(() => dispatchEvent(new Event('focus')))
    await choice(phone, recent)
    const awaitingChoiceY = await phone.evaluate(() => scrollY)
    await scrollReading(desktop, -110)
    recent = await confirmed(desktop, recent.revision)
    assert.equal(await phone.evaluate(() => scrollY), awaitingChoiceY)
    await choice(phone, recent)
    await readingAction(phone, 'Resume other device')
    await exact(phone, recent)
    assert.deepEqual(await cloud(), recent)
    // Backward-compatible revision/snapshot mismatch, without altering D1.
    await coldOldView()
    await choice(phone, recent)
    await readingAction(phone, 'Resume other device')
    await exact(phone, recent)
    assert.deepEqual(await cloud(), recent)
    const receivingWrites = puts.length
    for (const action of [
      async () => {
        await readingPanel(phone)
        await closeReadingPanel(phone)
        await phone.evaluate(() => {
          dispatchEvent(new Event('focus'))
          document.dispatchEvent(new Event('visibilitychange'))
          dispatchEvent(new Event('resize'))
        })
      },
      async () => {
        await phone.setViewportSize({width: 414, height: 896})
        await phone.waitForTimeout(300)
        await phone.setViewportSize({width: 390, height: 844})
      },
      async () => {
        await phone.evaluate(place => {
          const node = [
            ...document.querySelectorAll('[data-skyanchor-key]'),
          ].find(node => node.dataset.skyanchorKey === place.anchor)
          node.querySelector('a[href*="/post/"]').click()
        }, JSON.parse(recent.state))
        await phone.waitForURL(/\/post\//)
        await phone
          .getByTestId(/^postThreadItem-by-/)
          .filter({visible: true})
          .first()
          .waitFor()
        await phone.goBack()
        await phone.getByTestId('skyanchor-reading-button').waitFor()
      },
      async () => {
        const origin = new URL(phone.url()).origin
        await phone.goto(origin + '/profile/sharon-fixture.test')
        await phone.getByTestId('profileFeedTabs').waitFor()
        await readingAction(phone, 'Check other device')
        await expect(
          phone.getByRole('button', {name: 'Check other device', exact: true}),
        ).toBeEnabled()
        await closeReadingPanel(phone)
        await phone.goto(origin)
        await phone.getByTestId('skyanchor-reading-button').waitFor()
      },
      async () => {
        await phone.reload()
        await phone.getByTestId('skyanchor-reading-button').waitFor()
      },
    ]) {
      await closeReadingPanel(phone)
      await action()
      await phone.waitForTimeout(1100)
      await exact(phone, recent)
      assert.equal(
        puts.length,
        receivingWrites,
        'Passive re-entry must not share',
      )
      assert.deepEqual(await cloud(), recent)
    }

    await readingAction(phone, 'Check other device')
    await expect(
      phone.getByText('Already at the shared place.', {exact: false}),
    ).toBeVisible()
    await expect(phone.getByTestId('skyanchor-source-state')).toContainText(
      'Current local place confirmed shared',
    )
    await expect(phone.getByTestId('skyanchor-last-verified')).toBeVisible()
    await expect(
      phone.getByRole('button', {name: 'Resume other device', exact: true}),
    ).toHaveCount(0)
    await closeReadingPanel(phone)

    await readingAction(phone, 'Return to my place')
    await expect
      .poll(async () => (await local(phone))?.anchor)
      .toBe(JSON.parse(oldSnapshot).place.anchor)
    await phone.waitForTimeout(1100)
    assert.equal(
      puts.length,
      receivingWrites,
      'Intentional local Return alone must not replace the shared place',
    )
    assert.deepEqual(await cloud(), recent)
    await choice(phone, recent)
    await readingAction(phone, 'Resume other device')
    await exact(phone, recent)
    assert.deepEqual(await cloud(), recent)

    const secondDesktop = await fresh(desktopBrowser)
    await readingAction(secondDesktop, 'Connect private sync')
    await readingAction(secondDesktop, 'Resume other device')
    await exact(secondDesktop, recent)
    assert.deepEqual(await cloud(), recent)

    // Same browser provenance is not proof that its cached view matches.
    await readingAction(phone, 'Save my place')
    const owned = await confirmed(phone, recent.revision)
    await closeReadingPanel(phone)
    await coldOldView()
    await choice(phone, owned)
    await expect(phone.getByTestId('skyanchor-shared-save')).toContainText(
      'This browser',
    )
    await readingAction(phone, 'Resume other device')
    await exact(phone, owned)
    assert.deepEqual(await cloud(), owned)

    // Intentionally rereading older content remains shareable after adoption.
    await scrollReading(phone, 650)
    const reread = await confirmed(phone, owned.revision)
    assert.notEqual(reread.state, owned.state)
    await readingPanel(phone)
    await expect(phone.getByTestId('skyanchor-source-state')).toContainText(
      'Current local place confirmed shared',
    )
    await closeReadingPanel(phone)
    assert.deepEqual(await cloud(), reread)

    const desktopLocal = await local(secondDesktop)
    await readingAction(phone, 'Delete cloud progress and disconnect')
    await expect(
      phone.getByText(
        'Cloud progress deleted and sync disconnected. Your local reading place is unchanged.',
        {exact: true},
      ),
    ).toBeVisible()
    const cleared = await cloud()
    assert.ok(cleared.revision > reread.revision)
    assert.equal(cleared.state, null)
    const beforeNone = puts.length
    await readingAction(secondDesktop, 'Check other device')
    await expect(
      secondDesktop.getByTestId('skyanchor-source-state'),
    ).toContainText('There is no shared place to resume')
    await expect(
      secondDesktop.getByRole('button', {
        name: 'Resume other device',
        exact: true,
      }),
    ).toHaveCount(0)
    await closeReadingPanel(secondDesktop)
    await secondDesktop.reload()
    await secondDesktop.getByTestId('skyanchor-reading-button').waitFor()
    await secondDesktop.waitForTimeout(1100)
    assert.deepEqual(await local(secondDesktop), desktopLocal)
    assert.deepEqual(await local(phone), JSON.parse(reread.state))
    assert.equal(puts.length, beforeNone)
    assert.deepEqual(await cloud(), cleared)

    assert.deepEqual(errors, [])
    report.reverseHandoff = {
      devices: contexts.length,
      placements,
      legacyViews,
      puts,
      equalRevisionMismatch: true,
      sameWriterMismatch: true,
      passiveReentries: 5,
      matchingViewVerified: true,
      sourceAdvancedDuringChoice: true,
      intentionalOlderRead: true,
      tombstonePreserved: true,
      tombstoneRevision: cleared.revision,
      errors,
      passed: true,
    }
    report.checks.push(
      'Previously persisted WebKit phone resumes a desktop scroll-only confirmed checkpoint, including an equal-accepted-revision/stale-snapshot cold reopen, with no receiving PUT.',
    )
  } catch (error) {
    report.reverseHandoff = {
      placements,
      legacyViews,
      puts,
      cloud: await cloud(),
      localViews: await Promise.all(
        contexts.map(async context => {
          const page = context.pages()[0]
          return {
            local: await local(page),
            ui: (await page.locator('body').innerText()).slice(-7000),
          }
        }),
      ),
      errors,
      passed: false,
    }
    throw error
  } finally {
    for (const context of contexts) await context.close()
  }
}

export async function verifyAutomaticSource({
  desktopBrowser,
  phoneBrowser,
  origin,
  mockUpstream,
  signIn,
  worker,
  report,
  holdApi,
}) {
  const did = 'did:plc:hhhhhhhhhhhhhhhhhhhhhhhh'
  const key = 'skyanchor:following:v1:' + did
  const contexts = []
  const errors = []
  const writes = []
  const cloud = () =>
    worker.db
      .prepare(
        "SELECT *, (SELECT revision FROM clock WHERE id = 1) AS clockRevision FROM places WHERE did = ? AND feed = 'following'",
      )
      .bind(did)
      .first()
  const local = page =>
    page.evaluate(key => JSON.parse(localStorage.getItem(key))?.place, key)
  async function reached(hold) {
    let timer
    try {
      await Promise.race([
        hold.reached,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error('Source request did not reach its fixture hold'),
              ),
            10000,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  async function fresh(browser, phone = false) {
    const context = await browser.newContext({
      ...(phone
        ? browserDevices['iPhone 13']
        : {viewport: {width: 1280, height: 900}}),
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    })
    contexts.push(context)
    await context.addInitScript(() => {
      window.fixtureAutomaticInitialKeys = Object.keys(localStorage).filter(
        key =>
          key.startsWith('skyanchor:following:') ||
          key.startsWith('skyanchor:revision:') ||
          key.startsWith('skyanchor:sync-enabled:'),
      )
    })
    const controls = await mockUpstream(context, did)
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const expected = new Map()
    page.on('response', response => {
      if (
        response.status() < 400 ||
        response.url().includes('com.atproto.repo.getRecord')
      )
        return
      const id =
        response.request().method() +
        ' ' +
        new URL(response.url()).pathname +
        ' ' +
        response.status()
      if (expected.get(id)) expected.set(id, expected.get(id) - 1)
      else errors.push(id)
    })
    await signIn(page, 'reader.test')
    assert.deepEqual(
      await page.evaluate(() => window.fixtureAutomaticInitialKeys),
      [],
    )
    return {page, context, controls, expected}
  }
  async function confirmed(page, device, previous = 0) {
    try {
      await expect
        .poll(
          async () => {
            const row = await cloud()
            return (
              !!row &&
              row.revision > previous &&
              row.device === device &&
              row.state === JSON.stringify(await local(page))
            )
          },
          {timeout: 10000},
        )
        .toBe(true)
    } catch (error) {
      report.automaticSourceFailure = {
        cloud: await cloud(),
        local: await local(page),
        ui: (await page.locator('body').innerText()).slice(-6000),
        label: await page
          .getByTestId('skyanchor-reading-button')
          .getAttribute('aria-label'),
      }
      throw error
    }
    const row = await cloud()
    writes.push({
      writer: device,
      revision: row.revision,
      anchor: JSON.parse(row.state).anchor,
      offset: JSON.parse(row.state).offset,
      updated: row.updated,
    })
    await readingPanel(page)
    await expect(page.getByTestId('skyanchor-source-state')).toContainText(
      'Current local place confirmed shared',
    )
    await expect(page.getByTestId('skyanchor-shared-save')).toContainText(
      'This browser',
    )
    await closeReadingPanel(page)
    const sourceError = await page.evaluate(place => {
      const row = [...document.querySelectorAll('[data-skyanchor-key]')].find(
        node => node.dataset.skyanchorKey === place.anchor,
      )
      const header = document.querySelector('[data-testid="mobileHomeHeader"]')
      return row
        ? Math.abs(
            row.getBoundingClientRect().top -
              (header?.getBoundingClientRect().bottom ?? 0) -
              place.offset,
          )
        : Infinity
    }, JSON.parse(row.state))
    assert.ok(
      sourceError <= 2,
      'Source shared checkpoint matches the actual visible phone position',
    )
    return row
  }
  async function direct(destination, expected) {
    const page = destination.page
    const before = await page.evaluate(() => scrollY)
    await readingAction(page, 'Connect private sync')
    await expect(
      page.getByRole('button', {name: 'Resume other device', exact: true}),
    ).toBeEnabled()
    assert.equal(await page.evaluate(() => scrollY), before)
    assert.deepEqual(await cloud(), expected)
    await expect(page.getByTestId('skyanchor-shared-save')).toContainText(
      'Another browser',
    )
    await readingAction(page, 'Resume other device')
    await expect
      .poll(async () => JSON.stringify(await local(page)))
      .toBe(expected.state)
    await expect(page.getByTestId('skyanchor-resume-result')).toContainText(
      'Resumed the other device',
    )
    assert.deepEqual(await cloud(), expected)
    const error = await page.evaluate(place => {
      const row = [...document.querySelectorAll('[data-skyanchor-key]')].find(
        node => node.dataset.skyanchorKey === place.anchor,
      )
      const header = document.querySelector('[data-testid="mobileHomeHeader"]')
      return Math.abs(
        row.getBoundingClientRect().top -
          (header?.getBoundingClientRect().bottom ?? 0) -
          place.offset,
      )
    }, JSON.parse(expected.state))
    assert.ok(error <= 2)
    return error
  }
  try {
    assert.equal(await cloud(), null)
    const phone = await fresh(phoneBrowser, true)
    const a = phone.page
    const device = await a.evaluate(() =>
      localStorage.getItem('skyanchor:device'),
    )
    await scrollReading(a, 900)
    await expect.poll(async () => (await local(a))?.offset).not.toBe(0)
    await readingAction(a, 'Connect private sync')
    // Connecting after a capture must not require another scroll event.
    const first = await confirmed(a, device)
    const b = await fresh(desktopBrowser)
    const firstError = await direct(b, first)
    const bY = await b.page.evaluate(() => scrollY)
    const held = holdApi('GET')
    try {
      await a.evaluate(() => {
        dispatchEvent(new Event('focus'))
      })
      await reached(held)
      await scrollReading(a, 350)
      await a.waitForTimeout(900)
    } finally {
      held.release()
    }
    const second = await confirmed(a, device, first.revision)
    await a.evaluate(() => {
      dispatchEvent(new Event('focus'))
      dispatchEvent(new Event('online'))
    })
    assert.equal(await b.page.evaluate(() => scrollY), bY)
    await readingAction(b.page, 'Check other device')
    await expect(b.page.getByTestId('skyanchor-source-state')).toContainText(
      'saved only on this device',
    )
    assert.deepEqual(await cloud(), second)
    // A real explicit decision on another browser makes the source pause.
    await readingAction(b.page, 'Keep mine')
    await expect(
      b.page.getByText('Private reading place saved.', {exact: true}),
    ).toBeVisible()
    const conflict = await cloud()
    await a.evaluate(() => dispatchEvent(new Event('focus')))
    await readingPanel(a)
    await expect(a.getByTestId('skyanchor-source-state')).toContainText(
      'saved only on this device',
    )
    await closeReadingPanel(a)
    await scrollReading(a, 220)
    await a.waitForTimeout(1100)
    assert.deepEqual(await cloud(), conflict)
    await readingAction(a, 'Keep mine')
    await expect(
      a.getByText('Private reading place saved.', {exact: true}),
    ).toBeVisible()
    await closeReadingPanel(a)
    const heldWrite = holdApi('PUT')
    try {
      await scrollReading(a, 85)
      await reached(heldWrite)
      await a.evaluate(() => {
        dispatchEvent(new WheelEvent('wheel', {deltaY: 55}))
        scrollBy(0, 55)
        dispatchEvent(new Event('focus'))
        dispatchEvent(new Event('online'))
      })
      await a.waitForTimeout(900)
    } finally {
      heldWrite.release()
    }
    const recovered = await confirmed(a, device, conflict.revision)
    await phone.context.setOffline(true)
    await scrollReading(a, 95)
    await readingPanel(a)
    await expect(a.getByTestId('skyanchor-source-state')).toContainText(
      'not confirmed shared',
    )
    await expect(a.getByText(/Offline: no write sent/)).toBeVisible()
    assert.deepEqual(await cloud(), recovered)
    await phone.context.setOffline(false)
    await a.evaluate(() => dispatchEvent(new Event('online')))
    const online = await confirmed(a, device, recovered.revision)
    phone.controls.expireAccess()
    phone.expected.set('POST /api/skyanchor/session 401', 1)
    await readingAction(a, 'Reconnect private sync')
    await expect(
      a.getByRole('button', {name: 'Reconnect private sync', exact: true}),
    ).toBeEnabled()
    assert.equal(phone.expected.get('POST /api/skyanchor/session 401'), 0)
    await closeReadingPanel(a)
    await scrollReading(a, 65)
    const latest = await confirmed(a, device, online.revision)
    const c = await fresh(desktopBrowser)
    const secondError = await direct(c, latest)
    const devices = await Promise.all(
      [a, b.page, c.page].map(page =>
        page.evaluate(() => localStorage.getItem('skyanchor:device')),
      ),
    )
    assert.equal(new Set(devices).size, 3)
    assert.deepEqual(errors, [])
    report.automaticSource = {
      devices: 3,
      writes,
      placements: [firstError, secondError],
      preconnectCapture: true,
      concurrentCheck: true,
      concurrentWriteAndCheck: true,
      blockedRevision: conflict.revision,
      explicitConflictPause: true,
      offlineRecoveryWithoutNewScroll: true,
      regionalRenewal: true,
      errors,
    }
    report.checks.push(
      'Actual WebKit phone scroll-only automatic checkpoints reach two fresh desktop Connect/direct Resume epochs; no source Save helper, no receiving writes, concurrent foreground checks drain pending movement, explicit conflicts pause visibly, offline and regional renewal recover with server-confirmed captions and timestamps.',
    )
  } finally {
    for (const context of contexts) await context.close()
  }
}

export async function verifyHandoff({
  desktopBrowser,
  phoneBrowser,
  origin,
  mockUpstream,
  signIn,
  worker,
  report,
  deleted,
  entries,
  post,
  holdApi,
}) {
  const did = 'did:plc:eeeeeeeeeeeeeeeeeeeeeeee'
  const contexts = []
  const failures = []
  const records = []
  const boundedNotice =
    'This is a bounded reading window. Older contiguous history may be unavailable.'
  const indicatorCases = []
  const markerColor = page =>
    page
      .getByTestId('skyanchor-reading-indicator')
      .evaluate(node => getComputedStyle(node).backgroundColor)
  async function reached(hold, page) {
    let timer
    try {
      await Promise.race([
        hold.reached,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('Resume did not reach the held history page')),
            15000,
          )
        }),
      ])
    } catch (error) {
      report.handoffFailure = {
        ui: await page.locator('body').innerText(),
        historyRequests: contexts.find(
          context => context.fixture?.page === page,
        )?.fixture.controls.timelineRequests,
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  const history = Array.from({length: 510}, (_, index) => ({
    post: post(index + 1),
  }))
  const root = post(601)
  const parent = post(600, {
    record: {
      ...post(600).record,
      reply: {
        root: {uri: root.uri, cid: root.cid},
        parent: {uri: root.uri, cid: root.cid},
      },
    },
  })
  history[469] = {
    post: post(470, {
      record: {
        ...post(470).record,
        reply: {
          root: {uri: root.uri, cid: root.cid},
          parent: {uri: parent.uri, cid: parent.cid},
        },
      },
    }),
    reply: {root, parent},
    reason: {...entries[69].reason, indexedAt: post(470).indexedAt},
  }
  const key = 'skyanchor:following:v1:' + did
  const cloud = () =>
    worker.db
      .prepare(
        "SELECT *, (SELECT revision FROM clock WHERE id = 1) AS clockRevision, (SELECT nonce FROM clock WHERE id = 1) AS clockNonce FROM places WHERE did = ? AND feed = 'following'",
      )
      .bind(did)
      .first()
  const local = page =>
    page.evaluate(key => JSON.parse(localStorage.getItem(key))?.place, key)
  const savedBytes = page =>
    page.evaluate(() => ({
      storage: Object.fromEntries(
        Object.entries(localStorage).filter(
          ([key]) =>
            key.startsWith('skyanchor:following:') ||
            key.startsWith('skyanchor:return:') ||
            key.startsWith('skyanchor:revision:'),
        ),
      ),
      rows: [...document.querySelectorAll('[data-skyanchor-key]')].map(
        node => node.dataset.skyanchorKey,
      ),
      query: location.href,
    }))
  const placementError = (page, state) =>
    page.evaluate(place => {
      const row = [...document.querySelectorAll('[data-skyanchor-key]')].find(
        node => node.dataset.skyanchorKey === place.anchor,
      )
      const header = document.querySelector('[data-testid="mobileHomeHeader"]')
      return row
        ? Math.abs(
            row.getBoundingClientRect().top -
              (header?.getBoundingClientRect().bottom ?? 0) -
              place.offset,
          )
        : Infinity
    }, state)
  const confirmation = async page => {
    await readingAction(page, 'Save my place')
    await expect
      .poll(
        async () =>
          (await cloud())?.state === JSON.stringify(await local(page)),
      )
      .toBe(true)
    await closeReadingPanel(page)
    return cloud()
  }
  const offer = async page => {
    const before = await page.evaluate(() => window.scrollY)
    await readingAction(page, 'Check other device')
    await expect(
      page.getByRole('button', {name: 'Resume other device', exact: true}),
    ).toBeVisible()
    assert.equal(await page.evaluate(() => window.scrollY), before)
    await closeReadingPanel(page)
  }
  const resume = async (page, state) => {
    await offer(page)
    await readingAction(page, 'Resume other device')
    await expect
      .poll(async () => JSON.stringify(await local(page)))
      .toBe(JSON.stringify(state))
    const error = await page.evaluate(place => {
      const row = [...document.querySelectorAll('[data-skyanchor-key]')].find(
        node => node.dataset.skyanchorKey === place.anchor,
      )
      const header = document.querySelector('[data-testid="mobileHomeHeader"]')
      return row
        ? Math.abs(
            row.getBoundingClientRect().top -
              (header?.getBoundingClientRect().bottom ?? 0) -
              place.offset,
          )
        : Infinity
    }, state)
    assert.ok(
      error <= 2,
      'Explicit handoff restores the exact occurrence and header-relative offset',
    )
    records.push({step: 'resume', error})
  }
  try {
    for (const [index, browser] of [
      desktopBrowser,
      phoneBrowser,
      desktopBrowser,
    ].entries()) {
      const context = await browser.newContext({
        viewport:
          index === 1 ? {width: 390, height: 844} : {width: 1280, height: 900},
        ...(index === 1
          ? {
              isMobile: true,
              hasTouch: true,
              userAgent: browserDevices['iPhone 13'].userAgent,
              ignoreHTTPSErrors: true,
            }
          : {}),
        serviceWorkers: 'block',
      })
      contexts.push(context)
      await context.addInitScript(() => {
        window.fixtureInitialReadingKeys = Object.keys(localStorage).filter(
          key => key.startsWith('skyanchor:'),
        )
      })
      const controls = await mockUpstream(context, did)
      controls.setTimeline(history)
      const page = await context.newPage()
      page.on('pageerror', error => failures.push(error.message))
      const expected = new Map()
      page.on('response', response => {
        if (
          response.status() < 400 ||
          response.url().includes('com.atproto.repo.getRecord')
        )
          return
        const id =
          response.request().method() +
          ' ' +
          new URL(response.url()).pathname +
          ' ' +
          response.status()
        if (expected.get(id)) expected.set(id, expected.get(id) - 1)
        else failures.push(id)
      })
      await signIn(page, index === 0 ? 'fixture@example.test' : 'reader.test')
      assert.deepEqual(
        await page.evaluate(() => window.fixtureInitialReadingKeys),
        [],
      )
      if (index === 2) {
        await page.reload()
        await page.getByTestId('HomeScreen').waitFor()
        await page.locator('[data-skyanchor-key]').first().waitFor()
      }
      contexts[index].fixture = {page, controls, expected}
    }
    const [a, b, c] = contexts.map(context => context.fixture.page)
    const devices = await Promise.all(
      [a, b, c].map(page =>
        page.evaluate(() => localStorage.getItem('skyanchor:device')),
      ),
    )
    assert.equal(new Set(devices).size, 3)
    assert.ok(devices.every(Boolean))
    const sharedTab = await contexts[0].newPage()
    try {
      await sharedTab.goto(origin + '/')
      await sharedTab.getByTestId('HomeScreen').waitFor()
      await sharedTab.getByTestId('skyanchor-reading-button').waitFor()
      assert.equal(
        await sharedTab.evaluate(() =>
          localStorage.getItem('skyanchor:device'),
        ),
        devices[0],
      )
    } finally {
      await sharedTab.close()
    }
    await expect(a.getByTestId('skyanchor-reading-indicator')).toHaveCount(0)
    await expect(
      a.getByTestId('skyanchor-reading-button'),
    ).toHaveAccessibleName('Reading place: Not connected')
    await readingAction(a, 'Connect private sync')
    await expect(a.getByTestId('skyanchor-toolbar')).toContainText(
      'There is no shared saved place for this feed',
    )
    await expect(a.getByTestId('skyanchor-connection-status')).toHaveText(
      'Connected',
    )
    await expect(a.getByTestId('skyanchor-reading-indicator')).toHaveCount(0)
    await closeReadingPanel(a)
    // Load real successive timeline pages; B and C keep their different, fresh windows.
    for (let i = 0; i < 20; i++) {
      const count = await a.locator('[data-skyanchor-key]').count()
      if (await a.locator('[data-skyanchor-key*="/post470|"]').count()) break
      await a.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      )
      await expect
        .poll(() => a.locator('[data-skyanchor-key]').count())
        .toBeGreaterThan(count)
    }
    const target = a.locator('[data-skyanchor-key*="/post470|repost:"]').last()
    await target.scrollIntoViewIfNeeded()
    await target.evaluate(node =>
      window.scrollBy(0, node.getBoundingClientRect().top + 37),
    )
    await expect
      .poll(async () => (await local(a))?.anchor.includes('/post470|repost:'))
      .toBe(true)
    const first = await confirmation(a)
    const place = JSON.parse(first.state)
    assert.ok(
      contexts[0].fixture.controls.timelineRequests.some(
        request => request.index >= 450,
      ),
    )
    assert.ok(place.anchor.includes('/post470|repost:did:'))
    assert.ok(place.anchor.includes('|reply:at://'))
    for (const page of [b, c]) {
      const controls = contexts.find(context => context.fixture.page === page)
        .fixture.controls
      // Exercise both legitimate outcomes, independent of list pagination timing.
      if (page === b) controls.setTimeline(history.slice(0, 480))
      const olderPage = page === c ? controls.holdTimeline(30, 480) : undefined
      try {
        assert.equal(
          await page.evaluate(
            did => localStorage.getItem('skyanchor:revision:' + did),
            did,
          ),
          null,
        )
        assert.equal(
          await page.evaluate(
            did => localStorage.getItem('skyanchor:sync-enabled:' + did),
            did,
          ),
          null,
        )
        assert.equal(
          await page.evaluate(
            anchor =>
              [...document.querySelectorAll('[data-skyanchor-key]')].some(
                node => node.dataset.skyanchorKey === anchor,
              ),
            place.anchor,
          ),
          false,
        )
        const y = await page.evaluate(() => window.scrollY)
        if (page === b) {
          contexts[1].fixture.controls.expireAccess()
          contexts[1].fixture.expected.set('POST /api/skyanchor/session 401', 1)
        }
        await readingAction(page, 'Connect private sync')
        await expect(
          page.getByRole('button', {name: 'Resume other device', exact: true}),
        ).toBeVisible()
        await expect(
          page.getByTestId('skyanchor-reading-button'),
        ).toHaveAccessibleName(/Other device place available/)
        const red = await markerColor(page)
        assert.equal(await page.evaluate(() => window.scrollY), y)
        await readingAction(page, 'Resume other device')
        await expect
          .poll(async () => JSON.stringify(await local(page)), {timeout: 20000})
          .toBe(JSON.stringify(place))
        await expect(page.getByTestId('skyanchor-resume-result')).toContainText(
          'Resumed the other device',
        )
        const eof = page === b
        await expect
          .poll(() =>
            controls.timelineResponses.some(
              response =>
                response.index === 450 &&
                response.limit === 30 &&
                response.hasOlder === !eof,
            ),
          )
          .toBe(true)
        const button = page.getByTestId('skyanchor-reading-button')
        if (eof) {
          await expect(button).toHaveAccessibleName(
            'Reading place: ' + boundedNotice,
          )
          assert.equal(
            await markerColor(page),
            red,
            'Known EOF notice retains the remote-offer red theme palette',
          )
        } else {
          await expect(button).toHaveAccessibleName(
            'Reading place: Return available',
          )
          assert.notEqual(
            await markerColor(page),
            red,
            'Return with an available older cursor uses the blue theme palette',
          )
        }
        const color = await markerColor(page)
        await readingPanel(page)
        await expect(
          page.getByRole('button', {name: 'Return to my place', exact: true}),
        ).toBeEnabled()
        const primary = await page
          .getByRole('button', {name: 'Return to my place', exact: true})
          .evaluate(node => getComputedStyle(node).backgroundColor)
        if (!eof)
          assert.equal(
            color,
            primary,
            'Blue Return dot matches the enabled primary Return control palette',
          )
        else
          assert.notEqual(
            color,
            primary,
            'Known red EOF notice takes priority over the blue Return control',
          )
        await expect(page.getByTestId('skyanchor-source-state')).toContainText(
          'Current local place confirmed shared',
        )
        await expect(
          page.getByTestId('skyanchor-connection-status'),
        ).toHaveText('Connected')
        await expect(page.getByText('Sync error', {exact: true})).toHaveCount(0)
        if (eof) {
          await expect(page.getByTestId('skyanchor-fallback')).toHaveText(
            boundedNotice,
          )
        } else {
          await expect(page.getByTestId('skyanchor-fallback')).toHaveCount(0)
        }
        await closeReadingPanel(page)
        await expect(button).toHaveAccessibleName(
          'Reading place: ' + (eof ? boundedNotice : 'Return available'),
        )
        assert.equal(
          await markerColor(page),
          color,
          'Closing the panel does not clear or reclassify the indicator',
        )
        indicatorCases.push({
          browser: page === b ? 'WebKit phone' : 'Chromium desktop',
          kind: eof
            ? 'red-known-eof-notice-with-Return'
            : 'blue-Return-with-older-cursor',
          confirmedShared: true,
          color,
          primary,
        })
        const error = await placementError(page, place)
        assert.ok(error <= 2, `Direct first-use placement error ${error}`)
        records.push({
          step: 'direct-first-use',
          browser: page === b ? 'WebKit phone' : 'Chromium desktop',
          depth: 470,
          error,
        })
        assert.ok(
          contexts
            .find(context => context.fixture.page === page)
            .fixture.controls.timelineRequests.some(
              request => request.index >= 450 && request.limit === 30,
            ),
        )
        assert.deepEqual(
          await cloud(),
          first,
          'Direct first-use Resume never writes cloud progress',
        )
      } finally {
        olderPage?.release()
        controls.setTimeline(history)
      }
    }
    const samePlaceSave = await confirmation(a)
    assert.equal(samePlaceSave.state, first.state)
    await readingAction(b, 'Check other device')
    assert.ok((await placementError(b, JSON.parse(samePlaceSave.state))) <= 2)
    assert.deepEqual(await local(b), JSON.parse(samePlaceSave.state))
    await expect(b.getByTestId('skyanchor-source-state')).toContainText(
      'Current local place confirmed shared',
    )
    await expect(b.getByTestId('skyanchor-last-verified')).toBeVisible()
    await expect(
      b.getByRole('button', {name: 'Resume other device', exact: true}),
    ).toHaveCount(0)
    assert.deepEqual(await cloud(), samePlaceSave)
    await closeReadingPanel(b)
    await b.evaluate(() => window.scrollBy(0, 19))
    await expect
      .poll(async () => (await local(b))?.offset)
      .not.toBe(JSON.parse(samePlaceSave.state).offset)
    await offer(b)
    const starts = contexts[1].fixture.controls.timelineRequests.filter(
      request => request.limit === 30 && request.index === 0,
    ).length
    await readingPanel(b)
    const doubleResume = b.getByRole('button', {
      name: 'Resume other device',
      exact: true,
    })
    const disabledBeforeCheckSettled = await doubleResume.isDisabled()
    await expect(doubleResume).toBeEnabled()
    report.doubleActivation = {disabledBeforeCheckSettled}
    await doubleResume.evaluate(button => {
      button.click()
      button.click()
    })
    await expect(b.getByTestId('skyanchor-resume-result')).toContainText(
      "Resumed the other device's saved place",
    )
    assert.deepEqual(await cloud(), samePlaceSave)
    assert.equal(
      contexts[1].fixture.controls.timelineRequests.filter(
        request => request.limit === 30 && request.index === 0,
      ).length,
      starts + 1,
      'Double activation starts exactly one Resume',
    )
    await b.evaluate(() => window.scrollBy(0, 31))
    const second = await confirmation(b)
    await resume(c, JSON.parse(second.state))
    await c.evaluate(() => window.scrollBy(0, 29))
    const third = await confirmation(c)
    assert.ok(
      first.revision < second.revision && second.revision < third.revision,
    )
    await offer(a)
    assert.equal(
      (await cloud()).revision,
      third.revision,
      'Offers never write cloud progress',
    )
    assert.equal(
      (await contexts[0].cookies()).find(
        value => value.name === '__Host-skyanchor',
      )?.value ===
        (await contexts[1].cookies()).find(
          value => value.name === '__Host-skyanchor',
        )?.value,
      false,
    )
    // Freeze A's explicit choice while C publishes a newer revision during recovery.
    const aControls = contexts[0].fixture.controls
    let held = aControls.holdTimeline(30, 30)
    try {
      await readingAction(a, 'Resume other device')
      await reached(held, a)
      await expect(a.getByTestId('skyanchor-resume-result')).toContainText(
        /History pages checked: [0-9]+/,
      )
      await a.evaluate(() => {
        window.dispatchEvent(new Event('focus'))
        window.dispatchEvent(new Event('online'))
      })
      await c.evaluate(() => window.scrollBy(0, 23))
      const newer = await confirmation(c)
      assert.ok(newer.revision > third.revision)
      held.release()
      await expect
        .poll(async () => JSON.stringify(await local(a)))
        .toBe(third.state)
      await readingPanel(a)
      await expect(
        a.getByRole('button', {name: 'Resume other device', exact: true}),
      ).toBeEnabled()
      assert.deepEqual(
        await cloud(),
        newer,
        'Resuming an older frozen offer cannot overwrite the newer source revision',
      )
      await closeReadingPanel(a)
      // Both explicit Cancel and user movement abort the active request without consuming any local checkpoint.
      for (const kind of ['cancel', 'pan']) {
        const before = await savedBytes(a)
        held = aControls.holdTimeline(30, 30)
        await readingAction(a, 'Resume other device')
        await reached(held, a)
        if (kind === 'cancel')
          await a
            .getByRole('button', {name: 'Cancel Resume', exact: true})
            .click()
        else
          await a.evaluate(() =>
            window.dispatchEvent(new WheelEvent('wheel', {deltaY: 1})),
          )
        await expect(a.getByTestId('skyanchor-resume-result')).toContainText(
          'Resume cancelled',
        )
        held.release()
        assert.deepEqual(
          await savedBytes(a),
          before,
          `${kind} must preserve all saved bytes, rows, URL and revision`,
        )
        assert.deepEqual(await cloud(), newer)
      }
      const beforePlacementCancel = await savedBytes(a)
      await a.evaluate(() => {
        window.fixtureResumeScroll = window.scrollBy
        window.scrollBy = function (...args) {
          window.scrollBy = window.fixtureResumeScroll
          window.fixtureResumeScroll.apply(window, args)
          window.dispatchEvent(new WheelEvent('wheel', {deltaY: 1}))
        }
      })
      try {
        await readingAction(a, 'Resume other device')
        await expect(a.getByTestId('skyanchor-resume-result')).toContainText(
          'Resume cancelled',
        )
        await a.evaluate(
          () =>
            new Promise(resolve =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        )
        assert.deepEqual(
          await savedBytes(a),
          beforePlacementCancel,
          'Cancellation during exact placement rolls back the staged query and saved bytes',
        )
        assert.deepEqual(await cloud(), newer)
      } finally {
        await a.evaluate(() => {
          window.scrollBy = window.fixtureResumeScroll
        })
      }
    } finally {
      held.release()
    }
    // Rotate a real-shaped regional session using SessionProvider's refresh result.
    const phone = contexts[1].fixture
    phone.controls.expireAccess()
    phone.expected.set('POST /api/skyanchor/session 401', 1)
    const beforeRenewal = await local(b)
    const cookieBeforeRenewal = (await contexts[1].cookies()).find(
      value => value.name === '__Host-skyanchor',
    )?.value
    await readingAction(b, 'Reconnect private sync')
    await expect
      .poll(
        async () =>
          (await contexts[1].cookies()).find(
            value => value.name === '__Host-skyanchor',
          )?.value,
      )
      .not.toBe(cookieBeforeRenewal)
    await expect(
      b.getByText(
        'The shared place differs from this device. Choose Resume other device to resume the shared place, or Keep mine to share this view. Your viewport has not moved.',
        {exact: true},
      ),
    ).toBeVisible()
    assert.deepEqual(await local(b), beforeRenewal)
    assert.ok(
      phone.controls.issuedAccess.length >= 2,
      'Renewal must rotate access credentials',
    )
    assert.ok(
      worker.verifications.includes(
        'https://shimeji.us-east.host.bsky.network',
      ),
    )
    await closeReadingPanel(b)
    await worker.db
      .prepare('UPDATE sessions SET expires = 0 WHERE did = ?')
      .bind(did)
      .run()
    phone.expected.set('GET /api/skyanchor/place 401', 1)
    await readingAction(b, 'Check other device')
    await expect(
      b.getByRole('button', {name: 'Resume other device', exact: true}),
    ).toBeVisible()
    await closeReadingPanel(b)
    // One failed explicit renewal retains local progress and recovers on an explicit retry.
    phone.controls.expireAccess()
    phone.controls.failRefresh(true)
    phone.expected.set('POST /api/skyanchor/session 401', 1)
    phone.expected.set('POST /xrpc/com.atproto.server.refreshSession 503', 1)
    const beforeFailure = await cloud()
    await readingAction(b, 'Reconnect private sync')
    await expect(
      b.getByText(/Bluesky session renewal did not complete/),
    ).toBeVisible()
    assert.deepEqual(await cloud(), beforeFailure)
    assert.deepEqual(await local(b), beforeRenewal)
    phone.controls.failRefresh(false)
    phone.expected.set('POST /api/skyanchor/session 401', 1)
    const cookieBeforeRecovery = (await contexts[1].cookies()).find(
      value => value.name === '__Host-skyanchor',
    )?.value
    await readingAction(b, 'Reconnect private sync')
    await expect
      .poll(
        async () =>
          (await contexts[1].cookies()).find(
            value => value.name === '__Host-skyanchor',
          )?.value,
      )
      .not.toBe(cookieBeforeRecovery)
    await expect(
      b.getByText(/Bluesky session renewal did not complete/),
    ).toHaveCount(0)
    await closeReadingPanel(b)
    // Install the clock only after renewal and its foreground checks are idle.
    await readingPanel(b)
    const checkButton = b.getByRole('button', {
      name: 'Check other device',
      exact: true,
    })
    await expect(checkButton).toBeEnabled()
    await b.clock.install()
    await b.clock.pauseAt(new Date((await b.evaluate(() => Date.now())) + 1000))
    const beforeHang = await savedBytes(b)
    const cloudBeforeHang = await cloud()
    const privateCookie = (await contexts[1].cookies()).find(
      value => value.name === '__Host-skyanchor',
    )
    assert.ok(privateCookie)
    const privateEvents = []
    let phase = 'armed'
    const privateRequest = request =>
      request.method() === 'GET' &&
      request.url() === origin + '/api/skyanchor/place'
    const onPrivateRequest = request => {
      if (privateRequest(request))
        privateEvents.push({event: 'request', phase, wallTime: Date.now()})
    }
    const onPrivateFailed = request => {
      if (privateRequest(request))
        privateEvents.push({
          event: 'failed',
          phase,
          wallTime: Date.now(),
          error: request.failure()?.errorText,
        })
    }
    b.on('request', onPrivateRequest)
    b.on('requestfailed', onPrivateFailed)
    const deadline = (report.foregroundDeadline = {events: privateEvents})
    const privateHold = holdApi('GET', {
      cookie: privateCookie.name + '=' + privateCookie.value,
      scenario: 'foreground-private-get-deadline',
    })
    try {
      phase = 'focus'
      deadline.startedPageTime = await b.evaluate(() => {
        if (document.visibilityState !== 'visible')
          throw new Error('Foreground deadline requires a visible phone')
        dispatchEvent(new Event('focus'))
        return Date.now()
      })
      await reached(privateHold, b)
      deadline.held = privateHold.request
      assert.equal(deadline.held.method, 'GET')
      assert.equal(deadline.held.path, '/api/skyanchor/place')
      assert.equal(deadline.held.status, 200)
      assert.equal(
        privateEvents.filter(event => event.event === 'request').length,
        1,
      )
      await expect(checkButton).toBeDisabled()
      deadline.manualCheckDisabled = true
      phase = 'before-deadline'
      await b.clock.fastForward(14999)
      await expect(checkButton).toBeDisabled()
      await expect(b.getByTestId('skyanchor-toolbar')).not.toContainText(
        'Private sync request timed out',
      )
      deadline.beforeDeadlinePageTime = await b.evaluate(() => Date.now())
      assert.equal(
        deadline.beforeDeadlinePageTime - deadline.startedPageTime,
        14999,
      )
      phase = 'deadline'
      await b.clock.fastForward(1)
      await expect(b.getByTestId('skyanchor-toolbar')).toContainText(
        'Private sync request timed out',
      )
      await expect(checkButton).toBeEnabled()
      await expect
        .poll(
          () => privateEvents.filter(event => event.event === 'failed').length,
        )
        .toBe(1)
      deadline.completedPageTime = await b.evaluate(() => Date.now())
      assert.equal(deadline.completedPageTime - deadline.startedPageTime, 15000)
      assert.equal(
        privateEvents.filter(event => event.event === 'request').length,
        1,
      )
      assert.deepEqual(await savedBytes(b), beforeHang)
      assert.deepEqual(await cloud(), cloudBeforeHang)
    } finally {
      privateHold.release()
      await b.clock.resume()
      b.off('request', onPrivateRequest)
      b.off('requestfailed', onPrivateFailed)
    }
    const recoveryResponse = b.waitForResponse(
      response =>
        privateRequest(response.request()) && response.status() === 200,
    )
    await expect(checkButton).toBeEnabled()
    await readingAction(b, 'Check other device')
    const recovered = await recoveryResponse
    deadline.recovery = {
      method: recovered.request().method(),
      path: new URL(recovered.url()).pathname,
      status: recovered.status(),
      wallTime: Date.now(),
    }
    await expect(checkButton).toBeEnabled()
    await expect(b.getByTestId('skyanchor-toolbar')).not.toContainText(
      'Private sync request timed out',
    )
    assert.deepEqual(await savedBytes(b), beforeHang)
    assert.deepEqual(await cloud(), cloudBeforeHang)
    deadline.explicitRecovery = true
    await expect(
      b.getByRole('button', {name: 'Reconnect private sync', exact: true}),
    ).toBeEnabled()
    const refreshPattern = '**/xrpc/com.atproto.server.refreshSession'
    let enterRefresh, releaseRefresh
    const refreshHold = {
      reached: new Promise(resolve => {
        enterRefresh = resolve
      }),
    }
    const refreshDone = new Promise(resolve => {
      releaseRefresh = resolve
    })
    const hangRefresh = async route => {
      if (route.request().method() !== 'POST') return route.fallback()
      enterRefresh()
      await refreshDone
      await route.abort('failed')
    }
    await contexts[1].route(refreshPattern, hangRefresh)
    try {
      phone.controls.expireAccess()
      phone.expected.set('POST /api/skyanchor/session 401', 1)
      await readingAction(b, 'Reconnect private sync')
      await reached(refreshHold, b)
      await b.clock.runFor(16000)
      await expect(b.getByTestId('skyanchor-toolbar')).toContainText(
        'Bluesky session renewal did not complete',
      )
      assert.deepEqual(await savedBytes(b), beforeHang)
      assert.deepEqual(await cloud(), cloudBeforeHang)
    } finally {
      releaseRefresh()
      await contexts[1].unroute(refreshPattern, hangRefresh)
      await b.clock.resume()
    }
    phone.expected.set('POST /api/skyanchor/session 401', 1)
    await readingAction(b, 'Reconnect private sync')
    await expect(
      b
        .getByTestId('skyanchor-toolbar')
        .getByText(/Bluesky session renewal did not complete/),
    ).toHaveCount(0)
    await closeReadingPanel(b)
    const malformedPath = origin + '/api/skyanchor/place'
    const malformed = route =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{"revision":0}',
          })
        : route.fallback()
    await contexts[1].route(malformedPath, malformed)
    try {
      await readingAction(b, 'Check other device')
      await expect(b.getByTestId('skyanchor-toolbar')).toContainText(
        'Invalid private sync response or account binding',
      )
      assert.deepEqual(await savedBytes(b), beforeHang)
      assert.deepEqual(await cloud(), cloudBeforeHang)
    } finally {
      await contexts[1].unroute(malformedPath, malformed)
    }
    await closeReadingPanel(b)
    const missingUri = JSON.parse(third.state).anchor.split('|')[0]
    contexts[1].fixture.controls.setTimeline(
      history.map(item =>
        item.post.uri === missingUri
          ? {
              ...item,
              post: {
                ...item.post,
                labels: [
                  {
                    src: 'did:plc:ar7c4by46qjdydhdevvrndac',
                    uri: missingUri,
                    val: '!hide',
                    cts: new Date().toISOString(),
                  },
                ],
              },
            }
          : item,
      ),
    )
    try {
      await offer(b)
      const beforeModeration = await savedBytes(b)
      await readingAction(b, 'Resume other device')
      await expect(b.getByTestId('skyanchor-resume-result')).toContainText(
        'excluded by current moderation',
      )
      assert.deepEqual(await savedBytes(b), beforeModeration)
      assert.deepEqual(await cloud(), cloudBeforeHang)
    } finally {
      contexts[1].fixture.controls.setTimeline(history)
    }
    deleted.add(missingUri)
    contexts[1].fixture.controls.setTimeline(
      history.filter(item => item.post.uri !== missingUri),
    )
    try {
      const before = await local(b)
      const checkpoint = await b.evaluate(
        did => localStorage.getItem('skyanchor:return:v1:' + did),
        did,
      )
      await offer(b)
      const allBefore = await savedBytes(b)
      await readingAction(b, 'Resume other device')
      await expect(b.getByTestId('skyanchor-resume-result')).toContainText(
        'Could not restore the exact saved occurrence',
      )
      assert.deepEqual(await savedBytes(b), allBefore)
      await readingPanel(b)
      await expect(
        b
          .getByTestId('skyanchor-toolbar')
          .getByText(/Could not restore the exact saved occurrence/),
      ).toBeVisible()
      await expect(
        b.getByRole('button', {name: 'Resume other device', exact: true}),
      ).toBeVisible()
      assert.deepEqual(await local(b), before)
      assert.equal(
        await b.evaluate(
          did => localStorage.getItem('skyanchor:return:v1:' + did),
          did,
        ),
        checkpoint,
      )
      assert.deepEqual(await cloud(), beforeFailure)
      await closeReadingPanel(b)
    } finally {
      deleted.delete(missingUri)
      contexts[1].fixture.controls.setTimeline(history)
    }
    for (const context of contexts)
      assert.ok(
        [...context.fixture.expected.values()].every(count => count === 0),
        'Every precisely expected failure must occur',
      )
    assert.deepEqual(failures, [])
    report.handoff = {
      devices: devices.length,
      revisions: [first.revision, second.revision, third.revision],
      placements: records,
      indicatorCases,
      regionalRefresh: true,
      directFirstUseDepth: 470,
      frozenOfferAndSourceRace: true,
      cancellationPreservesBytes: true,
      foregroundRequestDeadlines: true,
      persistedRegionalReload: true,
      errors: failures,
    }
    report.checks.push(
      'Three independent browser profiles (email entryway, WebKit regional handle, cold persisted regional desktop) hand off a deep exact repost/reply occurrence outside fresh windows through real D1 CAS. Offers never jump or write; expired access/cookie renewal and failure recovery preserve local state.',
    )
  } catch (error) {
    report.handoffFailure ??= await Promise.all(
      contexts
        .filter(context => context.fixture)
        .map(async context => ({
          ui: (await context.fixture.page.locator('body').innerText()).slice(
            -5000,
          ),
          readingLabel: await context.fixture.page
            .getByTestId('skyanchor-reading-button')
            .getAttribute('aria-label'),
          historyRequests: context.fixture.controls.timelineRequests,
        })),
    )
    throw error
  } finally {
    for (const context of contexts) await context.close()
  }
}
