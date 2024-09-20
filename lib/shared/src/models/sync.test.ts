import { Observable, Subject } from 'observable-fns'
import { describe, expect, it, vi } from 'vitest'
import { mockAuthStatus } from '../auth/authStatus'
import { AUTH_STATUS_FIXTURE_AUTHED, type AuthStatus } from '../auth/types'
import type { ResolvedConfiguration } from '../configuration/resolver'
import { firstValueFrom, readValuesFrom, shareReplay } from '../misc/observable'
import type { CodyClientConfig } from '../sourcegraph-api/graphql/client'
import type { PartialDeep } from '../utils'
import {
    type Model,
    type ServerModel,
    createModel,
    createModelFromServerModel,
    modelTier,
} from './model'
import {
    type ModelCategory,
    type ModelTier,
    type ServerModelConfiguration,
    TestLocalStorageForModelPreferences,
    modelsService,
} from './modelsService'
import { maybeAdjustContextWindows, syncModels } from './sync'
import { ModelTag } from './tags'
import { ModelUsage } from './types'

vi.mock('graphqlClient')
vi.mock('../services/LocalStorageProvider')

describe('maybeAdjustContextWindows', () => {
    it('works', () => {
        const defaultMaxInputTokens = 8192
        /**
         * {@link defaultMaxInputTokens} * 0.85
         * Max input token count adjustment comapred to the default OpenAI tokenizer
         * (see {@link maybeAdjustContextWindows} implementation).
         */
        const mistralAdjustedMaxInputTokens = 6963
        const contextWindow = {
            maxInputTokens: defaultMaxInputTokens,
            maxOutputTokens: 4096,
        }
        const testServerSideModels = [
            {
                modelRef: 'fireworks::v1::deepseek-coder-v2-lite-base',
                displayName: '(Fireworks) DeepSeek V2 Lite Base',
                modelName: 'deepseek-coder-v2-lite-base',
                capabilities: ['autocomplete'],
                category: ModelTag.Balanced,
                status: 'stable',
                tier: ModelTag.Enterprise,
                contextWindow,
            } satisfies ServerModel,
            {
                modelRef: 'fireworks::v1::mixtral-8x7b-instruct',
                displayName: '(Fireworks) Mixtral 8x7b Instruct',
                modelName: 'mixtral-8x7b-instruct',
                capabilities: ['chat', 'autocomplete'],
                category: ModelTag.Balanced,
                status: 'stable',
                tier: ModelTag.Enterprise,
                contextWindow,
            } satisfies ServerModel,
            {
                modelRef: 'fireworks::v1::mixtral-8x22b-instruct',
                displayName: '(Fireworks) Mixtral 8x22b Instruct',
                modelName: 'mixtral-8x22b-instruct',
                capabilities: ['chat', 'autocomplete'],
                category: ModelTag.Balanced,
                status: 'stable',
                tier: ModelTag.Enterprise,
                contextWindow,
            } satisfies ServerModel,
            {
                modelRef: 'fireworks::v1::starcoder-16b',
                displayName: '(Fireworks) Starcoder 16B',
                modelName: 'starcoder-16b',
                capabilities: ['autocomplete'],
                category: ModelTag.Balanced,
                status: 'stable',
                tier: ModelTag.Enterprise,
                contextWindow,
            } satisfies ServerModel,
            {
                modelRef: 'fireworks::v1::mistral-large-latest',
                displayName: '(Mistral API) Mistral Large',
                modelName: 'mistral-large-latest',
                capabilities: ['chat'],
                category: ModelTag.Balanced,
                status: 'stable',
                tier: ModelTag.Enterprise,
                contextWindow,
            } satisfies ServerModel,
            {
                modelRef: 'fireworks::v1::llama-v3p1-70b-instruct',
                displayName: '(Fireworks) Llama 3.1 70B Instruct',
                modelName: 'llama-v3p1-70b-instruct',
                capabilities: ['chat'],
                category: ModelTag.Balanced,
                status: 'stable',
                tier: ModelTag.Enterprise,
                contextWindow,
            } satisfies ServerModel,
        ]

        const results = maybeAdjustContextWindows(testServerSideModels)
        const mistralModelNamePrefixes = ['mistral', 'mixtral']
        for (const model of results) {
            let wantMaxInputTokens = defaultMaxInputTokens
            if (mistralModelNamePrefixes.some(p => model.modelName.startsWith(p))) {
                wantMaxInputTokens = mistralAdjustedMaxInputTokens
            }
            expect(model.contextWindow.maxInputTokens).toBe(wantMaxInputTokens)
        }
    })
})

