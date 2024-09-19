import { type Observable, filter, map } from 'observable-fns'
import { authStatus, currentAuthStatus } from '../auth/authStatus'
import { mockAuthStatus } from '../auth/authStatus'
import { type AuthStatus, isCodyProUser, isEnterpriseUser } from '../auth/types'
import { AUTH_STATUS_FIXTURE_AUTHED_DOTCOM } from '../auth/types'
import { type PickResolvedConfiguration, resolvedConfig } from '../configuration/resolver'
import { logDebug } from '../logger'
import {
    type StoredLastValue,
    type Unsubscribable,
    combineLatest,
    distinctUntilChanged,
    firstValueFrom,
    shareReplay,
    storeLastValue,
    tap,
    withLatestFrom,
} from '../misc/observable'
import { ClientConfigSingleton } from '../sourcegraph-api/graphql/client'
import { CHAT_INPUT_TOKEN_BUDGET, CHAT_OUTPUT_TOKEN_BUDGET } from '../token/constants'
import { type Model, type ServerModel, modelTier } from './model'
import { syncModels } from './sync'
import { ModelTag } from './tags'
import { type ChatModel, type EditModel, type ModelContextWindow, ModelUsage } from './types'

type ModelId = string
type ApiVersionId = string
type ProviderId = string

export type ModelRefStr = `${ProviderId}::${ApiVersionId}::${ModelId}`
export interface ModelRef {
    providerId: ProviderId
    apiVersionId: ApiVersionId
    modelId: ModelId
}

export type ModelCategory = ModelTag.Power | ModelTag.Balanced | ModelTag.Speed
export type ModelStatus =
    | ModelTag.Experimental
    | ModelTag.EarlyAccess
    | ModelTag.OnWaitlist
    | ModelTag.Waitlist
    | 'stable'
    | ModelTag.Deprecated
export type ModelTier = ModelTag.Free | ModelTag.Pro | ModelTag.Enterprise
export type ModelCapability = 'chat' | 'autocomplete'

export interface ContextWindow {
    maxInputTokens: number
    maxOutputTokens: number
}

export interface ClientSideConfig {
    /**
     * The API key for the model
     */
    apiKey?: string
    /**
     * The API endpoint for the model
     */
    apiEndpoint?: string
    /**
     * if this model is compatible with OpenAI API provider
     * allow the site admin to set configuration params
     */
    openAICompatible?: OpenAICompatible
    /**
     * The additional setting options for the model.
     * E.g. "temperature": 0.5, "max_tokens": 100, "stream": false
     */
    options?: Record<string, any>
}

interface OpenAICompatible {
    // (optional) List of stop sequences to use for this model.
    stopSequences?: string[]

    // (optional) EndOfText identifier used by the model. e.g. "<|endoftext|>", "< EOT >"
    endOfText?: string

    // (optional) A hint the client should use when producing context to send to the LLM.
    // The maximum length of all context (prefix + suffix + snippets), in characters.
    contextSizeHintTotalCharacters?: number

    // (optional) A hint the client should use when producing context to send to the LLM.
    // The maximum length of the document prefix (text before the cursor) to include, in characters.
    contextSizeHintPrefixCharacters?: number

    // (optional) A hint the client should use when producing context to send to the LLM.
    // The maximum length of the document suffix (text after the cursor) to include, in characters.
    contextSizeHintSuffixCharacters?: number

    // (optional) Custom instruction to be included at the start of all chat messages
    // when using this model, e.g. "Answer all questions in Spanish."
    //
    // Note: similar to Cody client config option `cody.chat.preInstruction`; if user has
    // configured that it will be used instead of this.
    chatPreInstruction?: string

    // (optional) Custom instruction to be included at the end of all edit commands
    // when using this model, e.g. "Write all unit tests with Jest instead of detected framework."
    //
    // Note: similar to Cody client config option `cody.edit.preInstruction`; if user has
    // configured that it will be respected instead of this.
    editPostInstruction?: string

    // (optional) How long the client should wait for autocomplete results to come back (milliseconds),
    // before giving up and not displaying an autocomplete result at all.
    //
    // This applies on single-line completions, e.g. `var i = <completion>`
    //
    // Note: similar to hidden Cody client config option `cody.autocomplete.advanced.timeout.singleline`
    // If user has configured that, it will be respected instead of this.
    autocompleteSinglelineTimeout?: number

