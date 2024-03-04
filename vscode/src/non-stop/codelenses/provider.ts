import * as vscode from 'vscode'

import { clientSettings } from '../../client-settings'
import type { FixupFile } from '../FixupFile'
import type { FixupTask } from '../FixupTask'
import type { FixupFileCollection } from '../roles'
import { CodyTaskState } from '../utils'
import { ALL_ACTIONABLE_TASK_STATES } from './constants'
import { getLensesForTask } from './items'

export interface FixupControls {
    didUpdateTask(task: FixupTask): void
    didDeleteTask(task: FixupTask): void
    didChangeVisibleFixupEditors(editorsByFile: Map<FixupFile, readonly vscode.TextEditor[]>): void
    dispose(): void
}

export function createFixupControls(files: FixupFileCollection): FixupControls {
    switch (clientSettings().editControls) {
        case 'lenses':
            return new FixupCodeLenses(files)
        case 'client':
            return new ClientFixupControls()
    }
}

export class ClientFixupControls implements FixupControls {
    public didUpdateTask(task: FixupTask): void {}
    public didDeleteTask(task: FixupTask): void {}
    public didChangeVisibleFixupEditors(
        editorsByFile: Map<FixupFile, readonly vscode.TextEditor[]>
    ): void {}
    public dispose(): void {}
}

export class FixupCodeLenses implements vscode.CodeLensProvider, FixupControls {
    private taskLenses = new Map<FixupTask, vscode.CodeLens[]>()

    private _disposables: vscode.Disposable[] = []
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>()
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event

    /**
     * Create a code lens provider
     */
    constructor(private readonly files: FixupFileCollection) {
        this.provideCodeLenses = this.provideCodeLenses.bind(this)
        this._disposables.push(vscode.languages.registerCodeLensProvider('*', this))

        this._disposables.push(
            // TODO: Agent commands will also want to call these telemetry callbacks?
            // TODO: Decide whether we need TelemetryService or not:
            // slack: https://sourcegraph.slack.com/archives/C05B7C6FBPX/p1709547762296689?thread_ts=1709536155.802239&cid=C05B7C6FBPX
            vscode.commands.registerCommand('cody.fixup.codelens.cancel', id => {
                telemetryService.log('CodyVSCodeExtension:fixup:codeLens:clicked', {
                    op: 'cancel',
                    hasV2Event: true,
                })
                telemetryRecorder.recordEvent('cody.fixup.codeLens', 'cancel')
                return this.cancel(id)
            }),
            vscode.commands.registerCommand('cody.fixup.codelens.diff', id => {
                telemetryService.log('CodyVSCodeExtension:fixup:codeLens:clicked', {
                    op: 'diff',
                    hasV2Event: true,
                })
                telemetryRecorder.recordEvent('cody.fixup.codeLens', 'diff')
                return this.diff(id)
            }),
            vscode.commands.registerCommand('cody.fixup.codelens.retry', async id => {
                telemetryService.log('CodyVSCodeExtension:fixup:codeLens:clicked', {
                    op: 'regenerate',
                    hasV2Event: true,
                })
                telemetryRecorder.recordEvent('cody.fixup.codeLens', 'retry')
                return this.retry(id)
            }),
            vscode.commands.registerCommand('cody.fixup.codelens.undo', id => {
                telemetryService.log('CodyVSCodeExtension:fixup:codeLens:clicked', {
                    op: 'undo',
                    hasV2Event: true,
                })
                telemetryRecorder.recordEvent('cody.fixup.codeLens', 'undo')
                return this.undo(id)
            }),
            vscode.commands.registerCommand('cody.fixup.codelens.accept', id => {
                telemetryService.log('CodyVSCodeExtension:fixup:codeLens:clicked', {
                    op: 'accept',
                    hasV2Event: true,
                })
                telemetryRecorder.recordEvent('cody.fixup.codeLens', 'accept')
                return this.accept(id)
            }),
            vscode.commands.registerCommand('cody.fixup.codelens.error', id => {
                telemetryService.log('CodyVSCodeExtension:fixup:codeLens:clicked', {
                    op: 'show_error',
                    hasV2Event: true,
                })
                telemetryRecorder.recordEvent('cody.fixup.codeLens', 'showError')
                return this.showError(id)
            }),
            vscode.commands.registerCommand('cody.fixup.codelens.skip-formatting', id => {
                telemetryService.log('CodyVSCodeExtension:fixup:codeLens:clicked', {
                    op: 'skip_formatting',
                    hasV2Event: true,
                })
                telemetryRecorder.recordEvent('cody.fixup.codeLens', 'skipFormatting')
                return this.skipFormatting(id)
            }),
            vscode.commands.registerCommand('cody.fixup.cancelNearest', () => {
                const nearestTask = this.getNearestTask({ filter: { states: CANCELABLE_TASK_STATES } })
                if (!nearestTask) {
                    return
                }
                return vscode.commands.executeCommand('cody.fixup.codelens.cancel', nearestTask.id)
            }),
            vscode.commands.registerCommand('cody.fixup.acceptNearest', () => {
                const nearestTask = this.getNearestTask({ filter: { states: ACTIONABLE_TASK_STATES } })
                if (!nearestTask) {
                    return
                }
                return vscode.commands.executeCommand('cody.fixup.codelens.accept', nearestTask.id)
            }),
            vscode.commands.registerCommand('cody.fixup.retryNearest', () => {
                const nearestTask = this.getNearestTask({ filter: { states: ACTIONABLE_TASK_STATES } })
                if (!nearestTask) {
                    return
                }
                return vscode.commands.executeCommand('cody.fixup.codelens.retry', nearestTask.id)
            }),
            vscode.commands.registerCommand('cody.fixup.undoNearest', () => {
                const nearestTask = this.getNearestTask({ filter: { states: ACTIONABLE_TASK_STATES } })
                if (!nearestTask) {
                    return
                }
                return vscode.commands.executeCommand('cody.fixup.codelens.undo', nearestTask.id)
            })
        )
    }

