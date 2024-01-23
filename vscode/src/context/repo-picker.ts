import * as vscode from 'vscode'

import { SourcegraphGraphQLAPIClient, type GraphQLAPIClientConfig } from '@sourcegraph/cody-shared'

import { logDebug } from '../log'
import { RemoteSearch } from './remote-search'
import { WorkspaceRepoMapper } from './workspace-repo-mapper'

export interface Repo {
    name: string
    id: string
}

enum RepoFetcherState {
    Paused,
    Fetching,
    Errored,
    Complete,
}

// RepoFetcher
// - Fetches repositories from a Sourcegraph instance.
// - Notifies a listener when the set of repositories has changed.
class RepoFetcher implements vscode.Disposable {
    private state_: RepoFetcherState = RepoFetcherState.Paused
    private readonly stateChangedEmitter = new vscode.EventEmitter<RepoFetcherState>()
    public readonly onStateChanged = this.stateChangedEmitter.event

    private readonly repoListChangedEmitter = new vscode.EventEmitter<Repo[]>()
    public readonly onRepoListChanged = this.repoListChangedEmitter.event

    private error_: Error | undefined

    // The cursor at the end of the last fetched repositories.
    private after: string | undefined
    private repos: Repo[] = []

    constructor(private client: SourcegraphGraphQLAPIClient) {}

    public dispose(): void {
        this.repoListChangedEmitter.dispose()
        this.stateChangedEmitter.dispose()
    }

    public get lastError(): Error | undefined {
        return this.error_
    }

    public updateConfiguration(config: GraphQLAPIClientConfig): void {
        this.client = new SourcegraphGraphQLAPIClient(config)
        this.repos = []
        this.after = undefined
        this.state = RepoFetcherState.Paused
    }

    public pause(): void {
        this.state = RepoFetcherState.Paused
    }

    public resume(): void {
        this.state = RepoFetcherState.Fetching
        void this.fetch()
    }

    // Gets the known repositories. The set may be incomplete if fetching hasn't
    // finished, the cache is stale, etc.
    public get repositories(): readonly Repo[] {
        return this.repos
    }

    public get state(): RepoFetcherState {
        return this.state_
    }

    private set state(newState: RepoFetcherState) {
        if (this.state === newState) {
            return
        }
        this.state_ = newState
        this.stateChangedEmitter.fire(newState)
    }

    private async fetch(): Promise<void> {
        // DONOTCOMMIT: Increase this and remove the timeout.
        const numResultsPerQuery = 100
        const client = this.client
        if (this.state === RepoFetcherState.Paused) {
            return
        }
        do {
            const result = await client.getRepoList(numResultsPerQuery, this.after)
            if (this.client !== client) {
                // The configuration changed during this fetch, so stop.
                return
            }
            if (result instanceof Error) {
                this.state = RepoFetcherState.Errored
                this.error_ = result
                logDebug('RepoFetcher', result.toString())
                return
            }
            const newRepos = result.repositories.nodes
            this.repos.push(...newRepos)
            this.repoListChangedEmitter.fire(this.repos)
            this.after = result.repositories.pageInfo.endCursor || undefined

            // DONOTCOMMIT remove this artificial delay
            await new Promise(resolve => setTimeout(resolve, 3000))
        } while (this.state === RepoFetcherState.Fetching && this.after)

        if (!this.after) {
            this.state = RepoFetcherState.Complete
        }
    }
}

/**
 * A quickpick for choosing a set of repositories from a Sourcegraph instance.
 */
export class RemoteRepoPicker implements vscode.Disposable {
    private readonly maxSelectedRepoCount: number = RemoteSearch.MAX_REPO_COUNT - 1
    private disposables: vscode.Disposable[] = []
    private readonly quickpick: vscode.QuickPick<vscode.QuickPickItem & Repo>
    private readonly fetcher: RepoFetcher
    private readonly workspaceRepoMapper: WorkspaceRepoMapper

    constructor(config: GraphQLAPIClientConfig) {
        this.fetcher = new RepoFetcher(new SourcegraphGraphQLAPIClient(config))
        this.fetcher.onRepoListChanged(() => this.handleRepoListChanged(), undefined, this.disposables)
        this.fetcher.onStateChanged(
            state => {
                this.quickpick.busy = state === RepoFetcherState.Fetching
                if (state === RepoFetcherState.Errored) {
                    void vscode.window.showErrorMessage(
                        `Failed to fetch repository list: ${this.fetcher.lastError?.message}`
                    )
                }
            },
            undefined,
            this.disposables
        )

        this.workspaceRepoMapper = new WorkspaceRepoMapper(config)
        void this.workspaceRepoMapper.start()
        this.workspaceRepoMapper.onChange(() => this.handleRepoListChanged(), undefined, this.disposables)

        this.quickpick = vscode.window.createQuickPick<vscode.QuickPickItem & Repo>()
        this.updateTitle()
        this.quickpick.canSelectMany = true

        this.quickpick.onDidChangeSelection(
            selection => {
                if (selection.length === this.maxSelectedRepoCount + 1) {
                    void vscode.window.showWarningMessage(
                        `You can only select up to ${this.maxSelectedRepoCount} repositories.`
                    )
                }
                this.updateTitle()
            },
            undefined,
            this.disposables
        )
    }