    // (optional) How long the client should wait for autocomplete results to come back (milliseconds),
    // before giving up and not displaying an autocomplete result at all.
    //
    // This applies on multi-line completions, which are based on intent-detection when e.g. a code block
    // is being completed, e.g. `func parseURL(url string) {<completion>`
    //
    // Note: similar to hidden Cody client config option `cody.autocomplete.advanced.timeout.multiline`
    // If user has configured that, it will be respected instead of this.
    autocompleteMultilineTimeout?: number

    // (optional) model parameters to use for the chat feature
    chatTopK?: number
    chatTopP?: number
    chatTemperature?: number
    chatMaxTokens?: number

    // (optional) model parameters to use for the autocomplete feature
    autoCompleteTopK?: number
    autoCompleteTopP?: number
    autoCompleteTemperature?: number
    autoCompleteSinglelineMaxTokens?: number
    autoCompleteMultilineMaxTokens?: number

    // (optional) model parameters to use for the edit feature
    editTopK?: number
    editTopP?: number
    editTemperature?: number
    editMaxTokens?: number
}

interface Provider {
    id: string
    displayName: string
}

interface DefaultModels {
    chat: ModelRefStr
    fastChat: ModelRefStr
    codeCompletion: ModelRefStr
}

// TODO(PRIME-323): Do a proper review of the data model we will use to describe
// server-side configuration. Once complete, it should match the data types we
// use in this repo exactly. Until then, we need to map the "server-side" model
// types, to the `Model` types used by Cody clients.
export interface ServerModelConfiguration {
    schemaVersion: string
    revision: string
    providers: Provider[]
    models: ServerModel[]
    defaultModels: DefaultModels
}

export interface PerSitePreferences {
    [endpoint: string]: SitePreferences
}

export interface SitePreferences {
    defaults: {
        [usage in ModelUsage]?: string
    }
    selected: {
        [usage in ModelUsage]?: string
    }
}

export interface ModelsData {
    /** Models available on the endpoint (Sourcegraph instance). */
    primaryModels: Model[]

    /** Models available on the user's local device (e.g., on Ollama). */
    localModels: Model[]

    /** Preferences for the current endpoint. */
    preferences: SitePreferences
}

const EMPTY_MODELS_DATA: ModelsData = {
    localModels: [],
    preferences: { defaults: {}, selected: {} },
    primaryModels: [],
}

interface LocalStorageForModelPreferences {
    getModelPreferences(): PerSitePreferences
    setModelPreferences(preferences: PerSitePreferences): Promise<void>
}

/**
 * ModelsService is the component responsible for keeping track of which models
 * are supported on the backend, which ones are available based on the user's
 * preferences, etc.
 *
 * TODO(PRIME-228): Update this type to be able to fetch the models from the
 *      Sourcegraph backend instead of being hard-coded.
 * TODO(PRIME-283): Enable Cody Enterprise users to select which LLM model to
 *      used in the UI. (By having the relevant code paths just pull the models
 *      from this type.)
 */
export class ModelsService {
    public storage: LocalStorageForModelPreferences | undefined

    private storedValue: StoredLastValue<ModelsData>
    private syncPreferencesSubscription: Unsubscribable

    constructor(testing__modelsChanges?: ModelsService['modelsChanges']) {
        if (testing__modelsChanges) {
            this.modelsChanges = testing__modelsChanges
        }
        this.modelsChanges = this.modelsChanges.pipe(shareReplay())
        this.modelsChangesEmptyForPending = this.modelsChanges.pipe(
            map((data: ModelsData | 'pending') => (data === 'pending' ? EMPTY_MODELS_DATA : data)),
            shareReplay()
        )
        this.modelsChangesWaitForPending = this.modelsChanges.pipe(
            filter((data: ModelsData | 'pending') => data !== 'pending')
        )
        this.storedValue = storeLastValue(this.modelsChangesEmptyForPending)

        this.syncPreferencesSubscription = this.modelsChangesWaitForPending
            .pipe(
                tap(data => {
                    if (this.storage) {
                        const allSitePrefs = this.storage.getModelPreferences()
                        const updated: PerSitePreferences = {
                            ...allSitePrefs,
                            [currentAuthStatus().endpoint]: data.preferences,
                        }
                        this.storage?.setModelPreferences(updated)
                    }
                })
            )
            .subscribe({})
    }

