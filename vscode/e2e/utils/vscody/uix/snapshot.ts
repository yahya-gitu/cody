import _fs from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { type ExpectMatcherState, type MatcherReturnType, type TestInfo, test } from '@playwright/test'
import { produce } from 'immer'
import _ from 'lodash'
import type { ArraySlice } from 'type-fest'
export { test } from '@playwright/test'

export const expect = {
    async toMatchJSONSnapshot<T extends object>(
        this: ExpectMatcherState,
        received: T,
        snapshotName: string,
        options?: {
            normalizers?: ((obj: any) => any)[]
        }
    ): Promise<MatcherReturnType> {
        const name = 'toMatchJSONSnapshot'
        if (this.isNot) {
            throw new Error('not implemented')
        }

        const testInfo = test.info() as TestInfo & { _projectInternal: any }
        let normalized = received
        for (const normalizer of options?.normalizers ?? []) {
            normalized = produce(normalized, normalizer)
        }

        const serialized = JSON.stringify(normalized, null, 2)

        const snapshotDir = testInfo.snapshotDir
        const snapshotPath = path.join(snapshotDir, `${snapshotName}.snap.json`)

        if (testInfo._projectInternal.ignoreSnapshots)
            return {
                pass: true,
                message: () => '',
                name,
                expected: snapshotName,
            }

        const updateSnapshots = testInfo.config.updateSnapshots === 'all'
        const exists = _fs.existsSync(snapshotPath)
        if (exists) {
            const previousJSON = await fs.readFile(snapshotPath, 'utf-8')
            const previous = JSON.parse(previousJSON)
            const current = JSON.parse(serialized)
            if (!_.isEqual(current, previous)) {
                return {
                    pass: false,
                    message: () =>
                        `Snapshot does not match ${snapshotName}\n\n${this.utils.diff(
                            previous,
                            current
                        )}`,
                    name,
                    expected: previous,
                    actual: current,
                }
            }
        }

        if (updateSnapshots || !exists) {
            await fs.writeFile(snapshotPath, serialized)
        }

        return {
            message: () => 'Snapshot matches',
            pass: true,
        }
    },
} as const

export namespace Normalizers {
    export const pick =
        (...paths: string[]) =>
        (draft: any) => {
            return _.pick(draft, ...paths)
        }

    export const omit =
        (...paths: string[]) =>
        (draft: any) => {
            return _.omit(draft, ...paths)
        }

    export const fixedDates =
        (fixedDate = new Date('2000-01-01T00:00:00Z')) =>
        (draft: any) => {
            function recurse(current: any): any {
                if (current instanceof Date) {
                    return new Date(fixedDate)
                }

                if (Array.isArray(current)) {
                    return current.map(recurse)
                }

                if (typeof current === 'object' && current !== null) {
                    for (const key of Object.keys(current)) {
                        current[key] = recurse(current[key])
                    }
                }

                return current
            }
            return recurse(draft)
        }

    /**
     * Allows you to sort a specified path by an arbitrary key
     */
    export const sortPathBy = (
        path: string,
        ...args: ArraySlice<Parameters<(typeof _)['sortBy']>, 1>
    ) => {
        return (draft: any) => {
            const item = _.get(draft, path)
            if (_.isArray(item)) {
                const sorted: any[] = _.sortBy(item, ...args)
                item.sort((a, b) => sorted.indexOf(a) - sorted.indexOf(b))
            }
            return draft
        }
    }

    export function sortKeysDeep(obj: any) {
        return produce(obj, (draft: any) => {
            if (typeof draft !== 'object' || draft === null) {
                return
            }

            if (Array.isArray(draft)) {
                for (const [index, item] of draft.entries()) {
                    draft[index] = sortKeysDeep(item)
                }
                return
            }

            const sortedKeys = Object.keys(draft).sort()
            const newObj = {}

            for (const key of sortedKeys) {
                //@ts-ignore
                newObj[key] = sortKeysDeep(draft[key])
            }

            return newObj
        })
    }
}