    public dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose()
        }
        this.fetcher.dispose()
        this.quickpick.dispose()
    }

    private updateTitle(): void {
        const remaining = this.maxSelectedRepoCount - this.quickpick.selectedItems.length
        this.quickpick.placeholder = remaining === 0 ? 'Click OK to continue' : 'Type to search repositories...'
        if (remaining === 0) {
            this.quickpick.title = '✅ Choose repositories'
        } else if (remaining === 1) {
            this.quickpick.title = `✨ Choose the last repository`
        } else if (remaining > 0) {
            this.quickpick.title = `Choose up to ${remaining} more repositories`
        } else {
            this.quickpick.title = `❌ Too many repositories selected: Uncheck ${-remaining} to continue`
        }
    }

    public updateConfiguration(config: GraphQLAPIClientConfig): void {
        this.fetcher.updateConfiguration(config)
        this.workspaceRepoMapper.updateConfiguration(config)
    }

    /**
     * Shows the remote repo picker. Resolves with `undefined` if the user
     * dismissed the dialog with ESC, a click away, etc.
     */
    public show(): Promise<Repo[] | undefined> {
        logDebug('RepoPicker', 'showing; fetcher state =', this.fetcher.state)
        let onDone = { resolve: (_: Repo[] | undefined) => {}, reject: (error: Error) => {} }
        const promise = new Promise<Repo[] | undefined>((resolve, reject) => {
            onDone = { resolve, reject }
        })

        this.quickpick.selectedItems = []
        this.handleRepoListChanged()

        // Refresh the repo list.
        if (this.fetcher.state !== RepoFetcherState.Complete) {
            logDebug('RepoPicker', 'continuing to fetch repositories list')
            this.fetcher.resume()
        }

        // Stop fetching repositories when the quickpick is dismissed.
        const didHide = this.quickpick.onDidHide(() => {
            if (this.fetcher.state !== RepoFetcherState.Complete) {
                logDebug('RepoPicker', 'pausing repo list fetching on hide')
                this.fetcher.pause()
            }
            onDone.resolve(undefined)
        })
        void promise.finally(() => didHide.dispose())

        const didAccept = this.quickpick.onDidAccept(() => {
            if (this.quickpick.selectedItems.length > this.maxSelectedRepoCount) {
                void vscode.window.showWarningMessage(
                    `You can only select up to ${this.maxSelectedRepoCount} repositories.`
                )
                return
            }
            onDone.resolve(this.quickpick.selectedItems.map(item => ({ name: item.name, id: item.id })))
            this.quickpick.hide()
        })
        void promise.finally(() => didAccept.dispose())

        // Show the quickpick
        this.quickpick.show()

        return promise
    }

    private handleRepoListChanged(): void {
        const selected = new Set<string>(this.quickpick.selectedItems.map(item => item.id))

        const workspaceRepos = new Set<string>(this.workspaceRepoMapper.workspaceRepos.map(item => item.id))

        const selectedItems: (vscode.QuickPickItem & Repo)[] = []
        const workspaceItems: (vscode.QuickPickItem & Repo)[] = []
        const items: (vscode.QuickPickItem & Repo)[] = []

        for (const repo of this.fetcher.repositories) {
            const inWorkspace = workspaceRepos.has(repo.id)
            const item = {
                label: repo.name,
                name: repo.name,
                id: repo.id,
                description: inWorkspace ? 'In your workspace' : undefined,
            }
            if (inWorkspace) {
                workspaceItems.push(item)
            } else {
                items.push(item)
            }
            if (selected.has(repo.id)) {
                selectedItems.push(item)
            }
        }

        this.quickpick.items = [{
            kind: vscode.QuickPickItemKind.Separator,
            label: 'Repositories in your workspace',
            name: 'SEPARATOR',
            id: 'SEPARATOR',
        }, ...workspaceItems, {
            kind: vscode.QuickPickItemKind.Separator,
            label: 'Other repositories on your Sourcegraph instance',
            name: 'SEPARATOR',
            id: 'SEPARATOR',
        }, ...items]
        this.quickpick.selectedItems = selectedItems
    }
}
