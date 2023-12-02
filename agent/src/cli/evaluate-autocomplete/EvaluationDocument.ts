import * as fspromises from 'fs/promises'
import path from 'path'

import { ObjectHeaderItem } from 'csv-writer/src/lib/record'
import * as vscode from 'vscode'

import { CompletionBookkeepingEvent } from '../../../../vscode/src/completions/logger'
import { TextDocumentWithUri } from '../../../../vscode/src/jsonrpc/TextDocumentWithUri'
import { AgentTextDocument } from '../../AgentTextDocument'

export class EvaluationDocument {
    public items: EvaluationItem[] = []
    public readonly lines: string[]
    public readonly textDocument: AgentTextDocument
    constructor(
        public readonly params: Pick<
            EvaluationItem,
            'languageid' | 'workspace' | 'strategy' | 'fixture' | 'filepath' | 'revision'
        >,
        public readonly text: string,
        public readonly uri: vscode.Uri,
        public readonly snapshotDirectory?: string
    ) {
        this.lines = text.split('\n')
        this.textDocument = new AgentTextDocument(TextDocumentWithUri.from(uri, { content: text }))
    }

    public pushItem(
        item: Omit<EvaluationItem, 'languageid' | 'workspace' | 'strategy' | 'fixture' | 'filepath' | 'revision'>
    ): void {
        item.rangeStartLine = item.range.start.line
        item.rangeStartCharacter = item.range.start.character
        item.rangeEndLine = item.range.end.line
        item.rangeEndCharacter = item.range.end.character
        if (item.event) {
            item.eventJSON = JSON.stringify(item.event)
        }
        this.items.push({
            ...item,
            ...this.params,
        })
    }

    public async writeSnapshot(snapshotDirectory: string): Promise<void> {
        const outputPath = path.join(snapshotDirectory, this.params.filepath)
        await fspromises.mkdir(path.dirname(outputPath), { recursive: true })
        const snapshot = this.formatSnapshot()
        await fspromises.writeFile(outputPath, snapshot)
    }

    // This function is copy/pasted from the scip-typescript repository so that we
    // can customize rendering for the `evaluate-autocomplete` command. For example,
    // we will need to come up with a good solution for multi-line completions that may not
    // be relevant for scip-typescript.
    private formatSnapshot(): string {
        const commentSyntax = commentSyntaxForLanguage(this.params.languageid)
        const out: string[] = []
        this.items.sort(compareItemByRange)
        let occurrenceIndex = 0
        for (const [lineNumber, line] of this.lines.entries()) {
            out.push(' '.repeat(commentSyntax.length))
            out.push(line.replace('\t', ' '))
            out.push('\n')
            while (occurrenceIndex < this.items.length && this.items[occurrenceIndex].rangeStartLine === lineNumber) {
                const item = this.items[occurrenceIndex]
                occurrenceIndex++
                if (item.rangeStartLine !== item.rangeEndLine) {
                    // Skip multiline occurrences for now.
                    continue
                }
                out.push(commentSyntax)
                out.push(' '.repeat(item.range.start.character))
                const length = item.range.end.character - item.range.start.character
                if (length < 0) {
                    throw new Error(this.format(item.range, 'negative length occurrence!'))
                }
                out.push('^'.repeat(length))
                out.push(' AUTOCOMPLETE')
                if (item.resultEmpty) {
                    out.push(' EMPTY_RESULT')
                }
                if (item.resultTimeout) {
                    out.push(' TIMEOUT')
                }
                if (item.resultExact) {
                    out.push(' EXACT_MATCH')
                }
                if (item.resultTypechecks === true) {
                    out.push(' TYPECHECK_OK')
                } else if (item.resultTypechecks === false) {
                    out.push(' TYPECHECK_ERROR')
                }
                if (item.resultText) {
                    out.push(' RESULT ')
                    out.push(item.resultText.replaceAll('\n', '\\n'))
                }
                out.push('\n')
            }
        }
        return out.join('')
    }

    /**
     * For debugingg purposes, formats the source file with carets ^ to underline
     * the range. For example, when given the range enclosing the `hello`
     * identifier.
     * ```
     * src/hello.ts:LINE:CHARACTER
     * const hello = 42
     * ^^^^^
     * ```
     * @param range the range to highlight
     * @param diagnostic optional message to include with the formatted string
     */
    public format(range: vscode.Range, diagnostic?: string): string {
        const line = this.lines[range.start.line]
        const indent = ' '.repeat(range.start.character)
        const length =
            range.start.line === range.end.line
                ? range.end.character - range.start.character
                : line.length - range.start.character
        const carets = length < 0 ? '<negative length>' : '^'.repeat(length)
        const multilineSuffix = range.isSingleLine ? '' : ` ${range.end.line}:${range.end.character}`
        const message = diagnostic ? ' ' + diagnostic : ''
        return `${this.params.filepath}:${range.start.line}:${range.start.character}${message}\n${line}\n${indent}${carets}${multilineSuffix}`
    }

    public log(range: vscode.Range): void {
        console.log(this.format(range))
    }
}

/**
 * An AutocompleteItem represents one row in the final CSV file that
 * evaluate-autocomplete emits.
 */
export interface EvaluationItem {
    languageid: string
    workspace: string
    fixture: string
    strategy: string
    filepath: string
    revision: string
    range: vscode.Range
    rangeStartLine?: number
    rangeStartCharacter?: number
    rangeEndLine?: number
    rangeEndCharacter?: number
    resultNonInsertPatch?: boolean
    resultTimeout?: boolean
    resultError?: string
    resultEmpty?: boolean
    resultExact?: boolean
    resultTypechecks?: boolean
    resultText?: string
    event?: CompletionBookkeepingEvent
    eventJSON?: string
}

export const autocompleteItemHeaders: ObjectHeaderItem[] = [
    { id: 'languageid', title: 'LANGUAGEID' },
    { id: 'workspace', title: 'WORKSPACE' },
    { id: 'fixture', title: 'FIXTURE' },
    { id: 'strategy', title: 'STRATEGY' },
    { id: 'filepath', title: 'FILEPATH' },
    { id: 'revision', title: 'REVISION' },
    { id: 'rangeStartLine', title: 'RANGE_START_LINE' },
    { id: 'rangeStartCharacter', title: 'RANGE_START_CHARACTER' },
    { id: 'rangeEndLine', title: 'RANGE_END_LINE' },
    { id: 'rangeEndCharacter', title: 'RANGE_END_CHARACTER' },
    { id: 'resultTimeout', title: 'RESULT_TIMEOUT' },
    { id: 'resultError', title: 'RESULT_ERROR' },
    { id: 'resultEmpty', title: 'RESULT_EMPTY' },
    { id: 'resultExact', title: 'RESULT_EXACT' },
    { id: 'resultTypechecks', title: 'RESULT_TYPECHECKS' },
    { id: 'resultText', title: 'RESULT_TEXT' },
    { id: 'resultNonInsertPatch', title: 'RESULT_NON_INSERT_PATCH' },
    { id: 'eventJSON', title: 'EVENT' },
]

function commentSyntaxForLanguage(languageid: string): string {
    switch (languageid) {
        case 'haskell':
        case 'lua':
            return '--'
        case 'python':
        case 'ruby':
        case 'yaml':
        case 'dockerfile':
        case 'toml':
        case 'perl':
        case 'perl6':
            return '#'
        default:
            return '//'
    }
}

function compareItemByRange(a: EvaluationItem, b: EvaluationItem): number {
    const byStart = a.range.start.compareTo(b.range.start)
    if (byStart !== 0) {
        return byStart
    }
    return a.range.end.compareTo(b.range.end)
}
