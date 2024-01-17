import * as React from 'react'

import { VSCodeButton, VSCodeCheckbox } from '@vscode/webview-ui-toolkit/react'
import classNames from 'classnames'

import {
    type ContextGroup,
    type ContextProvider,
    type EnhancedContextContextT,
    type LocalEmbeddingsProvider,
    type LocalSearchProvider,
    type RemoteSearchProvider,
} from '@sourcegraph/cody-shared/src/codebase-context/context-status'

import { PopupFrame } from '../Popups/Popup'
import { getVSCodeAPI } from '../utils/VSCodeApi'

import popupStyles from '../Popups/Popup.module.css'
import styles from './EnhancedContextSettings.module.css'

export enum EnhancedContextPresentationMode {
    // An expansive display with heterogenous providers grouped by source.
    Consumer = 'consumer',
    // A compact display with remote search providers over a list of sources.
    Enterprise = 'enterprise',
}

interface EnhancedContextSettingsProps {
    presentationMode: 'consumer' | 'enterprise'
    isOpen: boolean
    setOpen: (open: boolean) => void
}

function defaultEnhancedContextContext(): EnhancedContextContextT {
    return {
        groups: [],
    }
}

export const EnhancedContextContext: React.Context<EnhancedContextContextT> = React.createContext(
    defaultEnhancedContextContext()
)

export const EnhancedContextEnabled: React.Context<boolean> = React.createContext(true)

export const EnhancedContextEventHandlers: React.Context<EnhancedContextEventHandlersT> = React.createContext({
    onAddRemoteSearchRepo: (): void => {},
    onConsentToEmbeddings: (_): void => {},
    onEnabledChange: (_): void => {},
    onRemoveRemoteSearchRepo: (_): void => {},
    onShouldBuildSymfIndex: (_): void => {},
})

export interface EnhancedContextEventHandlersT {
    onAddRemoteSearchRepo: () => void
    onConsentToEmbeddings: (provider: LocalEmbeddingsProvider) => void
    onEnabledChange: (enabled: boolean) => void
    onRemoveRemoteSearchRepo: (id: string) => void
    onShouldBuildSymfIndex: (provider: LocalSearchProvider) => void
}

function useEnhancedContextContext(): EnhancedContextContextT {
    return React.useContext(EnhancedContextContext)
}

export function useEnhancedContextEnabled(): boolean {
    return React.useContext(EnhancedContextEnabled)
}

function useEnhancedContextEventHandlers(): EnhancedContextEventHandlersT {
    return React.useContext(EnhancedContextEventHandlers)
}

const CompactGroupsComponent: React.FunctionComponent<{
    groups: readonly ContextGroup[]
    handleAdd: () => void
    handleRemove: (id: string) => void
}> = ({ groups, handleAdd, handleRemove }): React.ReactNode => {
    // The compact groups component is only used for enterprise context, which
    // uses homogeneous remote search providers. Lift the providers out of the
    // groups.
    const liftedProviders: [string, RemoteSearchProvider][] = []
    for (const group of groups) {
        const providers = group.providers.filter(
            (provider: ContextProvider): provider is RemoteSearchProvider =>
                provider.kind === 'search' && provider.type === 'remote'
        )
        console.assert(
            providers.length !== group.providers.length,
            'enterprise context should only use remote search providers'
        )
        if (providers.length) {
            liftedProviders.push([group.name, providers[0]])
        }
    }

    // Sort the providers so automatically included ones appear first, then sort
    // by name.
    liftedProviders.sort((a, b) => {
        if (a[1].inclusion === 'auto' && b[1].inclusion !== 'auto') {
            return -1
        }
        if (b[1].inclusion === 'auto') {
            return 1
        }
        return a[0].localeCompare(b[0])
    })

    return (
        <>
            <dt title="Repositories" className={styles.lineBreakAll}>
                Repositories
            </dt>
            <dd>
                <ol className={styles.providersList}>
                    {liftedProviders.map(([group, provider]) => (
                        <CompactProviderComponent
                            key={provider.id}
                            id={provider.id}
                            name={group}
                            inclusion={provider.inclusion}
                            handleRemove={handleRemove}
                        />
                    ))}
                    <li>
                        <VSCodeButton onClick={() => handleAdd()}>Add Repositories&hellip;</VSCodeButton>
                    </li>
                </ol>
            </dd>
        </>
    )
}

const CompactProviderComponent: React.FunctionComponent<{
    id: string
    name: string
    inclusion: 'auto' | 'manual'
    handleRemove: (id: string) => void
}> = ({ id, name, inclusion, handleRemove }): React.ReactNode => (
    <li>
        <i className="codicon codicon-repo-forked" /> {name}{' '}
        {inclusion === 'auto' ? (
            // TODO(dpc): The info icon and close button should be right-aligned in a grid, etc.
            <i className="codicon codicon-info" title="Included automatically based on your workspace" />
        ) : (
            <button onClick={() => handleRemove(id)} type="button" title="Remove">
                <i className="codicon codicon-close" />
            </button>
        )}
    </li>
)