describe('server sent models', async () => {
    const serverOpus: ServerModel = {
        modelRef: 'anthropic::unknown::anthropic.claude-3-opus-20240229-v1_0',
        displayName: 'Opus',
        modelName: 'anthropic.claude-3-opus-20240229-v1_0',
        capabilities: ['chat'],
        category: 'balanced' as ModelCategory,
        status: 'stable',
        tier: 'enterprise' as ModelTier,
        contextWindow: {
            maxInputTokens: 9000,
            maxOutputTokens: 4000,
        },
    }
    const opus = createModelFromServerModel(serverOpus)

    const serverClaude: ServerModel = {
        modelRef: 'anthropic::unknown::anthropic.claude-instant-v1',
        displayName: 'Instant',
        modelName: 'anthropic.claude-instant-v1',
        capabilities: ['autocomplete'],
        category: 'balanced' as ModelCategory,
        status: 'stable',
        tier: 'enterprise' as ModelTier,
        contextWindow: {
            maxInputTokens: 9000,
            maxOutputTokens: 4000,
        },
    }
    const claude = createModelFromServerModel(serverClaude)

    const serverTitan: ServerModel = {
        modelRef: 'anthropic::unknown::amazon.titan-text-lite-v1',
        displayName: 'Titan',
        modelName: 'amazon.titan-text-lite-v1',
        capabilities: ['autocomplete', 'chat'],
        category: 'balanced' as ModelCategory,
        status: 'stable',
        tier: 'enterprise' as ModelTier,
        contextWindow: {
            maxInputTokens: 9000,
            maxOutputTokens: 4000,
        },
    }
    const titan = createModelFromServerModel(serverTitan)

    const SERVER_MODELS: ServerModelConfiguration = {
        schemaVersion: '1.0',
        revision: '-',
        providers: [],
        models: [serverOpus, serverClaude, serverTitan],
        defaultModels: {
            chat: serverOpus.modelRef,
            fastChat: serverTitan.modelRef,
            codeCompletion: serverClaude.modelRef,
        },
    }

    const mockFetchServerSideModels = vi.fn(() => Promise.resolve(SERVER_MODELS))

    const result = await firstValueFrom(
        syncModels(
            Observable.of({
                configuration: {},
                clientState: { modelPreferences: {} },
            } satisfies PartialDeep<ResolvedConfiguration> as ResolvedConfiguration),
            Observable.of(AUTH_STATUS_FIXTURE_AUTHED),
            Observable.of({
                modelsAPIEnabled: true,
            } satisfies Partial<CodyClientConfig> as CodyClientConfig),
            mockFetchServerSideModels
        )
    )
    if (result === 'pending') {
        throw new Error('syncModels was unexpectedly pending')
    }
    const storage = new TestLocalStorageForModelPreferences()
    modelsService.storage = storage
    mockAuthStatus(AUTH_STATUS_FIXTURE_AUTHED)
    vi.spyOn(modelsService, 'modelsChangesEmptyForPending', 'get').mockReturnValue(Observable.of(result))

    it('constructs from server models', () => {
        expect(opus.id).toBe(serverOpus.modelName)
        expect(opus.title).toBe(serverOpus.displayName)
        expect(opus.provider).toBe('anthropic')
        expect(opus.contextWindow).toEqual({ input: 9000, output: 4000 })
        expect(modelTier(opus)).toBe(ModelTag.Enterprise)
    })

    it("sets server models and default models if they're not already set", async () => {
        // expect all defaults to be set
        expect(await firstValueFrom(modelsService.getDefaultChatModel())).toBe(opus.id)
        expect(await firstValueFrom(modelsService.getDefaultEditModel())).toBe(opus.id)
        expect(
            await firstValueFrom(modelsService.getDefaultModel(ModelUsage.Autocomplete))
        ).toStrictEqual(claude)
    })

    it('allows updating the selected model', async () => {
        vi.spyOn(modelsService, 'modelsChangesWaitForPending', 'get').mockReturnValue(
            Observable.of(result)
        )
        await modelsService.setSelectedModel(ModelUsage.Chat, titan)
        expect(storage.data?.[AUTH_STATUS_FIXTURE_AUTHED.endpoint].selected.chat).toBe(titan.id)
    })
})

