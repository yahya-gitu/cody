// Settings which control the product configuration. Clients author these
// settings to adapt the product configuration to their capabilities. Components
// read these settings to guide which components are instantiated.
//
// Unlike VSCode "Configuration", ClientSettings are fixed. So components which
// read ClientSettings do not need to respond to changes. For settings which can
// change at runtime, use VSCode extension configuration instead.
//
// Unlike Agent's ClientCapabilities, ClientSettings are consumed by components
// in vscode/src. ClientCapabilities are for negotiating client capabilities
// between the client and agent; ClientSettings are for configuring the
// extension components in vscode/src depending on the product (VSCode,
// JetBrains via Agent, etc.)
export interface ClientSettings {
    // Whether to produce Code Lenses for controlling 'edit' and 'document'.
    editControls: 'client' | 'lenses'

    // Whether to use text decorations to display in-progress edits.
    editDecorations: 'none' | 'characterDiffHighlights'
}

// Require values to be immutable. This type can be loosened, but if introducing
// arrays or objects, deep freeze them in initClientSettings.
type Simple = { [key: string]: string | number | boolean | undefined | null }

let clientSettings_: ClientSettings | undefined

// Sets the client settings. This must be called during initialization. Once
// set, client settings do not change, so this can only be called once. For
// settings which can change, use ExtensionConfiguration.
export function initClientSettings(settings: ClientSettings & Simple): void {
    if (clientSettings_) {
        throw new Error('Client settings already set.')
    }
    clientSettings_ = Object.freeze(JSON.parse(JSON.stringify(settings)))
}

// Gets the client settings. Client settings are immutable. Unlike
// ExtensionConfiguration it is not necessary to respond to changes.
export function clientSettings(): Readonly<ClientSettings> {
    if (!clientSettings_) {
        throw new Error('Client settings must be set before read.')
    }
    return clientSettings_
}
