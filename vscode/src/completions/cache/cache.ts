import { LRUCache } from 'lru-cache'

import { Completion } from '..'
import { trimEndOnLastLineIfWhitespaceOnly } from '../text-processing'

export interface CachedCompletions {
    logId: string
    completions: Completion[]
}

/**
 * The document state information used by {@link CompletionsCache}.
 */
export interface CompletionsCacheDocumentState {
    /**
     * The prefix (up to the cursor) of the source file where the completion request was triggered.
     */
    prefix: string

    /**
     * The suffix (after the cursor) of the source file where the completion request was triggered.
     */
    suffix: string

    /**
     * The language of the document, used to ensure that completions are cached separately for
     * different languages (even if the files have the same prefix).
     */
    languageId: string
}

export interface CacheRequest {
    /** The representation of the document and cursor. */
    documentState: CompletionsCacheDocumentState

    /**
     * Only return a cache entry if the prefix matches exactly (without trimming whitespace).
     *
     * @default false
     */
    isExactPrefixOnly?: boolean
}

const CACHE_KEY_DOCUMENT_CONTENT_PREFIX_SUFFIX_LENGTH = 200

/*
 * Return the cache key used for a given document state.
 *
 * Only the first {@link CACHE_KEY_DOCUMENT_CONTENT_SUFFIX_LENGTH} characters of the prefix and
 * suffix are used to distinguish cache keys (because an edit that is sufficiently far away from the
 * cursor can be considered to not invalidate the relevant cache entries).
 **/
function cacheKey({ prefix, suffix, languageId }: CompletionsCacheDocumentState): string {
    return `${languageId}<|>${prefix.slice(-CACHE_KEY_DOCUMENT_CONTENT_PREFIX_SUFFIX_LENGTH)}<|>${suffix.slice(
        0,
        CACHE_KEY_DOCUMENT_CONTENT_PREFIX_SUFFIX_LENGTH
    )}`
}

export class CompletionsCache {
    private cache = new LRUCache<string, CachedCompletions>({
        max: 500, // Maximum input prefixes in the cache.
    })

    public clear(): void {
        this.cache.clear()
    }

    public get({
        documentState: { prefix, suffix, languageId },
        isExactPrefixOnly,
    }: CacheRequest): CachedCompletions | undefined {
        const trimmedPrefix = isExactPrefixOnly ? prefix : trimEndOnLastLineIfWhitespaceOnly(prefix)
        const key = cacheKey({ prefix: trimmedPrefix, suffix, languageId })
        return this.cache.get(key)
    }

    public add(logId: string, documentState: CompletionsCacheDocumentState, completions: Completion[]): void {
        const trimmedPrefix = trimEndOnLastLineIfWhitespaceOnly(documentState.prefix)

        for (const completion of completions) {
            // Cache the exact prefix first and then append characters from the
            // completion one after the other until the first line is exceeded.
            //
            // If the completion starts with a `\n`, this logic will append the
            // second line instead.
            let maxCharsAppended = completion.content.indexOf('\n', completion.content.at(0) === '\n' ? 1 : 0)
            if (maxCharsAppended === -1) {
                maxCharsAppended = completion.content.length - 1
            }

            // We also cache the completion with the exact (= untrimmed) prefix for the separate
            // lookup mode used for deletions.
            const prefixHasTrailingWhitespaceOnLastLine = trimmedPrefix !== documentState.prefix
            if (prefixHasTrailingWhitespaceOnLastLine) {
                this.insertCompletion(cacheKey(documentState), logId, completion)
            }

            for (let i = 0; i <= maxCharsAppended; i++) {
                const completionPrefixToAppend = completion.content.slice(0, i)
                const partialCompletionContent = completion.content.slice(i)
                const appendedPrefix = trimmedPrefix + completionPrefixToAppend
                const key = cacheKey({
                    ...documentState,
                    prefix: appendedPrefix,
                })
                this.insertCompletion(key, logId, { content: partialCompletionContent })
            }
        }
    }

    private insertCompletion(key: string, logId: string, completion: Completion): void {
        let existingCompletions: Completion[] = []
        if (this.cache.has(key)) {
            existingCompletions = this.cache.get(key)!.completions
        }

        const cachedCompletion: CachedCompletions = {
            logId,
            completions: existingCompletions.concat(completion),
        }

        this.cache.set(key, cachedCompletion)
    }

    /**
     * For use by tests only.
     */
    public get __stateForTestsOnly(): { [key: string]: CachedCompletions } {
        return Object.fromEntries(this.cache.entries())
    }
}
