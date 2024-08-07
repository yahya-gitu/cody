import { type ContextItem, ContextItemSource } from '@sourcegraph/cody-shared'

export function contextItemID(item: ContextItem): string {
    return JSON.stringify([
        `${item.type}`,
        `${item.type === 'repository' ? item.repoID : ''}`,
        `${item.type === 'tree' ? item.title : ''}`,
        `${item.uri.toString()}`,
        `${item.type === 'symbol' ? item.symbolName : ''}`,
        item.range
            ? `${item.range.start.line}:${item.range.start.character}-${item.range.end.line}:${item.range.end.character}`
            : '',
    ])
}

export function prepareContextItemForMentionMenu(
    item: ContextItem,
    remainingTokenBudget: number
): ContextItem {
    let isTooLarge = item.size !== undefined ? item.size > remainingTokenBudget : item.isTooLarge
    if (isTooLarge) {
        console.error('# prepareContextItemForMentionMenu: isTooLarge', item)
    } else {
        console.error('# prepareContextItemForMentionMenu: !isTooLarge', item)
    }
    isTooLarge = true
    return {
        ...item,

        isTooLarge,

        // All @-mentions should have a source of `User`.
        source: ContextItemSource.User,
    }
}