    public dispose(): void {
        this.storedValue.subscription.unsubscribe()
        this.syncPreferencesSubscription.unsubscribe()
    }

    /**
     * An observable that emits all available models upon subscription and whenever there are
     * changes.
     */
    public modelsChanges: Observable<ModelsData | 'pending'> = syncModels(
        resolvedConfig.pipe(
            map(
                (
                    config
                ): PickResolvedConfiguration<{
                    configuration: true
                    auth: true
                    clientState: 'modelPreferences' | 'waitlist_o1'
                }> => config
            ),
            distinctUntilChanged()
        ),
        authStatus,
        ClientConfigSingleton.getInstance().changes
    ).pipe(distinctUntilChanged())

    public modelsChangesEmptyForPending: Observable<ModelsData>

    public modelsChangesWaitForPending: Observable<ModelsData>

    /**
     * The list of models.
     *
     * @internal `public` for testing only.
     */
    public get models(): Model[] {
        const data = this.storedValue.value.last
        return data ? data.primaryModels.concat(data.localModels) : []
    }

    private getModelsByType(usage: ModelUsage): Observable<Model[]> {
        return this.modelsChangesEmptyForPending.pipe(
            map(models =>
                [...models.primaryModels, ...models.localModels].filter(model =>
                    model.usage.includes(usage)
                )
            ),
            distinctUntilChanged()
        )
    }

    /**
     * Gets the available models of the specified usage type, with the default model first.
     *
     * @param type - The usage type of the models to retrieve.
     * @returns An Observable that emits an array of models, with the default model first.
     */
    public getModels(type: ModelUsage): Observable<Model[]> {
        return combineLatest([this.modelsChangesEmptyForPending, this.getDefaultModel(type)]).pipe(
            map(([data, currentModel]) => {
                const models = data.primaryModels
                    .concat(data.localModels)
                    .filter(model => model.usage.includes(type))
                if (!currentModel) {
                    return models
                }
                return [currentModel].concat(models.filter(m => m.id !== currentModel.id))
            }),
            distinctUntilChanged()
        )
    }

    public getDefaultModel(type: ModelUsage): Observable<Model | undefined> {
        return this.getModelsByType(type).pipe(
            withLatestFrom(this.modelsChangesEmptyForPending),
            withLatestFrom(authStatus),
            map(([[models, modelsData], authStatus]) => {
                // Free users can only use the default free model, so we just find the first model they can use
                const firstModelUserCanUse = models.find(
                    m => this._isModelAvailable(modelsData, authStatus, m) === true
                )

                if (modelsData.preferences) {
                    // Check to see if the user has a selected a default model for this
                    // usage type and if not see if there is a server sent default type
                    const selected = this.resolveModel(
                        modelsData,
                        modelsData.preferences.selected[type] ?? modelsData.preferences.defaults[type]
                    )
                    if (selected && this._isModelAvailable(modelsData, authStatus, selected) === true) {
                        return selected
                    }
                }
                return firstModelUserCanUse
            }),
            distinctUntilChanged()
        )
    }

    public getDefaultEditModel(): Observable<EditModel | undefined> {
        return this.getDefaultModel(ModelUsage.Edit).map(model => model?.id)
    }

    public getDefaultChatModel(): Observable<ChatModel | undefined> {
        return this.getDefaultModel(ModelUsage.Chat).map(model => model?.id)
    }

    public async setSelectedModel(type: ModelUsage, model: Model | string): Promise<void> {
        const modelsData = await firstValueFrom(this.modelsChangesWaitForPending)
        const resolved = this.resolveModel(modelsData, model)
        if (!resolved) {
            return
        }
        if (!resolved.usage.includes(type)) {
            throw new Error(`Model "${resolved.id}" is not compatible with usage type "${type}".`)
        }
        logDebug('ModelsService', `Setting selected ${type} model to ${resolved.id}`)
        if (!this.storage) {
            throw new Error('ModelsService.storage is not set')
        }
        const serverEndpoint = currentAuthStatus().endpoint
        const currentPrefs = deepClone(this.storage.getModelPreferences())
        if (!currentPrefs[serverEndpoint]) {
            currentPrefs[serverEndpoint] = {
                defaults: {},
                selected: {},
            }
        }
        currentPrefs[serverEndpoint].selected[type] = resolved.id
        await this.storage.setModelPreferences(currentPrefs)
    }

