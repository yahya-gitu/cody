import * as vscode from 'vscode'

import {
    type ContextGroup,
    type ContextSearchResult,
    type ContextStatusProvider,
    type Disposable,
    type GraphQLAPIClientConfig,
    type SourcegraphGraphQLAPIClient,
} from '@sourcegraph/cody-shared'

import type * as repopicker from './repo-picker'

export enum RepoInclusion {
    Automatic = 'auto',
    Manual = 'manual',
}

interface Repo {
    displayName: string
}

export class RemoteSearch implements ContextStatusProvider {
    private statusChangedEmitter = new vscode.EventEmitter<ContextStatusProvider>()

    // Repositories we are including automatically because of the workspace.
    private reposAuto: Map<string, Repo> = new Map()

    // Repositories the user has added manually.
    private reposManual: Map<string, Repo> = new Map()

    constructor(private readonly client: SourcegraphGraphQLAPIClient) {}

    public dispose(): void {
        this.statusChangedEmitter.dispose()
    }

    // #region ContextStatusProvider implementation.

    public onDidChangeStatus(callback: (provider: ContextStatusProvider) => void): Disposable {
        return this.statusChangedEmitter.event(callback)
    }

    public get status(): ContextGroup[] {
        return [...this.getRepoIdSet()].map(id => {
            const auto = this.reposAuto.get(id)
            const manual = this.reposManual.get(id)
            const displayName = auto?.displayName || manual?.displayName || '?'
            return {
                displayName,
                providers: [
                    {
                        kind: 'search',
                        type: 'remote',
                        state: 'ready',
                        id,
                        inclusion: auto ? 'auto' : 'manual',
                    },
                ],
            }
        })
    }

    // #endregion

    public updateConfiguration(newConfig: GraphQLAPIClientConfig): void {
        this.client.onConfigurationChange(newConfig)
        // TODO: Work out whether the chat system reopens chats on account
        // change, and if not, whether we need to clear the repo set, inform the
        // user, etc.
    }

    // Sets the repos to search. RepoInclusion.Automatic is for repositories added
    // automatically based on the workspace; these are presented differently
    // and can't be removed by the user. RepoInclusion.Manual is for repositories
    // added manually by the user.
    public setRepos(repos: repopicker.Repo[], inclusion: RepoInclusion): void {
        const repoMap: Map<string, Repo> = new Map(
            repos.map(repo => [repo.id, { displayName: repo.name }])
        )
        const oldRepoSet = this.getRepoIdSet()
        let autoSetChanged = false
        switch (inclusion) {
            case RepoInclusion.Automatic: {
                autoSetChanged =
                    this.reposAuto.size !== repoMap.size ||
                    ![...this.reposAuto.keys()].every(key => repoMap.has(key))
                this.reposAuto = repoMap
                break
            }
            case RepoInclusion.Manual:
                this.reposManual = repoMap
                break
        }
        const newRepoSet = this.getRepoIdSet()
        if (
            autoSetChanged ||
            oldRepoSet.size !== newRepoSet.size ||
            ![...oldRepoSet.values()].every(value => newRepoSet.has(value))
        ) {
            this.statusChangedEmitter.fire(this)
        }
    }

    // Gets the set of all repositories to search.
    public getRepoIdSet(): Set<string> {
        return new Set([...this.reposAuto.keys(), ...this.reposManual.keys()])
    }

    public async query(query: string): Promise<ContextSearchResult[]> {
        const result = await this.client.contextSearch(this.getRepoIdSet(), query)
        if (result instanceof Error) {
            throw result
        }
        return result || []
    }
}
