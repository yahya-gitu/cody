import { GraphQLAPIClientConfig, SourcegraphGraphQLAPIClient, isError, logDebug } from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'
import { getCodebaseFromWorkspaceUri } from '../repository/repositoryHelpers'

// Watches the VSCode workspace roots and maps any it finds to remote repository
// IDs.
export class WorkspaceRepoMapper implements vscode.Disposable {
    private readonly client: SourcegraphGraphQLAPIClient
    private changeEmitter = new vscode.EventEmitter<{name: string, id: string}[]>()
    private disposables: vscode.Disposable[] = [this.changeEmitter]
    private repos: {name: string, id: string}[] = []
    private started: Promise<void> | undefined

    constructor(config: GraphQLAPIClientConfig) {
        this.client = new SourcegraphGraphQLAPIClient(config)
    }

    public dispose(): void {
        vscode.Disposable.from(...this.disposables).dispose()
        this.disposables = []
    }

    public updateConfiguration(config: GraphQLAPIClientConfig): void {
        this.client.onConfigurationChange(config)
        if (this.started) {
            this.started.then(() => this.updateRepos())
        }
    }

    // Fetches the set of repo IDs and starts listening for workspace changes.
    // After this Promise resolves, `workspaceRepoIds` contains the set of
    // repo IDs for the workspace (if any.)
    public async start(): Promise<void> {
        // If are already starting/started, then join that.
        if (this.started) {
            return this.started
        }

        return this.started = (async () => {
            try {
                await this.updateRepos()
            } catch (error) {
                // Reset the started property so the next call to start will try again.
                this.started = undefined
                throw error
            }
            vscode.workspace.onDidChangeWorkspaceFolders(async () => await this.updateRepos(), undefined, this.disposables);
        })()
    }

    public get workspaceRepos(): {name: string, id: string}[] {
        return [...this.repos]
    }

    public get onChange(): vscode.Event<{name: string, id: string}[]> {
        return this.changeEmitter.event
    }

    // Updates the `workspaceRepos` property and fires the change event.
    private async updateRepos(): Promise<void> {
        try {
            this.repos = await this.findRepoIds(vscode.workspace.workspaceFolders || [])
        } catch (error) {
            logDebug('WorkspaceRepoMapper', 'Error mapping workspace folders to repo IDs: ' + error)
            throw error
        }
        this.changeEmitter.fire(this.workspaceRepos)
    }

    // Given a set of workspace folders, looks up their git remotes and finds the related repo IDs,
    // if any.
    private async findRepoIds(folders: readonly vscode.WorkspaceFolder[]): Promise<{name: string, id: string}[]> {
        const repoNameFolderMap = new Map(folders.flatMap(folder => {
            const codebase = getCodebaseFromWorkspaceUri(folder.uri)
            return codebase ? [[codebase, folder.uri.toString()]] : []
        }))
        const ids = await this.client.getRepoIds([...repoNameFolderMap.keys()], 10)
        if (isError(ids)) {
            throw ids
        }
        return ids
    }
}
