import { expect } from '@playwright/test'
import { describe, it } from 'vitest'
import * as vscode from 'vscode'

import * as view from '../../webviews/Components/EnhancedContextSettings'

import { ContextStatusAggregator, ContextStatusProvider } from './enhanced-context-status'

class TestProvider implements ContextStatusProvider {
    public emitter: vscode.EventEmitter<ContextStatusProvider> = new vscode.EventEmitter()

    public onDidChangeStatus(callback: (provider: ContextStatusProvider) => void): vscode.Disposable {
        return this.emitter.event(callback)
    }

    public get status(): view.ContextGroup[] {
        return [
            {
                name: 'github.com/foo/bar.git',
                providers: [
                    {
                        kind: 'embeddings',
                        type: 'local',
                        state: 'unconsented',
                    },
                ],
            },
        ]
    }
}

describe('ContextStatusAggregator', () => {
    it('should fire status changed when providers are added and pass through simple status', async () => {
        const aggregator = new ContextStatusAggregator()
        const promise = new Promise(resolve => {
            aggregator.onDidChangeStatus(provider => resolve(provider.status))
        })
        aggregator.addProvider(new TestProvider())
        expect(await promise).toEqual([
            {
                name: 'github.com/foo/bar.git',
                providers: [
                    {
                        kind: 'embeddings',
                        type: 'local',
                        state: 'unconsented',
                    },
                ],
            },
        ])
    })
})