const ContextGroupComponent: React.FunctionComponent<{ group: ContextGroup; allGroups: ContextGroup[] }> = ({
    group,
    allGroups,
}): React.ReactNode => {
    // if there's a single group, we want the group name's basename
    let groupName
    if (allGroups.length === 1) {
        const matches = group.name.match(/.+[/\\](.+?)$/)
        groupName = matches ? matches[1] : group.name
    } else {
        groupName = group.name
    }

    return (
        <>
            <dt title={group.name} className={styles.lineBreakAll}>
                <i className="codicon codicon-folder" /> {groupName}
            </dt>
            <dd>
                <ol className={styles.providersList}>
                    {group.providers.map(provider => (
                        <li key={provider.kind} className={styles.providerItem}>
                            <ContextProviderComponent provider={provider} />
                        </li>
                    ))}
                </ol>
            </dd>
        </>
    )
}

function labelFor(kind: string): string {
    // All our context providers are single words; just convert them to title
    // case
    return kind[0].toUpperCase() + kind.slice(1)
}

const SearchIndexComponent: React.FunctionComponent<{
    provider: LocalSearchProvider
    indexStatus: 'failed' | 'unindexed'
}> = ({ provider, indexStatus }): React.ReactNode => {
    const events = useEnhancedContextEventHandlers()
    const onClick = (): void => {
        events.onShouldBuildSymfIndex(provider)
    }
    return (
        <div>
            {indexStatus === 'failed' ? (
                <>
                    <p className={styles.providerExplanatoryText}>
                        The previous indexing attempt failed or was cancelled.
                    </p>
                </>
            ) : (
                <p className={styles.providerExplanatoryText}>
                    The repository&apos;s contents will be indexed locally.
                </p>
            )}
            <p>
                <VSCodeButton onClick={onClick}>
                    {indexStatus === 'failed' ? 'Retry local index' : 'Build local index'}
                </VSCodeButton>
            </p>
        </div>
    )
}

const EmbeddingsConsentComponent: React.FunctionComponent<{ provider: LocalEmbeddingsProvider }> = ({
    provider,
}): React.ReactNode => {
    const events = useEnhancedContextEventHandlers()
    const onClick = (): void => {
        events.onConsentToEmbeddings(provider)
    }
    return (
        <div>
            <p className={styles.providerExplanatoryText}>
                The repository&apos;s contents will be uploaded to OpenAI&apos;s Embeddings API and then stored locally.
                {/* To exclude files, set up a <a href="about:blank#TODO">Cody ignore file.</a> */}
            </p>
            <p>
                <VSCodeButton onClick={onClick}>Enable Embeddings</VSCodeButton>
            </p>
        </div>
    )
}

function contextProviderState(provider: ContextProvider): React.ReactNode {
    switch (provider.state) {
        case 'indeterminate':
            return <></>
        case 'ready':
            return <span className={styles.providerInlineState}>&mdash; Indexed</span>
        case 'indexing':
            return <span className={styles.providerInlineState}>&mdash; Indexing&hellip;</span>
        case 'unconsented':
            return <EmbeddingsConsentComponent provider={provider} />
        case 'no-match':
            if (provider.kind === 'embeddings') {
                // Error messages for local embeddings missing.
                switch (provider.errorReason) {
                    case 'not-a-git-repo':
                        return <p className={styles.providerExplanatoryText}>Folder is not a Git repository.</p>
                    case 'git-repo-has-no-remote':
                        return (
                            <p className={styles.providerExplanatoryText}>Git repository is missing a remote origin.</p>
                        )
                    default:
                        return <></>
                }
            } else {
                return <></>
            }
        case 'unindexed':
            if (provider.kind === 'search') {
                return <SearchIndexComponent indexStatus="unindexed" provider={provider} />
            }
        case 'failed':
            if (provider.kind === 'search') {
                return <SearchIndexComponent indexStatus="failed" provider={provider} />
            }
        default:
            return ''
    }
}

