import * as vscode from 'vscode'

import { LocalEmbeddingsFetcher } from '@sourcegraph/cody-shared/src/local-context'
import { EmbeddingsSearchResult } from '@sourcegraph/cody-shared/src/sourcegraph-api/graphql/client'

import { spawnBfg } from '../graph/bfg/spawn-bfg'
import { QueryResultSet } from '../jsonrpc/embeddings-protocol'
import { MessageHandler } from '../jsonrpc/jsonrpc'
import { logDebug } from '../log'
import { captureException } from '../services/sentry/sentry'

export async function createLocalEmbeddingsController(
    context: vscode.ExtensionContext
): Promise<LocalEmbeddingsController> {
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
}

export class LocalEmbeddingsController implements LocalEmbeddingsFetcher {
    constructor(private readonly service: MessageHandler) {}

    private lastRepo: { path: string; loadResult: boolean } | undefined
    private lastAccessToken: string | undefined

    public setAccessToken(token: string): Promise<void> {
        if (token === this.lastAccessToken) {
            return Promise.resolve()
        }
        this.lastAccessToken = token
        return this.service.request('e/set-token', token)
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
            loadResult: await this.service.request('e/load', repoPath),
        }
        return this.lastRepo.loadResult
    }

    public query(query: string): Promise<QueryResultSet> {
        return this.service.request('e/query', query)
    }

    // LocalEmbeddingsFetcher
    public async getContext(query: string, _numResults: number): Promise<EmbeddingsSearchResult[]> {
        try {
            return (await this.query(query)).results
        } catch (error) {
            logDebug('LocalEmbeddingsController', 'query failed', error)
            throw error
        }
    }
}
