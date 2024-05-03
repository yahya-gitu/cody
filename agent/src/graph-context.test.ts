import path from 'node:path'
import { isWindows } from '@sourcegraph/cody-shared'
import dedent from 'dedent'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ParallelTestClients } from './ParallelTestClients'
import { TestClient } from './TestClient'
import { TestWorkspace } from './TestWorkspace'
import { TESTING_TOKENS } from './testing-tokens'

interface TestParameters {
    provider: 'fireworks' | 'anthropic'
    model: string
    graphContext: string
}

// CODY-1280 - fix Windows support
describe.skipIf(isWindows())('Graph Context', () => {
    const workspace = new TestWorkspace(path.join(__dirname, '__tests__', 'graph-test'))

    const models: TestParameters[] = [
        { graphContext: 'tsc-mixed', provider: 'fireworks', model: 'starcoder-7b' },
        { graphContext: 'tsc-mixed', provider: 'fireworks', model: 'starcoder-16b' },
        { graphContext: 'tsc-mixed', provider: 'anthropic', model: 'claude-instant-1.2' },
        { graphContext: 'tsc-mixed', provider: 'anthropic', model: 'claude-3-haiku-20240307' },
    ]
    const clients = new ParallelTestClients(
        models.map(({ graphContext, provider, model }) =>
            TestClient.create({
                workspaceRootUri: workspace.rootUri,
                name: `graph-context-${model}`,
                token: TESTING_TOKENS.dotcom,
                extraConfiguration: {
                    'cody.autocomplete.experimental.graphContext': graphContext,
                    'cody.autocomplete.advanced.provider': provider,
                    'cody.autocomplete.advanced.model': model,
                    'cody.experimental.symfContext': false,
                },
            })
        )
    )

    beforeAll(async () => {
        await workspace.beforeAll()
        await clients.beforeAll()
    }, 10_000)

    describe('Autocomplete', () => {
        const mainUri = workspace.file('src', 'main.ts')
        it('empty', async () => {
            clients.modelFilter = { model: 'starcoder-7b' }
            await clients.openFile(mainUri)
            expect(await clients.autocompletes()).toMatchInlineSnapshot(`
              "autocompletes:
                - name: starcoder-7b
                  value:
                    - "// TODO: Write tests"
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: |-
                        <filename>src/main.ts<fim_prefix>//
                        // TODO: Write <fim_suffix>
                        <fim_middle>
              "
            `)
        })

        it('single-line', async () => {
            clients.modelFilter = { provider: 'fireworks' }
            await clients.changeFile(
                mainUri,
                dedent`
            import { User } from './user'

            const user = /* CURSOR */

            export const message = 'Hello'
            `
            )
            const text = await clients.autocompletes()
            expect(text).includes('firstName:')
            expect(text).includes('isEligible:')
            expect(text).toMatchInlineSnapshot(
                `
              "autocompletes:
                - name: starcoder-16b
                  value:
                    - |-
                      const user = {
                        firstName: 'John',
                        isEligible: true
                      }
                - name: starcoder-7b
                  value:
                    - |-
                      const user = {
                        firstName: 'John',
                        isEligible: true
                      }
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: >-
                        <filename>src/main.ts<fim_prefix>// Additional documentation for
                        \`User\`:

                        //

                        // interface User {

                        //   firstName: string

                        //   isEligible: boolean

                        // }

                        //

                        import { User } from './user'


                        const user = <fim_suffix>


                        export const message = 'Hello'<fim_middle>
              "
            `
            )
        })

        it('multiline', async () => {
            clients.modelFilter = { model: 'starcoder-16b' }
            await clients.changeFile(
                mainUri,
                dedent`
            import { User } from './user'

            const user = {/* CURSOR */

            export const message = 'Hello'
            `
            )
            const text = await clients.autocompletes()
            expect(text).includes('firstName:')
            expect(text).includes('isEligible:')
            expect(text).toMatchInlineSnapshot(
                `
              "autocompletes:
                - name: starcoder-16b
                  value:
                    - |-
                      const user = {
                        firstName: 'John',
                        isEligible: true
                      }
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: >-
                        <filename>src/main.ts<fim_prefix>// Additional documentation for
                        \`User\`:

                        //

                        // interface User {

                        //   firstName: string

                        //   isEligible: boolean

                        // }

                        //

                        import { User } from './user'


                        const user = {<fim_suffix>


                        export const message = 'Hello'<fim_middle>
              "
            `
            )
        }, 10_000)

        it('multiple-symbols', async () => {
            clients.modelFilter = { model: 'starcoder-16b' }
            await clients.changeFile(
                mainUri,
                dedent`
            import path from 'node:path'
            import os from 'os'
            import { readFileSync } from 'node:fs'
            import { User } from './user'
            import { Car, isNewCar } from './car'

            function getDriverWithNewCar(cars: Car[]): User {
              /* CURSOR */

            }

            export const message = 'Hello'
            `
            )

            const text = await clients.autocompletes()
            expect(text).includes('isNewCar')
            expect(text).includes('minimumYear:')
            expect(text).toMatchInlineSnapshot(`
              "autocompletes:
                - name: starcoder-16b
                  value:
                    - |2-
                        const newCars = cars.filter(isNewCar)
                        return newCars[0].user
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: >-
                        <filename>src/main.ts<fim_prefix>// Additional documentation for
                        \`isNewCar\`:

                        //

                        // function isNewCar(car: Car, params: { minimumYear: number; }): boolean

                        //

                        // Additional documentation for \`readFileSync\`:

                        //

                        // function readFileSync(path: PathOrFileDescriptor, options?: { encoding?: null; flag?: string; }): Buffer

                        //

                        // Additional documentation for \`readFileSync\`:

                        //

                        // function readFileSync(path: PathOrFileDescriptor, options?: { encoding?: null; flag?: string; }): Buffer

                        //

                        // Additional documentation for \`readFileSync\`:

                        //

                        // function readFileSync(path: PathOrFileDescriptor, options?: { encoding?: null; flag?: string; }): Buffer

                        //

                        // Additional documentation for \`User\`:

                        //

                        // interface User {

                        //   firstName: string

                        //   isEligible: boolean

                        // }

                        //

                        //

                        // Additional documentation for \`Car\`:

                        //

                        // interface Car {

                        //   modelYear: number

                        //   vanityItem: boolean

                        //   user: User

                        // }

                        //

                        import path from 'node:path'

                        import os from 'os'

                        import { readFileSync } from 'node:fs'

                        import { User } from './user'

                        import { Car, isNewCar } from './car'


                        function getDriverWithNewCar(cars: Car[]): User {
                          <fim_suffix>

                        }


                        export const message = 'Hello'<fim_middle>
              "
            `)
        }, 10_000)

        it('complex-types', async () => {
            clients.modelFilter = { model: 'starcoder-16b' }
            await clients.changeFile(
                mainUri,
                dedent`
            import { ComplexType, ComplexInterface } from './ComplexType'


            function createComplexInterface(): ComplexInterface {
              return /* CURSOR */
            }

            export const message = 'Hello'
            `
            )

            const text = await clients.autocompletes()
            expect(text).includes('a1:')
            expect(text).includes('a2:')
            expect(text).toMatchInlineSnapshot(
                `
              "autocompletes:
                - name: starcoder-16b
                  value:
                    - |2-
                        return {
                          a: {
                            a1: 1,
                            a2: 2,
                          },
                          b: 'b',
                          c: (c, d) => c + d,
                          d: {
                            a: 'a',
                            b: 1,
                          },
                        }
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: >-
                        <filename>src/main.ts<fim_prefix>// Additional documentation for
                        \`ComplexType\`:

                        //

                        // export type ComplexType = Omit<A & C, 'c2'>

                        //

                        // Additional documentation for \`b\`:

                        //

                        // b: number

                        //

                        // Additional documentation for \`ComplexClass\`:

                        //

                        // class ComplexClass {

                        //   constructor(a: Record<string, number>, b: string, c: (c: string, d: string) => string, d: { a: string; b: number; }): ComplexClass

                        //   a: Record<string, number>

                        //   b: string

                        //   c: (c: string, d: string) => string

                        //   d: { a: string; b: number; }

                        // }

                        //

                        //

                        // Additional documentation for \`a\`:

                        //

                        // a: string

                        import { ComplexType, ComplexInterface } from './ComplexType'



                        function createComplexInterface(): ComplexInterface {
                          return <fim_suffix>
                        }


                        export const message = 'Hello'<fim_middle>
              "
            `
            )
        }, 10_000)

        it('function-parameter', async () => {
            clients.modelFilter = { model: 'starcoder-16b' }
            await clients.changeFile(
                mainUri,
                dedent`
            import { doSomething } from './functions'

            function main(): void {
                doSomething(/* CURSOR */)
            }
            `
            )

            const text = await clients.autocompletes()
            expect(text).includes('validDogSled')
            expect(text).toMatchInlineSnapshot(
                `
              "autocompletes:
                - name: starcoder-16b
                  value: []
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: >-
                        <filename>src/main.ts<fim_prefix>// Additional documentation for
                        \`doSomething\`:

                        //

                        // function doSomething(argument: Something): void

                        //

                        // Additional documentation for \`Something\`:

                        //

                        // interface Something {

                        //   validDogSled: boolean

                        // }

                        //

                        import { doSomething } from './functions'


                        function main(): void {
                            doSomething(<fim_suffix>
                        }<fim_middle>
              "
            `
            )
        }, 10_000)

        it('function-parameter2', async () => {
            clients.modelFilter = { model: 'starcoder-16b' }
            await clients.changeFile(
                mainUri,
                dedent`
            import makeWebAuthn from 'webauthn4js';

            function main() {
                makeWebAuthn({/* CURSOR */})
            }
            `
            )

            // TODO: add .includes assertion for a non-empty result. It looks
            // like starcoder-16b doesn't have strong enough reasoning skills to
            // make use of the context.
            expect(await clients.autocompletes()).toMatchInlineSnapshot(`
              "autocompletes:
                - name: starcoder-16b
                  value: []
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: >-
                        <filename>src/main.ts<fim_prefix>// Additional documentation for
                        \`makeWebAuthn\`:

                        //

                        // var makeWebAuthn: { (config: Config): Promise<WebAuthn4JS>; schemas: any; }

                        //

                        // Additional documentation for \`WebAuthn4JSEvents\`:

                        //

                        // interface WebAuthn4JSEvents {

                        //   error: (err: Error) => void

                        //   exit: (code: number) => void

                        // }

                        //

                        //

                        // Additional documentation for \`TypedEmitter\`:

                        //

                        // class TypedEmitter {

                        //   L: L

                        //   addListener<U extends keyof L>(event: U, listener: L[U]): this

                        //   prependListener<U extends keyof L>(event: U, listener: L[U]): this

                        //   prependOnceListener<U extends keyof L>(event: U, listener: L[U]): this

                        //   removeListener<U extends keyof L>(event: U, listener: L[U]): this

                        //   removeAllListeners(event?: keyof L): this

                        //   once<U extends keyof L>(event: U, listener: L[U]): this

                        //   on<U extends keyof L>(event: U, listener: L[U]): this

                        //   off<U extends keyof L>(event: U, listener: L[U]): this

                        //   emit<U extends keyof L>(event: U, ...args: Parameters<L[U]>): boolean

                        //   eventNames<U extends keyof L>(): U[]

                        //   listenerCount(type: keyof L): number

                        //   listeners<U extends keyof L>(type: U): L[U][]

                        //   rawListeners<U extends keyof L>(type: U): L[U][]

                        //   getMaxListeners(): number

                        //   setMaxListeners(n: number): this

                        // }

                        //

                        //

                        // Additional documentation for \`WebAuthn4JS\`:

                        //

                        // interface WebAuthn4JS extends TypedEmitter<WebAuthn4JSEvents> {

                        //   beginRegistration(user: User, ...opts: ((cco: PublicKeyCredentialCreationOptions) => PublicKeyCredentialCreationOptions)[]) => Promise<...>

                        //   finishRegistration(user: User, sessionData: SessionData, response: CredentialCreationResponse) => Promise<Credential>

                        //   beginLogin(user: User, ...opts: ((cro: PublicKeyCredentialRequestOptions) => PublicKeyCredentialRequestOptions)[]) => Promise<...>

                        //   finishLogin(user: User, sessionData: SessionData, response: CredentialAssertionResponse) => Promise<Credential>

                        //   exit(code?: number) => void

                        // }

                        //

                        //

                        // Additional documentation for \`Config\`:

                        //

                        // export type Config = {

                        //     /** A valid domain that identifies the Relying Party. A credential can only by used  with the same enity (as identified by the \`RPID\`) it was registered with. */

                        //     RPID: string;

                        //     /** Friendly name for the Relying Party (application). The browser may display this to the user. */

                        //     RPDisplayName: string;

                        //     /** Configures the list of Relying Party Server Origins that are permitted. These should be fully qualified origins. */

                        //     RPOrigins: string[];

                        //     /** Preferred attestation conveyance during credential generation */

                        //     AttestationPreference?: ConveyancePreference | undefined;

                        //     /** Login requirements for authenticator attributes. */

                        //     AuthenticatorSelection?: AuthenticatorSelection | undefined;

                        //     /** Enables various debug options. */

                        //     Debug?: boolean | undefined;

                        //     /** Ensures the user.id value during registrations is encoded as a raw UTF8 string. This is useful when you only use printable ASCII characters for the random user.id but the browser library does not decode the URL Safe Base64 data. */

                        //     EncodeUserIDAsString?: boolean | undefined;

                        //     /** Configures various timeouts. */

                        //     Timeouts?: TimeoutsConfig | undefined;

                        //     /** @deprecated This option has been removed from newer specifications due to security considerations. */

                        //     RPIcon?: string | undefined;

                        //     /** @deprecated Use RPOrigins instead. */

                        //     RPOrigin?: string | undefined;

                        //     /** @deprecated Use Timeouts instead. */

                        //     Timeout?: number | undefined;

                        // };

                        import makeWebAuthn from 'webauthn4js';


                        function main() {
                            makeWebAuthn({<fim_suffix>
                        }<fim_middle>
              "
            `)
        }, 10_000)

        it('member-selection', async () => {
            clients.modelFilter = { model: 'starcoder-16b' }
            await clients.changeFile(
                mainUri,
                dedent`
            import { selector, All } from './members'

            function run(all: All): void {
                selector./* CURSOR */
            }
            `
            )

            const text = await clients.autocompletes()
            expect(text).toMatchInlineSnapshot(
                `
              "autocompletes:
                - name: starcoder-16b
                  value:
                    - "    selector.query({ isMammal: true, animalName: 'Dog' })"
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: >-
                        <filename>src/main.ts<fim_prefix>// Additional documentation for
                        \`selector\`:

                        //

                        // var selector: Selector

                        //

                        // Additional documentation for \`Selector\`:

                        //

                        // interface Selector {

                        //   query(params: { isMammal: boolean; animalName: string; }) => { animals: Animal[]; }

                        // }

                        //

                        import { selector, All } from './members'


                        function run(all: All): void {
                            selector.<fim_suffix>
                        }<fim_middle>
              "
            `
            )
        }, 10_000)

        it('member-selection-expression', async () => {
            clients.modelFilter = { model: 'starcoder-16b' }
            await clients.changeFile(
                mainUri,
                dedent`
            import { getter } from './members-indirection'

            function run(): void {
                getter.indirect()./* CURSOR */
            }
            `
            )

            const text = await clients.autocompletes()
            expect(text).toMatchInlineSnapshot(
                `
              "autocompletes:
                - name: starcoder-16b
                  value:
                    - "    getter.indirect().query({ isMammal: true, animalName: 'Dog' })"
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: >-
                        <filename>src/main.ts<fim_prefix>// Additional documentation for
                        \`getter\`:

                        //

                        // var getter: { a: A; b: B; c: C; indirect(): Selector; }

                        //

                        // Additional documentation for \`Selector\`:

                        //

                        // interface Selector {

                        //   query(params: { isMammal: boolean; animalName: string; }) => { animals: Animal[]; }

                        // }

                        //

                        import { getter } from './members-indirection'


                        function run(): void {
                            getter.indirect().<fim_suffix>
                        }<fim_middle>
              "
            `
            )
        }, 10_000)

        it('member-selection-expression-this', async () => {
            clients.modelFilter = { model: 'starcoder-16b' }
            await clients.changeFile(
                mainUri,
                dedent`
            import { getter } from './members-indirection'

            class Runner {

                foobar = getter
                run(): void {
                    this.foobar.indirect()./* CURSOR */
                }
            }
            `
            )

            const text = await clients.autocompletes()
            expect(text).toMatchInlineSnapshot(
                `
              "autocompletes:
                - name: starcoder-16b
                  value:
                    - "        this.foobar.indirect().query({ isMammal: true, animalName:
                      'Dog' })"
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: >-
                        <filename>src/main.ts<fim_prefix>// Additional documentation for
                        \`getter\`:

                        //

                        // var getter: { a: A; b: B; c: C; indirect(): Selector; }

                        //

                        // Additional documentation for \`Selector\`:

                        //

                        // interface Selector {

                        //   query(params: { isMammal: boolean; animalName: string; }) => { animals: Animal[]; }

                        // }

                        //

                        import { getter } from './members-indirection'


                        class Runner {

                            foobar = getter
                            run(): void {
                                this.foobar.indirect().<fim_suffix>
                            }
                        }<fim_middle>
              "
            `
            )
        }, 10_000)

        it('function-parameter2', async () => {
            clients.modelFilter = { model: 'starcoder-16b' }
            await clients.changeFile(
                mainUri,
                dedent`
            import makeWebAuthn from 'webauthn4js';

            function main() {
                makeWebAuthn({/* CURSOR */})
            }
            `
            )

            const text = await clients.autocompletes()
            // Assert that the context includes types from the webauthn4js
            // package.  If these assertions are failing it could indicate that
            // you have not run `pnpm install`.
            expect(text).includes('export type Config')
            expect(text).includes('interface WebAuthn4JSEvents')
            expect(text).toMatchInlineSnapshot(`
              "autocompletes:
                - name: starcoder-16b
                  value: []
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: >-
                        <filename>src/main.ts<fim_prefix>// Additional documentation for
                        \`makeWebAuthn\`:

                        //

                        // var makeWebAuthn: { (config: Config): Promise<WebAuthn4JS>; schemas: any; }

                        //

                        // Additional documentation for \`WebAuthn4JSEvents\`:

                        //

                        // interface WebAuthn4JSEvents {

                        //   error: (err: Error) => void

                        //   exit: (code: number) => void

                        // }

                        //

                        //

                        // Additional documentation for \`TypedEmitter\`:

                        //

                        // class TypedEmitter {

                        //   L: L

                        //   addListener<U extends keyof L>(event: U, listener: L[U]): this

                        //   prependListener<U extends keyof L>(event: U, listener: L[U]): this

                        //   prependOnceListener<U extends keyof L>(event: U, listener: L[U]): this

                        //   removeListener<U extends keyof L>(event: U, listener: L[U]): this

                        //   removeAllListeners(event?: keyof L): this

                        //   once<U extends keyof L>(event: U, listener: L[U]): this

                        //   on<U extends keyof L>(event: U, listener: L[U]): this

                        //   off<U extends keyof L>(event: U, listener: L[U]): this

                        //   emit<U extends keyof L>(event: U, ...args: Parameters<L[U]>): boolean

                        //   eventNames<U extends keyof L>(): U[]

                        //   listenerCount(type: keyof L): number

                        //   listeners<U extends keyof L>(type: U): L[U][]

                        //   rawListeners<U extends keyof L>(type: U): L[U][]

                        //   getMaxListeners(): number

                        //   setMaxListeners(n: number): this

                        // }

                        //

                        //

                        // Additional documentation for \`WebAuthn4JS\`:

                        //

                        // interface WebAuthn4JS extends TypedEmitter<WebAuthn4JSEvents> {

                        //   beginRegistration(user: User, ...opts: ((cco: PublicKeyCredentialCreationOptions) => PublicKeyCredentialCreationOptions)[]) => Promise<...>

                        //   finishRegistration(user: User, sessionData: SessionData, response: CredentialCreationResponse) => Promise<Credential>

                        //   beginLogin(user: User, ...opts: ((cro: PublicKeyCredentialRequestOptions) => PublicKeyCredentialRequestOptions)[]) => Promise<...>

                        //   finishLogin(user: User, sessionData: SessionData, response: CredentialAssertionResponse) => Promise<Credential>

                        //   exit(code?: number) => void

                        // }

                        //

                        //

                        // Additional documentation for \`Config\`:

                        //

                        // export type Config = {

                        //     /** A valid domain that identifies the Relying Party. A credential can only by used  with the same enity (as identified by the \`RPID\`) it was registered with. */

                        //     RPID: string;

                        //     /** Friendly name for the Relying Party (application). The browser may display this to the user. */

                        //     RPDisplayName: string;

                        //     /** Configures the list of Relying Party Server Origins that are permitted. These should be fully qualified origins. */

                        //     RPOrigins: string[];

                        //     /** Preferred attestation conveyance during credential generation */

                        //     AttestationPreference?: ConveyancePreference | undefined;

                        //     /** Login requirements for authenticator attributes. */

                        //     AuthenticatorSelection?: AuthenticatorSelection | undefined;

                        //     /** Enables various debug options. */

                        //     Debug?: boolean | undefined;

                        //     /** Ensures the user.id value during registrations is encoded as a raw UTF8 string. This is useful when you only use printable ASCII characters for the random user.id but the browser library does not decode the URL Safe Base64 data. */

                        //     EncodeUserIDAsString?: boolean | undefined;

                        //     /** Configures various timeouts. */

                        //     Timeouts?: TimeoutsConfig | undefined;

                        //     /** @deprecated This option has been removed from newer specifications due to security considerations. */

                        //     RPIcon?: string | undefined;

                        //     /** @deprecated Use RPOrigins instead. */

                        //     RPOrigin?: string | undefined;

                        //     /** @deprecated Use Timeouts instead. */

                        //     Timeout?: number | undefined;

                        // };

                        import makeWebAuthn from 'webauthn4js';


                        function main() {
                            makeWebAuthn({<fim_suffix>
                        }<fim_middle>
              "
            `)
        }, 10_000)

        const tsxUri = workspace.file('src', 'Calculator.tsx')
        it('tsx', async () => {
            clients.modelFilter = { model: 'starcoder-16b' }
            await clients.openFile(tsxUri)

            const text = await clients.autocompletes()
            expect(text).includes('props.languageKind')
            expect(text).toMatchInlineSnapshot(`
              "autocompletes:
                - name: starcoder-16b
                  value:
                    - "    return <h1>My favorite calculator comes from
                      {props.languageKind}</h1>"
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: >-
                        <filename>src/Calculator.tsx<fim_prefix>// Additional documentation
                        for \`CalculatorProps\`:

                        //

                        // interface CalculatorProps {

                        //   languageKind: "arabic" | "japanese" | "roman"

                        // }

                        //

                        //

                        // Here is a reference snippet of code from src/main.ts:

                        //

                        // import makeWebAuthn from 'webauthn4js';

                        //

                        // function main() {

                        //     makeWebAuthn({})

                        // }

                        import { FunctionComponent } from 'react'

                        import { CalculatorProps } from './CalculatorProps'

                        import * as React from 'react'


                        export const Calculator: FunctionComponent<CalculatorProps> = props => {
                            return <h1>My favorite calculator comes from {<fim_suffix>
                        }

                        <fim_middle>
              "
            `)
        }, 10_000)

        const jsUri = workspace.file('src', 'typeless2.js')
        it('js', async () => {
            clients.modelFilter = { model: 'starcoder-16b' }
            await clients.openFile(jsUri)

            const text = await clients.autocompletes()
            expect(text).includes('helper')
            expect(text).includes('{ b:')
            expect(text).toMatchInlineSnapshot(
                `
              "autocompletes:
                - name: starcoder-16b
                  value:
                    - "    return helper(1, { b: 2 }, 3)"
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: >-
                        <filename>src/typeless2.js<fim_prefix>// Additional documentation for
                        \`helper\`:

                        //

                        // function helper(a: any, { b }: { b: any; }, c: any): any

                        import { helper } from './typeless'


                        export function render() {
                            return helper(<fim_suffix>
                        }

                        <fim_middle>
              "
            `
            )
        }, 10_000)

        const jsxUri = workspace.file('src', 'FruitsList.jsx')
        it('jsx', async () => {
            clients.modelFilter = { model: 'starcoder-16b' }
            await clients.openFile(jsxUri)

            const text = await clients.autocompletes()
            expect(text).includes('fruitKind={fruit}')
            expect(text).toMatchInlineSnapshot(
                `
              "autocompletes:
                - name: starcoder-16b
                  value:
                    - "                <Fruits fruitKind={fruit} />"
              prompts:
                - name: fireworks
                  value:
                    - speaker: human
                      text: >-
                        <filename>src/FruitsList.jsx<fim_prefix>// Additional documentation
                        for \`Fruits\`:

                        //

                        // var Fruits: ({ fruitKind }: { fruitKind: any; }) => any

                        //

                        // Here is a reference snippet of code from src/typeless2.js:

                        //

                        // import { helper } from './typeless'

                        //

                        // export function render() {

                        //     return helper()

                        // }

                        //

                        import { Fruits } from './Fruits'


                        export const FruitsList = () => {
                            return (
                                <ul>
                                    {['apple', 'orange'].map(fruit => (
                                        <Fruits <fim_suffix>
                                    ))}
                                </ul>
                            )
                        }

                        <fim_middle>
              "
            `
            )
        }, 10_000)
    })

    afterAll(async () => {
        await workspace.afterAll()
        await clients.afterAll()
    }, 10_000)
})
