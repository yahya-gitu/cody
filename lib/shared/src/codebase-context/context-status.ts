// This should remain compatible with vscode.Disposable.
export interface Disposable {
    dispose(): void
}

// Provides a summary of context status and notifications when the status changes.
export interface ContextStatusProvider {
    onDidChangeStatus(callback: (provider: ContextStatusProvider) => void): Disposable
    get status(): ContextGroup[]
}

// Plain data types for describing context status. These are shared between
// the VScode webviews, the VScode extension, and cody-shared.

export type ContextProvider = LocalEmbeddingsProvider | SearchProvider

export interface RemoteSearchProvider {
    kind: 'search'
    type: 'remote'
    state: 'ready' | 'no-match'
    id: string
    // If 'manual' the user picked this context source manually. If 'auto' the
    // context source was included because the IDE detected the repo and
    // included it.
    inclusion: 'auto' | 'manual'
}

export interface LocalEmbeddingsProvider {
    kind: 'embeddings'
    state: 'indeterminate' | 'no-match' | 'unconsented' | 'indexing' | 'ready'
    errorReason?: 'not-a-git-repo' | 'git-repo-has-no-remote'
}

export type SearchProvider = LocalSearchProvider | RemoteSearchProvider

export interface LocalSearchProvider {
    kind: 'search'
    type: 'local'
    state: 'unindexed' | 'indexing' | 'ready' | 'failed'
}

export interface ContextGroup {
    name: string
    providers: ContextProvider[]
}

// TODO: rename to EnhancedContextStatusT
export interface EnhancedContextContextT {
    groups: ContextGroup[]
}