    /**
     * Gets the code lenses for the specified document.
     */
    public provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const file = this.files.maybeFileForUri(document.uri)
        if (!file) {
            return []
        }
        const lenses = []
        for (const task of this.files.tasksForFile(file)) {
            lenses.push(...(this.taskLenses.get(task) || []))
        }
        return lenses
    }

    public didUpdateTask(task: FixupTask): void {
        this.updateKeyboardShortcutEnablement([task.fixupFile])
        if (task.state === CodyTaskState.finished) {
            this.removeLensesFor(task)
            return
        }
        this.taskLenses.set(task, getLensesForTask(task))
        this.notifyCodeLensesChanged()
    }

    public didDeleteTask(task: FixupTask): void {
        this.updateKeyboardShortcutEnablement([task.fixupFile])
        this.removeLensesFor(task)
    }

    private removeLensesFor(task: FixupTask): void {
        if (this.taskLenses.delete(task)) {
            // TODO: Clean up the fixup file when there are no remaining code lenses
            this.notifyCodeLensesChanged()
        }
    }

    public didChangeVisibleFixupEditors(
        editorsByFile: Map<FixupFile, readonly vscode.TextEditor[]>
    ): void {
        this.updateKeyboardShortcutEnablement([...editorsByFile.keys()])
    }

    /**
     * For a set of active files, check to see if any tasks within these files are currently actionable.
     * If they are, enable the code lens keyboard shortcuts in the editor.
     */
    private updateKeyboardShortcutEnablement(activeFiles: readonly FixupFile[]): void {
        const allTasks = activeFiles
            .filter(file =>
                vscode.window.visibleTextEditors.some(editor => editor.document.uri === file.uri)
            )
            .flatMap(file => this.files.tasksForFile(file))

        const hasActionableEdit = allTasks.some(task => ALL_ACTIONABLE_TASK_STATES.includes(task.state))
        void vscode.commands.executeCommand('setContext', 'cody.hasActionableEdit', hasActionableEdit)
    }

    private notifyCodeLensesChanged(): void {
        this._onDidChangeCodeLenses.fire()
    }

    /**
     * Dispose the disposables
     */
    public dispose(): void {
        this.taskLenses.clear()
        for (const disposable of this._disposables) {
            disposable.dispose()
        }
        this._disposables = []
    }
}