describe('syncModels', () => {
    it('does not shareReplay of result that is invalidated by authStatus change', async () => {
        vi.useFakeTimers()
        const mockFetchServerSideModels = vi.fn(
            (): Promise<ServerModelConfiguration | undefined> => Promise.resolve(undefined)
        )
        const authStatusSubject = new Subject<AuthStatus>()
        const clientConfigSubject = new Subject<CodyClientConfig>()
        const syncModelsObservable = syncModels(
            Observable.of({
                configuration: {},
                clientState: { modelPreferences: {} },
            } satisfies PartialDeep<ResolvedConfiguration> as ResolvedConfiguration),
            authStatusSubject,
            clientConfigSubject,
            mockFetchServerSideModels
        ).pipe(shareReplay())
        const { values, unsubscribe, done } = readValuesFrom(syncModelsObservable)

        // Nothing is emitted because authStatus hasn't emitted yet.
        expect(values).toStrictEqual<typeof values>([])

        function modelFixture(name: string): Model {
            return createModel({
                id: name,
                usage: [ModelUsage.Chat, ModelUsage.Edit],
                contextWindow: { input: 7000, output: 1000 },
                tags: [ModelTag.Enterprise],
            })
        }
        function serverModelFixture(name: string): ServerModel {
            return {
                modelRef: `${name}::a::b`,
                displayName: name,
                modelName: name,
                capabilities: ['chat'],
                contextWindow: {
                    maxInputTokens: 9000,
                    maxOutputTokens: 4000,
                },
            } satisfies Partial<ServerModel> as ServerModel
        }

        // Emits when authStatus emits.
        authStatusSubject.next({ ...AUTH_STATUS_FIXTURE_AUTHED, configOverwrites: { chatModel: 'foo' } })
        await vi.runOnlyPendingTimersAsync()
        clientConfigSubject.next({
            modelsAPIEnabled: false,
        } satisfies Partial<CodyClientConfig> as CodyClientConfig)
        await vi.runOnlyPendingTimersAsync()
        expect(values).toStrictEqual<typeof values>([
            {
                localModels: [],
                primaryModels: [modelFixture('foo')],
                preferences: {
                    defaults: {},
                    selected: {},
                },
            },
        ])
        values.length = 0

        // Emits immediately when the new data can be computed synchronously.
        authStatusSubject.next({ ...AUTH_STATUS_FIXTURE_AUTHED, configOverwrites: { chatModel: 'bar' } })
        await vi.runOnlyPendingTimersAsync()
        clientConfigSubject.next({
            modelsAPIEnabled: false,
        } satisfies Partial<CodyClientConfig> as CodyClientConfig)
        await vi.runOnlyPendingTimersAsync()
        expect(values).toStrictEqual<typeof values>([
            {
                localModels: [],
                primaryModels: [modelFixture('bar')],
                preferences: {
                    defaults: {},
                    selected: {},
                },
            },
        ])
        values.length = 0
        expect(mockFetchServerSideModels).toHaveBeenCalledTimes(0)

        // Emits when the clientConfig changes.
        const quxModel = serverModelFixture('qux')
        mockFetchServerSideModels.mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 10))
            return {
                models: [quxModel],
                defaultModels: { chat: 'qux::a::a', fastChat: 'qux::a::a', codeCompletion: 'qux::a::a' },
                providers: [],
                revision: '',
                schemaVersion: '',
            }
        })
        clientConfigSubject.next({
            modelsAPIEnabled: true,
        } satisfies Partial<CodyClientConfig> as CodyClientConfig)
        await vi.advanceTimersByTimeAsync(9)
        expect(values).toStrictEqual<typeof values>(['pending'])
        values.length = 0
        await vi.advanceTimersByTimeAsync(1)
        expect(values).toStrictEqual<typeof values>([
            {
                localModels: [],
                primaryModels: [createModelFromServerModel(quxModel)],
                preferences: {
                    defaults: {
                        autocomplete: 'a',
                        chat: 'a',
                        edit: 'a',
                    },
                    selected: {},
                },
            },
        ])
        values.length = 0
        expect(mockFetchServerSideModels).toHaveBeenCalledTimes(1)

        // Does not emit anything when the new data can't be computed synchronously (i.e., it
        // requires a fetch).
        const zzzModel = serverModelFixture('zzz')
        mockFetchServerSideModels.mockImplementation(async () => {
            await new Promise(resolve => setTimeout(() => resolve(undefined), 50))
            return {
                models: [zzzModel],
                defaultModels: { chat: 'zzz::a::a', fastChat: 'zzz::a::a', codeCompletion: 'zzz::a::a' },
                providers: [],
                revision: '',
                schemaVersion: '',
            }
        })
        authStatusSubject.next({ ...AUTH_STATUS_FIXTURE_AUTHED, endpoint: 'https://other.example.com' })
        await vi.runOnlyPendingTimersAsync()
        clientConfigSubject.next({
            modelsAPIEnabled: true,
        } satisfies Partial<CodyClientConfig> as CodyClientConfig)
        await vi.advanceTimersByTimeAsync(49)
        expect(values).toStrictEqual<typeof values>(['pending'])
        values.length = 0

        // Before the fetch finishes, the shareReplay should not share anything because the
        // authStatus change invalidated the value.
        expect(await firstValueFrom(syncModelsObservable)).toStrictEqual<(typeof values)[0]>('pending')

        // Now the fetch is complete.
        await vi.advanceTimersByTimeAsync(1)
        expect(values).toStrictEqual<typeof values>([
            {
                localModels: [],
                primaryModels: [createModelFromServerModel(zzzModel)],
                preferences: {
                    defaults: {
                        autocomplete: 'a',
                        chat: 'a',
                        edit: 'a',
                    },
                    selected: {},
                },
            },
        ])
        values.length = 0

        unsubscribe()
        await done
    })
})