const ContextProviderComponent: React.FunctionComponent<{ provider: ContextProvider }> = ({ provider }) => {
    let stateIcon
    switch (provider.state) {
        case 'indeterminate':
        case 'indexing':
            stateIcon = <i className="codicon codicon-loading codicon-modifier-spin" />
            break
        case 'unindexed':
        case 'unconsented':
            stateIcon = <i className="codicon codicon-circle-outline" />
            break
        case 'ready':
            stateIcon = <i className="codicon codicon-database" />
            break
        case 'no-match':
            stateIcon = <i className="codicon codicon-circle-slash" />
            break
        case 'failed':
            stateIcon = <i className="codicon codicon-error" />
            break
        default:
            stateIcon = '?'
            break
    }
    return (
        <>
            <span className={styles.providerIconAndName}>
                {stateIcon} <span className={styles.providerLabel}>{labelFor(provider.kind)}</span>
            </span>{' '}
            {contextProviderState(provider)}
        </>
    )
}

export const EnhancedContextSettings: React.FunctionComponent<EnhancedContextSettingsProps> = ({
    presentationMode,
    isOpen,
    setOpen,
}): React.ReactNode => {
    const events = useEnhancedContextEventHandlers()
    const context = useEnhancedContextContext()
    const [enabled, setEnabled] = React.useState<boolean>(useEnhancedContextEnabled())
    const enabledChanged = React.useCallback(
        (event: any): void => {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const shouldEnable = !!event.target.checked
            if (enabled !== shouldEnable) {
                events.onEnabledChange(shouldEnable)
                setEnabled(shouldEnable)
                // Log when a user clicks on the Enhanced Context toggle
                getVSCodeAPI().postMessage({
                    command: 'event',
                    eventName: 'CodyVSCodeExtension:useEnhancedContextToggler:clicked',
                    properties: { useEnhancedContext: shouldEnable },
                })
            }
        },
        [events, enabled]
    )

    // Handles removing a manually added remote search provider.
    const handleRemoveRemoteSearchRepo = React.useCallback(
        (id: string) => {
            events.onRemoveRemoteSearchRepo(id)
        },
        [events]
    )
    const handleAddRemoteSearchRepo = React.useCallback(() => events.onAddRemoteSearchRepo(), [events])

    const hasOpenedBeforeKey = 'enhanced-context-settings.has-opened-before'
    const hasOpenedBefore = localStorage.getItem(hasOpenedBeforeKey) === 'true'
    if (isOpen && !hasOpenedBefore) {
        localStorage.setItem(hasOpenedBeforeKey, 'true')
    }

    // Can't point at and use VSCodeCheckBox type with 'ref'

    const autofocusTarget = React.useRef<any>(null)
    React.useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            autofocusTarget.current?.focus()
        }
    }, [isOpen])

    // Can't point at and use VSCodeButton type with 'ref'

    const restoreFocusTarget = React.useRef<any>(null)
    const handleDismiss = React.useCallback(() => {
        setOpen(false)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        restoreFocusTarget.current?.focus()
    }, [setOpen, restoreFocusTarget])

    return (
        <div className={classNames(popupStyles.popupHost)}>
            <PopupFrame isOpen={isOpen} onDismiss={handleDismiss} classNames={[popupStyles.popupTrail, styles.popup]}>
                <div className={styles.container}>
                    <div>
                        <VSCodeCheckbox
                            onChange={enabledChanged}
                            checked={enabled}
                            id="enhanced-context-checkbox"
                            ref={autofocusTarget}
                        />
                    </div>
                    <div>
                        <label htmlFor="enhanced-context-checkbox">
                            <h1>Enhanced Context ✨</h1>
                        </label>
                        {presentationMode === EnhancedContextPresentationMode.Consumer ? (
                            <>
                                <p>
                                    Include additional code context with your message.{' '}
                                    {/* <a href="about:blank#TODO">Learn more</a> */}
                                </p>
                                <dl className={styles.foldersList}>
                                    {context.groups.map(group => (
                                        <ContextGroupComponent
                                            key={group.name}
                                            group={group}
                                            allGroups={context.groups}
                                        />
                                    ))}
                                </dl>
                            </>
                        ) : (
                            <>
                                <p>
                                    Automatically include additional context from your codebase.{' '}
                                    {/* <a href="about:blank#TODO">Learn more</a> */}
                                </p>
                                <dl className={styles.foldersList}>
                                    <CompactGroupsComponent
                                        groups={context.groups}
                                        handleAdd={handleAddRemoteSearchRepo}
                                        handleRemove={handleRemoveRemoteSearchRepo}
                                    />
                                </dl>
                            </>
                        )}
                    </div>
                </div>
            </PopupFrame>
            <VSCodeButton
                className={classNames(popupStyles.popupHost, styles.settingsBtn, enabled && styles.settingsBtnActive)}
                appearance="icon"
                type="button"
                onClick={() => setOpen(!isOpen)}
                title="Configure Enhanced Context"
                ref={restoreFocusTarget}
            >
                <i className="codicon codicon-sparkle" />
                {isOpen || hasOpenedBefore ? null : <div className={styles.glowyDot} />}
            </VSCodeButton>
        </div>
    )
}
