import * as vscode from 'vscode'

import { loadBFG } from '../graph/bfg/BfgContextFetcher'
import { MessageHandler } from '../jsonrpc/jsonrpc'

export async function createLocalEmbeddingsController(
    context: vscode.ExtensionContext
): Promise<LocalEmbeddingsController> {
    const bfg = await loadBFG(context)
    return new LocalEmbeddingsController(bfg)
}

export class LocalEmbeddingsController {
    constructor(private readonly bfg: MessageHandler) {}

    public async doStuff(): Promise<void> {
        // TODO: It is crap to have to pass explicit null when we don't want a parameter
        // TODO: Handle BFG death and reconnection
        void vscode.window.showInformationMessage(await this.bfg.request('embeddings/hello', null))
    }
}
