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

    private lastRepo: string | undefined
    private lastAccessToken: string | undefined

    public setAccessToken(token: string): Promise<void> {
        if (token === this.lastAccessToken) {
            return Promise.resolve()
        }
        this.lastAccessToken = token
        return this.service.request('e/set-token', token)
    }

    public load(repoName: string): Promise<boolean> {
        if (repoName === this.lastRepo) {
            // TODO(dpc): Cache the actual return value
            return Promise.resolve(true)
        }
        this.lastRepo = repoName
        return this.service.request('e/load', repoName)
    }

    public query(query: string): Promise<string> {
        return this.service.request('e/query', query)
    }

    // LocalEmbeddingsFetcher
    // TODO: Handle invalid access tokens
    public async getContext(query: string, _numResults: number): Promise<EmbeddingsSearchResult[]> {
        const result = await this.query(query)
        logDebug('LocalEmbeddingsController', result)
        throw new Error('NYI LocalEmbeddingsController.getContext')
    }
}
