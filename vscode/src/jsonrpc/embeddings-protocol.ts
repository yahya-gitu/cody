/**
 * The protocol for communicating between Cody and local embeddings.
 */

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type Requests = {
    'e/echo': [string, string]
    // Searches for and loads an index for the specified repository name.
    'e/load': [string, boolean]
    // Queries loaded indexes.
    'e/query': [string, string[]]
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type Notifications = {
    'e/placeholderNotification': [null]
}
