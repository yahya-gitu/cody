import * as vscode from 'vscode'

import { SourcegraphGraphQLAPIClient } from '@sourcegraph/cody-shared/src/sourcegraph-api/graphql'
import { type GraphQLAPIClientConfig } from '@sourcegraph/cody-shared/src/sourcegraph-api/graphql/client'

import { logDebug } from '../log'

interface Repo {
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
// - TODO: Caches fetched repositories.
// - TODO: Updates the cached repositories.
// - Notifies a listener when the set of repositories has changed.
class RepoFetcher implements vscode.Disposable {
    private state_: RepoFetcherState = RepoFetcherState.Paused
    private readonly stateChangedEmitter = new vscode.EventEmitter<RepoFetcherState>()
    public readonly onStateChanged = this.stateChangedEmitter.event

    private readonly repoListChangedEmitter = new vscode.EventEmitter<Repo[]>()
    public readonly onRepoListChanged = this.repoListChangedEmitter.event

    // The cursor at the end of the last fetched repositories.
    private after: string | undefined
    private repos: Repo[] = []

    constructor(private client: SourcegraphGraphQLAPIClient) {}

    public dispose(): void {
        this.repoListChangedEmitter.dispose()
        this.stateChangedEmitter.dispose()
    }

    public updateConfiguration(config: GraphQLAPIClientConfig): void {
        this.client = new SourcegraphGraphQLAPIClient(config)
        // TODO: Load cached repos, if any, instead of fetching from scratch.
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
        const numResultsPerQuery = 10_000
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
                logDebug('RepoFetcher', result.toString())
                return
            }
            const newRepos = result.repositories.nodes
            this.repos.push(...newRepos)
            this.repoListChangedEmitter.fire(this.repos)
            this.after = result.repositories.pageInfo.endCursor || undefined
        } while (this.state === RepoFetcherState.Fetching && this.after)

        this.state = RepoFetcherState.Complete
    }
}

// TODO:
// - Cache fetched repositories in the profile.
// - Display recently used repositories first.
// - Refresh cached repositories.
// - Clear cached repositories on logout.

// Repo cache:
// - Endpoint and user
// - Repositories
// - Last fetched item cursor

/**
 * A quickpick for choosing a set of repositories from a Sourcegraph instance.
 */
export class RemoteRepoPicker implements vscode.Disposable {
    private disposables: vscode.Disposable[] = []
    private readonly quickpick: vscode.QuickPick<vscode.QuickPickItem & Repo>
    private readonly fetcher: RepoFetcher
    private selected: Set<string> = new Set()

    constructor(config: GraphQLAPIClientConfig) {
        this.fetcher = new RepoFetcher(new SourcegraphGraphQLAPIClient(config))
        this.fetcher.onRepoListChanged(() => this.handleRepoListChanged(), undefined, this.disposables)
        this.fetcher.onStateChanged(
            state => {
                this.quickpick.busy = state === RepoFetcherState.Fetching
                // TODO: Show error messages.
            },
            undefined,
            this.disposables
        )

        this.quickpick = vscode.window.createQuickPick<vscode.QuickPickItem & Repo>()
        this.quickpick.placeholder = 'Choose up to 9 repositories'
        this.quickpick.canSelectMany = true

        this.quickpick.onDidChangeSelection(
            selection => {
                this.selected = new Set(selection.map(item => item.id))
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

    public updateConfiguration(config: GraphQLAPIClientConfig): void {
        this.fetcher.updateConfiguration(config)
    }

    /**
     * Shows the remote repo picker.
     */
    public show(): Promise<readonly Repo[]> {
        let onDone = { resolve: (_: readonly Repo[]) => {}, reject: (error: Error) => {} }
        const promise = new Promise<readonly Repo[]>((resolve, reject) => {
            onDone = { resolve, reject }
        })

        this.quickpick.selectedItems = []
        this.selected = new Set()
        this.handleRepoListChanged()

        // Refresh the repo list.
        if (this.fetcher.state !== RepoFetcherState.Complete) {
            this.fetcher.resume()
        }

        // Stop fetching repositories when the quickpick is dismissed.
        const didHide = this.quickpick.onDidHide(() => {
            if (this.fetcher.state !== RepoFetcherState.Complete) {
                this.fetcher.pause()
            }
        })
        void promise.then(() => didHide.dispose())

        this.quickpick.onDidAccept(() => {
            onDone.resolve(this.quickpick.selectedItems.map(item => ({ name: item.name, id: item.id })))
        })

        // Show the quickpick
        this.quickpick.show()

        return promise
    }

    private handleRepoListChanged(): void {
        this.quickpick.items = this.fetcher.repositories.map(repo => {
            return {
                label: repo.name,
                name: repo.name,
                id: repo.id,
                selected: this.selected.has(repo.id),
            }
        })
    }
}