    public isModelAvailable(model: string | Model): Observable<boolean> {
        return combineLatest([authStatus, this.modelsChangesEmptyForPending])
            .map(([authStatus, modelsData]) => {
                return this._isModelAvailable(modelsData, authStatus, model)
            })
            .pipe(distinctUntilChanged())
    }

    private _isModelAvailable(
        modelsData: ModelsData,
        authStatus: AuthStatus,
        model: string | Model
    ): boolean {
        const resolved = this.resolveModel(modelsData, model)
        if (!resolved) {
            return false
        }
        const tier = modelTier(resolved)
        // Cody Enterprise users are able to use any models that the backend says is supported.
        if (isEnterpriseUser(authStatus)) {
            return true
        }

        // A Cody Pro user can use any Free or Pro model, but not Enterprise.
        // (But in reality, Sourcegraph.com wouldn't serve any Enterprise-only models to
        // Cody Pro users anyways.)
        if (isCodyProUser(authStatus)) {
            return (
                tier !== 'enterprise' &&
                !resolved.tags.includes(ModelTag.Waitlist) &&
                !resolved.tags.includes(ModelTag.OnWaitlist)
            )
        }

        return tier === 'free'
    }

    // does an approximate match on the model id, seeing if there are any models in the
    // cache that are contained within the given model id. This allows passing a qualified,
    // unqualified or ModelRefStr in as the model id will be a substring
    private resolveModel(
        modelsData: ModelsData,
        modelID: Model | string | undefined
    ): Model | undefined {
        if (!modelID) {
            return undefined
        }
        if (typeof modelID !== 'string') {
            return modelID
        }

        const models = modelsData.primaryModels.concat(modelsData.localModels)
        return models.find(m => modelID.endsWith(m.id)) ?? models.find(m => modelID.includes(m.id))
    }

    /**
     * Finds the model provider with the given model ID and returns its Context Window.
     */
    public getContextWindowByID(modelID: string): ModelContextWindow {
        const model = this.models.find(m => m.id === modelID)
        return model
            ? model.contextWindow
            : { input: CHAT_INPUT_TOKEN_BUDGET, output: CHAT_OUTPUT_TOKEN_BUDGET }
    }

    public getModelByID(modelID: string): Model | undefined {
        return this.models.find(m => m.id === modelID)
    }

    public getModelByIDSubstringOrError(modelSubstring: string): Model {
        const models = this.models.filter(m => m.id.includes(modelSubstring))
        if (models.length === 1) {
            return models[0]
        }
        const errorMessage =
            models.length > 1
                ? `Multiple models found for substring ${modelSubstring}.`
                : `No models found for substring ${modelSubstring}.`
        const modelsList = this.models.map(m => m.id).join(', ')
        throw new Error(`${errorMessage} Available models: ${modelsList}`)
    }

    public isStreamDisabled(modelID: string): boolean {
        const model = this.getModelByID(modelID)
        return model?.tags.includes(ModelTag.StreamDisabled) ?? false
    }
}

export const modelsService = new ModelsService()

interface MockModelsServiceResult {
    storage: TestLocalStorageForModelPreferences
    modelsService: ModelsService
}

export class TestLocalStorageForModelPreferences implements LocalStorageForModelPreferences {
    constructor(public data: PerSitePreferences | null = null) {}

    getModelPreferences(): PerSitePreferences {
        return this.data || {}
    }

    async setModelPreferences(preferences: PerSitePreferences): Promise<void> {
        this.data = preferences
    }
}

export function mockModelsService({
    storage = new TestLocalStorageForModelPreferences(),
    modelsService = new ModelsService(),
    authStatus = AUTH_STATUS_FIXTURE_AUTHED_DOTCOM,
}: {
    authStatus?: AuthStatus
    modelsService?: ModelsService
    storage?: TestLocalStorageForModelPreferences
}): MockModelsServiceResult {
    modelsService.storage = storage
    mockAuthStatus(authStatus)
    return { storage, modelsService }
}

function deepClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
}
