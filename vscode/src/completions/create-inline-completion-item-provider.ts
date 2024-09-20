import {
    type AuthenticatedAuthStatus,
    NEVER,
    type PickResolvedConfiguration,
    type UnauthenticatedAuthStatus,
    createDisposables,
    promiseFactoryToObservable,
    switchMap,
    vscodeResource,
} from '@sourcegraph/cody-shared'
import * as vscode from 'vscode'

import { logDebug } from '../log'
import type { CodyStatusBar } from '../services/StatusBar'

import { type Observable, map } from 'observable-fns'
import type { PlatformContext } from '../extension.common'
import type { BfgRetriever } from './context/retrievers/bfg/bfg-retriever'
import { InlineCompletionItemProvider } from './inline-completion-item-provider'
import { createProvider } from './providers/shared/create-provider'
import { registerAutocompleteTraceView } from './tracer/traceView'

interface InlineCompletionItemProviderArgs {
    config: PickResolvedConfiguration<{ configuration: true }>
    authStatus:
        | UnauthenticatedAuthStatus
        | Pick<AuthenticatedAuthStatus, 'authenticated' | 'endpoint' | 'configOverwrites'>
    platform: Pick<PlatformContext, 'extensionClient'>
    statusBar: CodyStatusBar
    createBfgRetriever?: () => BfgRetriever
}

/**
 * Inline completion item providers that always returns an empty reply.
 * Implemented as a class instead of anonymous function so that you can identify
 * it with `console.log()` debugging.
 */
class NoopCompletionItemProvider implements vscode.InlineCompletionItemProvider {
    public provideInlineCompletionItems(
        _document: vscode.TextDocument,
        _position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
        return { items: [] }
    }
}

export function createInlineCompletionItemProvider({
    config: { configuration },
    authStatus,
    platform,
    statusBar,
    createBfgRetriever,
}: InlineCompletionItemProviderArgs): Observable<void> {
    if (!configuration.autocomplete) {
        if (
            configuration.isRunningInsideAgent &&
            platform.extensionClient.capabilities?.completions !== 'none'
        ) {
            throw new Error(
                'The setting `config.autocomplete` evaluated to `false`. It must be true when running inside the agent. ' +
                    'To fix this problem, make sure that the setting cody.autocomplete.enabled has the value true.'
            )
        }
        return NEVER
    }

    if (!authStatus.authenticated) {
        logDebug('AutocompleteProvider:notSignedIn', 'You are not signed in.')

        if (configuration.isRunningInsideAgent) {
            // Register an empty completion provider when running inside the
            // agent to avoid timeouts because it awaits for an
            // `InlineCompletionItemProvider` to be registered.
            return vscodeResource(() =>
                vscode.languages.registerInlineCompletionItemProvider(
                    '*',
                    new NoopCompletionItemProvider()
                )
            )
        }

        return NEVER
    }

    return promiseFactoryToObservable(async () => {
        // TODO(sqs)#observe: make the list of vscode languages reactive
        return await getInlineCompletionItemProviderFilters(configuration.autocompleteLanguages)
    }).pipe(
        switchMap(documentFilters =>
            createProvider({ config: { configuration }, authStatus }).pipe(
                createDisposables(providerOrError => {
                    if (providerOrError instanceof Error) {
                        logDebug('AutocompleteProvider', providerOrError.message)

                        if (configuration.isRunningInsideAgent) {
                            const configString = JSON.stringify({ configuration }, null, 2)
                            throw new Error(
                                `Can't register completion provider because \`createProvider\` returned an error (${providerOrError.message}). To fix this problem, debug why createProvider returned an error. To further debug this problem, here is the configuration:\n${configString}`
                            )
                        }

                        vscode.window.showErrorMessage(providerOrError.message)
                        return []
                    }

                    const triggerDelay =
                        vscode.workspace
                            .getConfiguration()
                            .get<number>('cody.autocomplete.triggerDelay') ?? 0

                    const completionsProvider = new InlineCompletionItemProvider({
                        triggerDelay,
                        provider: providerOrError,
                        firstCompletionTimeout: configuration.autocompleteFirstCompletionTimeout,
                        statusBar,
                        completeSuggestWidgetSelection:
                            configuration.autocompleteCompleteSuggestWidgetSelection,
                        formatOnAccept: configuration.autocompleteFormatOnAccept,
                        disableInsideComments: configuration.autocompleteDisableInsideComments,
                        isRunningInsideAgent: configuration.isRunningInsideAgent,
                        createBfgRetriever,
                    })

                    return [
                        vscode.commands.registerCommand('cody.autocomplete.manual-trigger', () =>
                            completionsProvider.manuallyTriggerCompletion()
                        ),
                        vscode.languages.registerInlineCompletionItemProvider(
                            [{ notebookType: '*' }, ...documentFilters],
                            completionsProvider
                        ),
                        registerAutocompleteTraceView(completionsProvider),
                        completionsProvider,
                    ]
                })
            )
        ),
        map(() => undefined)
    )
}

// Languages which should be disabled, but they are not present in
// https://code.visualstudio.com/docs/languages/identifiers#_known-language-identifiers
// But they exist in the `vscode.languages.getLanguages()` return value.
//
// To avoid confusing users with unknown language IDs, we disable them here programmatically.
const DISABLED_LANGUAGES = new Set(['scminput'])

export async function getInlineCompletionItemProviderFilters(
    autocompleteLanguages: Record<string, boolean>
): Promise<vscode.DocumentFilter[]> {
    const { '*': isEnabledForAll, ...perLanguageConfig } = autocompleteLanguages
    const languageIds = await vscode.languages.getLanguages()

    return languageIds.flatMap(language => {
        const enabled =
            !DISABLED_LANGUAGES.has(language) && language in perLanguageConfig
                ? perLanguageConfig[language]
                : isEnabledForAll

        return enabled ? [{ language, scheme: 'file' }] : []
    })
}
