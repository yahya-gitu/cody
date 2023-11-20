import * as vscode from 'vscode'

import { spawnBfg } from '../graph/bfg/spawn-bfg'
import { MessageHandler } from '../jsonrpc/jsonrpc'
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

export class LocalEmbeddingsController {
    constructor(private readonly service: MessageHandler) {}

    // TODO: Remove this
    public async hello(): Promise<void> {
        // TODO: Handle BFG death and reconnection
        void vscode.window.showInformationMessage(await this.service.request('e/echo', 'ping'))
    }

    public async load(repo_name: string): Promise<boolean> {
        return this.service.request('e/load', repo_name)
    }

    public async query(repo_name: string, query: string): Promise<string[]> {
        return this.service.request('e/query', query)
    }
}
