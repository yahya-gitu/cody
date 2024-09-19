import { logDebug } from '../log'
import type { CompletionIntent } from '../tree-sitter/queries'
export interface LatencyFeatureFlags {
    user?: boolean
}

const defaultLatencies = {
    user: 50,
    lowPerformance: 1000,
    max: 1400,
}

// Languages with lower performance get additional latency to avoid spamming users with unhelpful
// suggestions
export const lowPerformanceLanguageIds = new Set([
    'css',
    'html',
    'scss',
    'vue',
    'dart',
    'json',
    'yaml',
    'postcss',
    'markdown',
    'plaintext',
    'xml',
    'twig',
    'jsonc',
    'handlebars',
])

const lowPerformanceCompletionIntents = new Set(['comment', 'import.source'])


/**
 * Calculates the artificial delay to be added to code completion suggestions based on various factors.
 *
 * The delay is calculated based on the following:
 * - A baseline delay for low-performance languages or completion intents
 * - The user's current latency, which increases linearly up to a maximum after 5 rejected suggestions
 * - The session timestamp, which is reset every 5 minutes or on file change
 *
 */
export function getArtificialDelay(params: {
    languageId: string
    codyAutocompleteDisableLowPerfLangDelay: boolean
    completionIntent?: CompletionIntent
}): number {
    const { languageId, codyAutocompleteDisableLowPerfLangDelay, completionIntent } = params

    let baseline = 0

    const isLowPerformanceLanguageId = lowPerformanceLanguageIds.has(languageId)
    const isLowPerformanceCompletionIntent =
        completionIntent && lowPerformanceCompletionIntents.has(completionIntent)
    // Add a baseline latency for low performance languages
    if (isLowPerformanceLanguageId || isLowPerformanceCompletionIntent) {
        // if user has disabled low performace language delay, then don't add latency
        if (!codyAutocompleteDisableLowPerfLangDelay) {
            baseline = defaultLatencies.lowPerformance
        }
    }

    const total = Math.max(
        baseline, defaultLatencies.max
    )

    if (total > 0) {
        logDebug('AutocompleteProvider:getLatency', `Delay added: ${total}`)
    }

    return total
}
