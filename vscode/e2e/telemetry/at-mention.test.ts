import { fixture as test, uix } from '../utils/vscody'
import { MITM_AUTH_TOKEN_PLACEHOLDER } from '../utils/vscody/constants'
import { expect } from '../utils/vscody/uix'
import { modifySettings } from '../utils/vscody/uix/workspace'

test.describe('cody.at-mention', () => {
    test.use({
        templateWorkspaceDir: 'test/fixtures/legacy-polyglot-template',
    })
    test('`/execute` should not fire pre-maturely', async ({
        page,
        mitmProxy,
        vscodeUI,
        polly,
        workspaceDir,
        telemetryRecorder,
    }, testInfo) => {
        // Behavior is described here:
        // https://linear.app/sourcegraph/issue/CODY-3405/fix-mention-telemetry

        const session = uix.vscode.Session.pending({ page, vscodeUI, workspaceDir })
        const cody = uix.cody.Extension.with({ page, workspaceDir })

        await test.step('setup', async () => {
            await modifySettings(
                s => ({
                    ...s,
                    'cody.accessToken': MITM_AUTH_TOKEN_PLACEHOLDER,
                    'cody.serverEndpoint': mitmProxy.sourcegraph.dotcom.endpoint,
                }),
                { workspaceDir }
            )
            await session.start()
            await cody.waitUntilReady()
            await session.editor.openFile({
                workspaceFile: 'buzz.ts',
                selection: { start: { line: 3 }, end: { line: 5 } },
            })
        })

        const telemetry = uix.telemetry.TelemetrySnapshot.fromNow({
            telemetryRecorder,
        })
        await session.runCommand('cody.chat.newEditorPanel')
        const [chat] = await uix.cody.WebView.all(session, { atLeast: 1 })
        await chat.waitUntilReady()

        //TODO: make a nice UIX class for this
        const chatInput = chat.content.getByRole('textbox', { name: 'Chat message' })
        await expect(chatInput).toBeVisible()

        const initTelemetry = telemetry.snap()
        // We don't want to have any at mention events triggered by default.
        // They should only trigger if we actually show the mention-menu. we
        expect(
            initTelemetry.filter({ matching: { feature: 'cody.at-mention', action: 'selected' } })
        ).toEqual([])

        const atMenu = chat.content.locator('[data-at-mention-menu]')

        // We fill the query a few times to make sure we don't see double firings
        await test.step('Trigger and fill at-menu', async () => {
            await chatInput.fill('@')
            await expect(atMenu).toBeVisible()
            await atMenu.locator('[data-value="provider:file"]').click()
            await expect(
                atMenu.locator('[data-value^="[\\"file\\""]').locator('[title="buzz.ts"]')
            ).toBeVisible()
            await chatInput.pressSequentially('error', { delay: 5 })
            await expect(
                atMenu.locator('[data-value^="[\\"file\\""]').locator('[title="error.ts"]')
            ).toBeVisible()
            for (let i = 0; i < 'error'.length; i++) {
                await chatInput.press('Backspace')
            }
        })

        const selectTelemetry = telemetry.snap(initTelemetry)
        expect(
            selectTelemetry.filter({ matching: { action: 'executed' } }),
            'Execution events should not have fired'
        ).toEqual([])
        const mentionEvents = selectTelemetry.filter({
            matching: { feature: 'cody.at-mention' },
        })
        await expect(mentionEvents).toMatchJSONSnapshot('mentionedEvents', {
            normalizers: snapshotNormalizers,
        })

        // we now ensure that the event did fire if we do select a file
        await atMenu.locator('[data-value^="[\\"file\\""]').locator('[title="buzz.ts"]').click()
        await expect(atMenu).not.toBeVisible()
        await chatInput.press('Enter')

        const executeTelemetry = telemetry.snap(selectTelemetry)
        expect(executeTelemetry.events).toEqual([])

        // wait until the response is displayed
        await expect(chat.content.locator('[data-testid="message"]').nth(2)).toBeVisible()

        const responseRecievedTelemetry = telemetry.snap(executeTelemetry)
        await expect(
            responseRecievedTelemetry.filter({
                matching: [{ feature: 'cody.chatResponse' }, { feature: 'cody.chat-question' }],
            })
        ).toMatchJSONSnapshot('responseRecievedEvents', {
            normalizers: snapshotNormalizers,
        })
    })
})

const snapshotNormalizers = [
    uix.snapshot.Normalizers.pick('event', 'proxyName'),
    uix.snapshot.Normalizers.sortKeysDeep,
    uix.snapshot.Normalizers.sortPathBy('event.parameters.metadata', 'key'),
    uix.snapshot.Normalizers.blank(
        'event.source.clientVersion',
        'event.timestamp',
        'event.parameters.privateMetadata.requestID',
        'event.parameters.interactionID',
        'event.parameters.privateMetadata.sessionID',
        'event.parameters.privateMetadata.traceId',
        'event.parameters.privateMetadata.chatModel',
        'event.parameters.privateMetadata.gitMetadata'
    ),
]
