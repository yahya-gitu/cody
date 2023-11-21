import * as vscode from 'vscode'

import { LocalEmbeddingsFetcher } from '@sourcegraph/cody-shared/src/local-context'
import { EmbeddingsSearchResult } from '@sourcegraph/cody-shared/src/sourcegraph-api/graphql/client'

import { spawnBfg } from '../graph/bfg/spawn-bfg'
import { MessageHandler } from '../jsonrpc/jsonrpc'
import { logDebug } from '../log'
import { captureException } from '../services/sentry/sentry'

export async function createLocalEmbeddingsController(
    context: vscode.ExtensionContext
): Promise<LocalEmbeddingsController> {
    // TODO(dpc): De-dup this with BfgRetrieval doSpawnBFG.
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

    private lastRepo: { name: string; loadResult: boolean } | undefined
    private lastAccessToken: string | undefined

    public setAccessToken(token: string): Promise<void> {
        if (token === this.lastAccessToken) {
            return Promise.resolve()
        }
        this.lastAccessToken = token
        return this.service.request('e/set-token', token)
    }

    public async load(repoName: string): Promise<boolean> {
        if (repoName === this.lastRepo?.name) {
            return Promise.resolve(this.lastRepo.loadResult)
        }
        this.lastRepo = {
            name: repoName,
            loadResult: await this.service.request('e/load', repoName),
        }
        return this.lastRepo.loadResult
    }

    public query(query: string): Promise<string> {
        return this.service.request('e/query', query)
    }

    // LocalEmbeddingsFetcher
    // TODO: Handle invalid access tokens
    public async getContext(query: string, _numResults: number): Promise<EmbeddingsSearchResult[]> {
        try {
            const result = await this.query(query)
            logDebug('LocalEmbeddingsController', result)
        } catch (error) {
            logDebug('LocalEmbeddingsController', 'query failed', error)
        }
        throw new Error('NYI LocalEmbeddingsController.getContext')
    }
}
