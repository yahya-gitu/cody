import * as vscode from 'vscode'

import { ContextGroup } from '../../webviews/Components/EnhancedContextSettings'

export interface ContextStatusProvider {
    onDidChangeStatus: (callback: (sender: ContextStatusProvider) => void) => void
    get status(): ContextGroup[]
}

// Collects context status from a set of ContextStatusProviders and publishes
// them to a webview.
export class ContextStatusPublisher implements vscode.Disposable {
    private static TAG = 'ContextStatusPublisher'

    private providers: ContextStatusProvider[] = []
    private providerStatusMap: Map<ContextStatusProvider, ContextGroup[]> | undefined = new Map()

    public addProvider(provider: ContextStatusProvider): void {
        if (this.providerStatusMap === undefined) {
            throw new Error('ContextStatusPublisher has been disposed')
        }
        this.providers.push(provider)
        provider.onDidChangeStatus(provider => this.onDidChangeStatus(provider))
        this.providerStatusMap.set(provider, provider.status)
    }

    public removeProvider(provider: ContextStatusProvider): void {
        const i = this.providers.findIndex(item => item === provider)
        if (i !== -1) {
            this.providers.splice(i, 1)
        }
        this.providerStatusMap?.delete(provider)
    }

    public onDidChangeStatus(provider: ContextStatusProvider): void {
        if (this.providerStatusMap === undefined) {
            return
        }
        if (!this.providerStatusMap.has(provider)) {
            return
        }
        this.providerStatusMap.set(provider, provider.status)
        // TODO: De-bounce updates; push the status change to the webview.
    }

    public dispose(): void {
        this.providerStatusMap = undefined
    }

    public get status(): ContextGroup[] {
        if (this.providerStatusMap === undefined) {
            throw new Error('ContextStatusPublisher has been disposed')
        }
        // Iterate through provider status map entries
        // Collect context groups by name
        // Order sources within the groups by a canonical order
        return []
    }
}
