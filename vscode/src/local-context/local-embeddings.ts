import * as vscode from 'vscode'

import { LocalEmbeddingsFetcher } from '@sourcegraph/cody-shared/src/local-context'
import { EmbeddingsSearchResult } from '@sourcegraph/cody-shared/src/sourcegraph-api/graphql/client'

import { spawnBfg } from '../graph/bfg/spawn-bfg'
import { QueryResultSet } from '../jsonrpc/embeddings-protocol'
import { MessageHandler } from '../jsonrpc/jsonrpc'
import { logDebug } from '../log'
import { captureException } from '../services/sentry/sentry'

// TODO(dpc): Until PR1717 lands, use this global controller; after it lands,
// split the controller up into a shared part and a per-client part.
let globalLocalEmbeddingsController: Promise<LocalEmbeddingsController> | undefined

export async function createLocalEmbeddingsController(
    context: vscode.ExtensionContext
): Promise<LocalEmbeddingsController> {
    if (globalLocalEmbeddingsController) {
        return globalLocalEmbeddingsController
    }
    globalLocalEmbeddingsController = (async () => {
        const service = await new Promise<MessageHandler>((resolve, reject) => {
            spawnBfg(context, reject).then(
                bfg => resolve(bfg),
                error => {
                    captureException(error)
                    reject(error)
                }
            )
        })
        return new LocalEmbeddingsController(service)
    })()
    return globalLocalEmbeddingsController
}

export class LocalEmbeddingsController implements LocalEmbeddingsFetcher {
    constructor(private readonly service: MessageHandler) {
        service.registerNotification('embeddings/progress', obj => {
            logDebug('LocalEmbeddingsController', JSON.stringify(obj))
            void vscode.window.showInformationMessage(JSON.stringify(obj))
        })
    }

    private lastRepo: { path: string; loadResult: boolean } | undefined
    private lastAccessToken: string | undefined

    public setAccessToken(token: string): Promise<void> {
        if (token === this.lastAccessToken) {
            return Promise.resolve()
        }
        this.lastAccessToken = token
        return this.service.request('embeddings/set-token', token)
    }

    public async index(): Promise<void> {
        if (!this.lastRepo?.path || this.lastRepo?.loadResult) {
            logDebug('LocalEmbeddingsController', 'No repository to index')
            return
        }
        const repoPath = this.lastRepo.path
        logDebug('Indexing repository', repoPath)
        try {
            await this.service.request('embeddings/index', { path: repoPath, model: 'stub/stub', dimension: 1536 })
        } catch (error) {
            logDebug('LocalEmbeddingsController', captureException(error))
        }
    }

    public async load(repoPath: string | undefined): Promise<boolean> {
        if (!repoPath) {
            return Promise.resolve(false)
        }
        if (repoPath === this.lastRepo?.path) {
            return Promise.resolve(this.lastRepo.loadResult)
        }
        this.lastRepo = {
            path: repoPath,
            loadResult: await this.service.request('embeddings/load', repoPath),
        }
        return this.lastRepo.loadResult
    }

    public query(query: string): Promise<QueryResultSet> {
        return this.service.request('embeddings/query', query)
    }

    // LocalEmbeddingsFetcher
    public async getContext(query: string, _numResults: number): Promise<EmbeddingsSearchResult[]> {
        try {
            const results = (await this.query(query)).results
            logDebug('LocalEmbeddingsController', 'returning {results.len} results')
            return results
        } catch (error) {
            logDebug('LocalEmbeddingsController', captureException(error))
            return []
        }
    }
}
