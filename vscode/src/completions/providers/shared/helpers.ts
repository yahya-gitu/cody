import { expect, it, vi } from 'vitest'

import {
    AUTH_STATUS_FIXTURE_AUTHED,
    AUTH_STATUS_FIXTURE_AUTHED_DOTCOM,
    type AutocompleteProviderID,
    type CodeCompletionsParams,
    type ModelsData,
    type ModelsService,
    TestLocalStorageForModelPreferences,
    createModelFromServerModel,
    firstValueFrom,
    mockAuthStatus,
    modelsService,
} from '@sourcegraph/cody-shared'

import { Observable } from 'observable-fns'
import { getMockedGenerateCompletionsOptions } from '../../get-inline-completions-tests/helpers'
import { type ServerSentModelsMock, getServerSentModelsMock } from './__mocks__/create-provider-mocks'
import { createProvider } from './create-provider'
import type { Provider } from './provider'

/**
 * Creates autocomplete provider and resolves
 * to the first value emitted by the observable wrapper.
 */
export async function createProviderForTest(
    ...args: Parameters<typeof createProvider>
): Promise<Provider> {
    const providerOrError = await firstValueFrom(createProvider(...args))

    if (providerOrError instanceof Error) {
        throw providerOrError
    }

    return providerOrError
}

/**
 * Creates autocomplete provider from the mocked VS Code settings.
 */
export function getAutocompleteProviderFromLocalSettings({
    providerId,
    legacyModel,
    isDotCom,
}: { providerId: AutocompleteProviderID; legacyModel: string; isDotCom: boolean }): Promise<Provider> {
    return createProviderForTest({
        config: {
            configuration: {
                autocompleteAdvancedProvider: providerId,
                autocompleteAdvancedModel: legacyModel,
            },
        },
        authStatus: isDotCom ? AUTH_STATUS_FIXTURE_AUTHED_DOTCOM : AUTH_STATUS_FIXTURE_AUTHED,
    })
}

/**
 * Creates autocomplete provider from the mocked server-side model config.
 * Uses {@link modelsService} under the hood to mock the server response.
 */
export async function getAutocompleteProviderFromServerSideModelConfig({
    modelRef,
    isDotCom,
}: {
    modelRef: ServerSentModelsMock['models'][number]['modelRef']
    isDotCom: boolean
}): Promise<Provider> {
    const authStatus = isDotCom ? AUTH_STATUS_FIXTURE_AUTHED_DOTCOM : AUTH_STATUS_FIXTURE_AUTHED

    const mockedConfig = getServerSentModelsMock()
    const newDefaultModel = mockedConfig.models.find(model => model.modelRef === modelRef)!
    mockedConfig.defaultModels.codeCompletion = newDefaultModel.modelRef

    mockModelsServiceWithModelsData({
        primaryModels: mockedConfig.models.map(createModelFromServerModel),
        localModels: [],
        preferences: {
            defaults: {
                autocomplete: newDefaultModel.modelName,
            },
            selected: {},
        },
    })
    mockAuthStatus(authStatus)

    return createProviderForTest({
        config: {
            configuration: {
                autocompleteAdvancedProvider: 'default',
                autocompleteAdvancedModel: null,
            },
        },
        authStatus,
    })
}

function mockModelsServiceWithModelsData(modelsData: ModelsData): ModelsService {
    modelsService.storage = new TestLocalStorageForModelPreferences()
    vi.spyOn(modelsService, 'modelsChanges', 'get').mockReturnValue(Observable.of(modelsData))
    vi.spyOn(modelsService, 'models', 'get').mockReturnValue(modelsData.primaryModels)
    vi.spyOn(modelsService, 'preferences', 'get').mockReturnValue(modelsData.preferences)
    return modelsService
}

/**
 * Creates autocomplete provider from the mocked site-config Cody LLM configuration.
 */
export function getAutocompleteProviderFromSiteConfigCodyLLMConfiguration({
    providerId,
    legacyModel,
    isDotCom,
}: { providerId: AutocompleteProviderID; legacyModel: string; isDotCom: boolean }): Promise<Provider> {
    const authStatus = isDotCom ? AUTH_STATUS_FIXTURE_AUTHED_DOTCOM : AUTH_STATUS_FIXTURE_AUTHED

    return createProviderForTest({
        config: {
            configuration: {
                autocompleteAdvancedProvider: 'default',
                autocompleteAdvancedModel: null,
            },
        },
        authStatus: {
            ...authStatus,
            configOverwrites: {
                provider: providerId,
                completionModel: legacyModel,
            },
        },
    })
}

export interface AutocompleteProviderValuesToAssert {
    /**
     * Provider ID used for client logging.
     */
    providerId: AutocompleteProviderID
    /**
     * Legacy model used for client logging and potentially in `requestParams`
     */
    legacyModel: string
    /**
     * Payload send with HTTP requests
     */
    requestParams: Omit<CodeCompletionsParams, 'messages'>
}

/**
 * Utility to assert that the autocomplete provider is configured correctly.
 */
export function testAutocompleteProvider(
    label: string,
    valuesToAssert: AutocompleteProviderValuesToAssert,
    getProvider: (isDotCom: boolean) => Promise<Provider>
) {
    it.each(['dotcom', 'enterprise'])(`[%s] ${label}`, async instanceType => {
        const provider = await getProvider(instanceType === 'dotcom')
        const { providerId, legacyModel, requestParams } = valuesToAssert

        expect(provider.id).toBe(providerId)
        expect(provider.legacyModel).toBe(legacyModel)
        expect(getRequestParamsWithoutMessages(provider)).toMatchObject(requestParams)
    })
}

export function getRequestParamsWithoutMessages(
    provider: Provider
): Omit<CodeCompletionsParams, 'messages' | 'stopSequences'> {
    const { messages, stopSequences, ...restParams } = provider.getRequestParams(
        getMockedGenerateCompletionsOptions()
    ) as CodeCompletionsParams

    return restParams
}
